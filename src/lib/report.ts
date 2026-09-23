import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { appUrl, currentPeriodBR } from "./utils";
import { estimateCost, monthUsage, type UsageLine } from "./whatsapp-usage";

/* ------------------------------------------------------------------ períodos (mês no fuso de SP) */

export { currentPeriodBR };

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
  /** Mensagens do WhatsApp no mês e a estimativa do que a Meta cobra do cliente; null sem uso. */
  whatsapp: WhatsAppMonth | null;
}

export interface WhatsAppMonth {
  sent: number;
  billed: number;
  /** Estimativa em R$ pela tabela de referência (a Meta cobra direto no cartão do cliente). */
  estimate: number;
  /** Houve mensagem cobrada de categoria sem preço de referência (a estimativa fica abaixo do real). */
  partial: boolean;
}

/** Soma o consumo de todos os chatbots do cliente no mês. */
async function whatsappMonth(db: SupabaseClient, botIds: string[], period: string): Promise<WhatsAppMonth | null> {
  const perBot = await Promise.all(botIds.map((id) => monthUsage(db, id, period)));
  const merged = new Map<string, UsageLine>();
  for (const l of perBot.flat()) {
    const m = merged.get(l.category) ?? { category: l.category, sent: 0, billed: 0 };
    merged.set(l.category, { ...m, sent: m.sent + l.sent, billed: m.billed + l.billed });
  }
  const lines = [...merged.values()];
  const sent = lines.reduce((a, l) => a + l.sent, 0);
  if (!sent) return null;
  const { total, unpriced } = estimateCost(lines);
  return { sent, billed: lines.reduce((a, l) => a + l.billed, 0), estimate: total, partial: unpriced.length > 0 };
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
  const [current, previous, daily, whatsapp] = await Promise.all([
    summary(db, ids, period),
    summary(db, ids, shiftPeriod(period, -1)),
    ids.length ? db.rpc("bots_daily", { p_bot_ids: ids, p_from: from, p_to: to }).then((r) => (r.data ?? []) as ClientReport["daily"]) : Promise.resolve([]),
    whatsappMonth(db, ids, period),
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
    whatsapp,
  };
}

/* ------------------------------------------------------------------ e-mail */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const fmt = (n: number) => new Intl.NumberFormat("pt-BR").format(n);
export const fmtBRL = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 }).format(n);

/** Frase do WhatsApp no relatório (tela e e-mail): quanto foi enviado e quanto a Meta deve cobrar. */
export function whatsappSentence(w: WhatsAppMonth): string {
  const cost = w.billed
    ? ` A Meta cobrou ${fmt(w.billed)} delas, cerca de ${fmtBRL(w.estimate)}${w.partial ? " ou um pouco mais" : ""}, direto no cartão cadastrado no WhatsApp.`
    : " Nenhuma foi cobrada pela Meta.";
  return `${fmt(w.sent)} mensage${w.sent === 1 ? "m enviada" : "ns enviadas"} pelo WhatsApp.${cost}`;
}

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
${r.whatsapp ? `<tr><td style="padding:4px 24px 0;font-size:13px;line-height:1.5;color:#4c5551"><strong style="color:#1b1f1d">WhatsApp:</strong> ${esc(whatsappSentence(r.whatsapp))}</td></tr>` : ""}
<tr><td style="padding:14px 24px 24px">
<a href="${esc(link)}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;font-weight:bold;font-size:14px;padding:12px 18px;border-radius:9px">Ver relatório completo e contatos</a>
</td></tr>
<tr><td style="padding:14px 24px;border-top:1px solid #efebe2;font-size:12px;color:#8a938e">Relatório preparado por ${esc(r.agency.name)}.</td></tr>
</table></td></tr></table></body></html>`;

  const text = [headline, "", ...kpis.map(([l, v, s]) => `${l}: ${v}${s ? ` (${s})` : ""}`), ...(r.whatsapp ? ["", `WhatsApp: ${whatsappSentence(r.whatsapp)}`] : []), "", `Relatório completo: ${link}`, "", `Preparado por ${r.agency.name}.`].join("\n");
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
