import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { appUrl } from "./utils";

/* ------------------------------------------------------------------ períodos (mês no fuso de SP) */

/** Mês atual em São Paulo, 'AAAA-MM'. */
export function currentPeriodBR(now = new Date()): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).formatToParts(now);
  return `${p.find((x) => x.type === "year")!.value}-${p.find((x) => x.type === "month")!.value}`;
}

export function isPeriod(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

export function shiftPeriod(period: string, months: number): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + months, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Início e fim (exclusivo) do mês em São Paulo (UTC-3, sem horário de verão desde 2019). */
export function periodRange(period: string): { from: string; to: string } {
  const [y, m] = period.split("-").map(Number);
  return { from: new Date(Date.UTC(y, m - 1, 1, 3)).toISOString(), to: new Date(Date.UTC(y, m, 1, 3)).toISOString() };
}

/** 'agosto de 2026' */
export function periodLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** Variação percentual arredondada; null quando não há base de comparação. */
export function change(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export const newPortalToken = () => randomBytes(18).toString("base64url");
/** Link do portal; `base` = domínio próprio da agência quando houver (ver agencyBaseUrl). */
export const portalUrl = (token: string, base = appUrl()) => `${base.replace(/\/$/, "")}/c/${token}`;

/* ------------------------------------------------------------------ dados */

export interface Summary {
  conversations: number;
  needsHuman: number;
  leads: number;
  visitorMessages: number;
}

export interface ClientReport {
  period: string;
  client: { id: string; name: string; site: string | null };
  agency: { name: string; logo_url: string | null; brand_color: string; support_whatsapp: string | null; custom_domain: string | null; custom_domain_verified_at: string | null };
  bots: Array<{ id: string; name: string }>;
  current: Summary;
  previous: Summary;
  daily: Array<{ day: string; conversations: number; leads: number }>;
  resolvedPct: number;
}

const EMPTY: Summary = { conversations: 0, needsHuman: 0, leads: 0, visitorMessages: 0 };

async function summary(db: SupabaseClient, botIds: string[], period: string): Promise<Summary> {
  if (!botIds.length) return EMPTY;
  const { from, to } = periodRange(period);
  const { data } = await db.rpc("bots_summary", { p_bot_ids: botIds, p_from: from, p_to: to });
  const r = (Array.isArray(data) ? data[0] : data) as { conversations: number; needs_human: number; leads: number; visitor_messages: number } | null;
  return r ? { conversations: r.conversations, needsHuman: r.needs_human, leads: r.leads, visitorMessages: r.visitor_messages } : EMPTY;
}

/**
 * Relatório de um cliente num mês. `db` pode ser o cliente do usuário (painel, com RLS) ou a
 * service role (portal e cron) — nos dois casos só entram os chatbots daquele cliente.
 */
export async function getClientReport(db: SupabaseClient, clientId: string, period: string): Promise<ClientReport | null> {
  const { data: client } = await db.from("clients").select("id, name, site, agency_id").eq("id", clientId).maybeSingle();
  if (!client) return null;
  const [{ data: agency }, { data: bots }] = await Promise.all([
    db.from("agencies").select("name, logo_url, brand_color, support_whatsapp, custom_domain, custom_domain_verified_at").eq("id", client.agency_id).single(),
    db.from("bots").select("id, name").eq("client_id", clientId).eq("is_demo", false).order("created_at"),
  ]);
  const ids = (bots ?? []).map((b) => b.id);
  const { from, to } = periodRange(period);
  const [current, previous, daily] = await Promise.all([
    summary(db, ids, period),
    summary(db, ids, shiftPeriod(period, -1)),
    ids.length ? db.rpc("bots_daily", { p_bot_ids: ids, p_from: from, p_to: to }).then((r) => (r.data ?? []) as ClientReport["daily"]) : Promise.resolve([]),
  ]);
  return {
    period,
    client: { id: client.id, name: client.name, site: client.site },
    agency: agency ?? { name: "", logo_url: null, brand_color: "#1f4e3d", support_whatsapp: null, custom_domain: null, custom_domain_verified_at: null },
    bots: bots ?? [],
    current,
    previous,
    daily,
    resolvedPct: current.conversations ? Math.round(100 - (current.needsHuman / current.conversations) * 100) : 100,
  };
}

/* ------------------------------------------------------------------ e-mail */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const fmt = (n: number) => new Intl.NumberFormat("pt-BR").format(n);

function delta(cur: number, prev: number): string {
  const c = change(cur, prev);
  if (c === null) return "";
  return c === 0 ? "igual ao mês anterior" : `${c > 0 ? "+" : ""}${c}% vs. mês anterior`;
}

/** E-mail do relatório: HTML simples com estilos inline (clientes de e-mail ignoram CSS externo). */
export function renderReportEmail(r: ClientReport, link: string): { subject: string; html: string; text: string } {
  const month = periodLabel(r.period);
  const color = /^#[0-9a-f]{6}$/i.test(r.agency.brand_color) ? r.agency.brand_color : "#1f4e3d";
  const kpis: Array<[string, string, string]> = [
    ["Pessoas atendidas", fmt(r.current.conversations), delta(r.current.conversations, r.previous.conversations)],
    ["Contatos capturados", fmt(r.current.leads), delta(r.current.leads, r.previous.leads)],
    ["Resolvidas sem ajuda", `${r.resolvedPct}%`, "sem precisar de alguém da equipe"],
  ];
  const subject = `${r.client.name}: seu assistente em ${month}`;
  const headline = r.current.conversations
    ? `Em ${month}, o assistente de ${r.client.name} atendeu ${fmt(r.current.conversations)} pessoa${r.current.conversations === 1 ? "" : "s"} e capturou ${fmt(r.current.leads)} contato${r.current.leads === 1 ? "" : "s"}.`
    : `Em ${month}, o assistente de ${r.client.name} ainda não recebeu conversas.`;

  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f4f3ee;font-family:Arial,Helvetica,sans-serif;color:#1b1f1d">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f3ee;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e3dfd4">
<tr><td style="background:${color};padding:20px 24px;color:#ffffff">
${r.agency.logo_url ? `<img src="${esc(r.agency.logo_url)}" alt="" height="32" style="height:32px;border-radius:6px;vertical-align:middle;margin-right:10px">` : ""}<span style="font-size:15px;font-weight:bold;vertical-align:middle">${esc(r.agency.name)}</span>
<div style="margin-top:14px;font-size:13px;opacity:.85;text-transform:capitalize">Relatório de ${esc(month)}</div>
<div style="font-size:22px;font-weight:bold;margin-top:2px">${esc(r.client.name)}</div>
</td></tr>
<tr><td style="padding:22px 24px 6px;font-size:15px;line-height:1.5">${esc(headline)}</td></tr>
<tr><td style="padding:10px 18px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="6"><tr>
${kpis.map(([label, value, sub]) => `<td width="33%" valign="top" style="background:#f7f6f1;border-radius:10px;padding:12px">
<div style="font-size:11px;color:#6b736f;text-transform:uppercase;letter-spacing:.05em">${esc(label)}</div>
<div style="font-size:24px;font-weight:bold;margin:4px 0">${esc(value)}</div>
<div style="font-size:11px;color:#6b736f">${esc(sub)}</div></td>`).join("")}
</tr></table></td></tr>
<tr><td style="padding:14px 24px 24px">
<a href="${esc(link)}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;font-weight:bold;font-size:14px;padding:12px 18px;border-radius:9px">Ver relatório completo e contatos</a>
</td></tr>
<tr><td style="padding:14px 24px;border-top:1px solid #efebe2;font-size:12px;color:#8a938e">Relatório preparado por ${esc(r.agency.name)}.</td></tr>
</table></td></tr></table></body></html>`;

  const text = [headline, "", ...kpis.map(([l, v, s]) => `${l}: ${v}${s ? ` (${s})` : ""}`), "", `Relatório completo: ${link}`, "", `Preparado por ${r.agency.name}.`].join("\n");
  return { subject, html, text };
}

/** Envia o relatório pelo Resend. Devolve false quando o e-mail não está configurado. */
export async function sendReportEmail(r: ClientReport, to: string, link: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;
  const { Resend } = await import("resend");
  const { subject, html, text } = renderReportEmail(r, link);
  const fromAddress = process.env.EMAIL_FROM?.match(/<([^>]+)>/)?.[1] ?? process.env.EMAIL_FROM ?? "onboarding@resend.dev";
  // o nome do remetente é a agência (white-label); o endereço continua o configurado
  const { error } = await new Resend(apiKey).emails.send({ from: `${r.agency.name.replace(/["<>]/g, "")} <${fromAddress}>`, to, subject, html, text });
  if (error) throw new Error(error.message);
  return true;
}
