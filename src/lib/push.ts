import type { SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { PLATFORM_SCOPE, openField, sealField } from "./field-cipher";
import { firstExceeded } from "./rate-limit";
import { renderTemplate } from "./whatsapp-templates";
import { NOTICE_KINDS, NOTICE_KIND_ORDER, delegatedToClient, eligibleMembers, kindsForRole, type NoticeKind, type TeamNotice } from "./team-notices";
import type { AgencyRole } from "./roles";

/*
 * Avisos no celular e no computador (leva Memória e avisos no celular, parte 2; spec: avisos push do
 * painel no celular e no computador, por tipo de aviso). Web Push com as chaves VAPID do BoaVoz
 * (VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY; sem elas, o recurso não aparece). Cada aparelho que ativa
 * vira uma linha; os tipos são os dos avisos da equipe no WhatsApp, mais a transferência para a
 * pessoa. Quem recebe segue a mesma regra dos avisos no WhatsApp (papel, escopo, setor, atendimento
 * delegado ao cliente) e, nos pedidos de atendente e nos leads, também as pessoas da área do
 * cliente que atendem. O mesmo acontecimento avisa uma vez a cada 10 minutos por pessoa.
 */

export type PushKind = NoticeKind | "transferencia";
export type PushMemberType = "agency_member" | "client_member";
export interface PushTarget {
  type: PushMemberType;
  id: string;
}

export const PUSH_KIND_LABEL: Record<PushKind, string> = {
  ...(Object.fromEntries(NOTICE_KIND_ORDER.map((k) => [k, NOTICE_KINDS[k].label])) as Record<NoticeKind, string>),
  transferencia: "Conversa transferida para você ou para o seu setor",
};
export const PUSH_KIND_ORDER: PushKind[] = ["urgente", "atendente", "transferencia", "lead", "canal", "pagamento", "cota"];
/** Os tipos que a área do cliente recebe (o resto é da agência: canal, pagamento, cota). */
export const CLIENT_PUSH_KINDS: PushKind[] = ["urgente", "atendente", "transferencia", "lead"];
/** Os tipos de cada papel da agência: os dos avisos no WhatsApp, mais a transferência (todo papel atende). Pura. */
export const agencyPushKinds = (role: AgencyRole): PushKind[] => PUSH_KIND_ORDER.filter((k) => k === "transferencia" || (kindsForRole(role) as string[]).includes(k));
export const isPushKind = (v: unknown): v is PushKind => typeof v === "string" && v in PUSH_KIND_LABEL;

const DEDUPE_SECONDS = 600;
const TITLE: Record<PushKind, string> = { urgente: "Atendimento urgente", atendente: "Pediram atendente", transferencia: "Conversa transferida", lead: "Lead novo", canal: "WhatsApp desconectado", pagamento: "Pagamento atrasado", cota: "Cota do mês" };

/** As chaves VAPID estão na Vercel? Sem elas, a tela não oferece os avisos. */
export const pushConfigured = (): boolean => Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
export const vapidPublicKey = (): string | null => process.env.VAPID_PUBLIC_KEY || null;

/** O aviso está ligado para a pessoa? Sem escolha gravada, todos ligados. Pura. */
export const pushOn = (prefs: Record<string, boolean> | null | undefined, kind: PushKind): boolean => prefs?.[kind] !== false;

const table = (t: PushMemberType) => (t === "client_member" ? "client_members" : "agency_members");

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** O que o navegador mandou, conferido (endereço https e as duas chaves). Pura. */
export function parseSubscription(raw: unknown): PushSubscriptionInput | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof r.endpoint !== "string" || !/^https:\/\//.test(r.endpoint) || r.endpoint.length > 1000) return null;
  const p256dh = r.keys?.p256dh;
  const auth = r.keys?.auth;
  if (typeof p256dh !== "string" || typeof auth !== "string" || !p256dh || !auth || p256dh.length > 200 || auth.length > 100) return null;
  return { endpoint: r.endpoint, keys: { p256dh, auth } };
}

/** "Chrome no Windows", "Safari no iPhone": o nome do aparelho na lista, pelo navegador. Pura. */
export function deviceLabel(ua: string | null | undefined): string {
  const s = ua ?? "";
  const os = /iPhone|iPad/.test(s) ? "iPhone" : /Android/.test(s) ? "Android" : /Mac OS X/.test(s) ? "Mac" : /Windows/.test(s) ? "Windows" : /Linux/.test(s) ? "Linux" : "aparelho";
  const browser = /Edg\//.test(s) ? "Edge" : /Firefox\//.test(s) ? "Firefox" : /Chrome\//.test(s) ? "Chrome" : /Safari\//.test(s) ? "Safari" : "navegador";
  return `${browser} no ${os}`;
}

/** Ativa os avisos neste aparelho (o mesmo endereço troca de dono se outra pessoa entrar nele). */
export async function savePushSubscription(db: SupabaseClient, who: PushTarget, sub: PushSubscriptionInput, label: string): Promise<boolean> {
  const keys_enc = await sealField("push_subscriptions.keys_enc", JSON.stringify(sub.keys), PLATFORM_SCOPE);
  const { error } = await db.from("push_subscriptions").upsert({ member_type: who.type, member_id: who.id, endpoint: sub.endpoint, keys_enc, label: label.slice(0, 80), failures: 0 }, { onConflict: "endpoint" });
  if (error) console.error("avisos push: aparelho não gravado", error.message);
  return !error;
}

export interface PushDevice {
  id: string;
  label: string | null;
  created_at: string;
  last_sent_at: string | null;
  /** só para a tela saber se o aparelho aberto é um destes (é da própria pessoa) */
  endpoint: string;
}

export async function listPushDevices(db: SupabaseClient, who: PushTarget): Promise<PushDevice[]> {
  const { data } = await db.from("push_subscriptions").select("id, label, created_at, last_sent_at, endpoint").eq("member_type", who.type).eq("member_id", who.id).order("created_at");
  return (data ?? []) as PushDevice[];
}

export async function removePushDevice(db: SupabaseClient, who: PushTarget, id: string): Promise<boolean> {
  const { error } = await db.from("push_subscriptions").delete().eq("id", id).eq("member_type", who.type).eq("member_id", who.id);
  return !error;
}

/** "Desativar neste aparelho": sai pelo endereço que o navegador tem. */
export async function removePushEndpoint(db: SupabaseClient, who: PushTarget, endpoint: string): Promise<boolean> {
  const { error } = await db.from("push_subscriptions").delete().eq("endpoint", endpoint).eq("member_type", who.type).eq("member_id", who.id);
  return !error;
}

/** As escolhas da pessoa (sem escolha gravada, null: todos ligados). */
export async function pushPrefs(db: SupabaseClient, who: PushTarget): Promise<Record<string, boolean> | null> {
  const { data } = await db.from(table(who.type)).select("push_prefs").eq("id", who.id).maybeSingle();
  return (data?.push_prefs as Record<string, boolean> | null) ?? null;
}

export async function savePushPrefs(db: SupabaseClient, who: PushTarget, kinds: PushKind[], on: Set<string>): Promise<boolean> {
  const prefs = Object.fromEntries(kinds.map((k) => [k, on.has(k)]));
  const { error } = await db.from(table(who.type)).update({ push_prefs: prefs }).eq("id", who.id);
  return !error;
}

export interface PushMessage {
  kind: PushKind | "teste";
  title: string;
  body: string;
  /** o caminho que o toque abre ("/painel/caixa?...") */
  url: string;
  /** o acontecimento: o mesmo não avisa de novo em 10 minutos */
  ref: string;
}

let vapidReady = false;
function ensureVapid(): boolean {
  if (!pushConfigured()) return false;
  if (!vapidReady) {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:contato@boavoz.com", process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
    vapidReady = true;
  }
  return true;
}

/**
 * Manda o aviso para os aparelhos das pessoas (cada uma com a própria escolha de tipos). O aparelho
 * que o navegador recusou de vez (404 ou 410) sai da lista. Nunca derruba quem chamou. Devolve
 * quantos aparelhos receberam.
 */
export async function pushTo(db: SupabaseClient, targets: Array<PushTarget & { url?: string }>, msg: PushMessage): Promise<number> {
  if (!targets.length || !ensureVapid()) return 0;
  let sent = 0;
  try {
    for (const type of ["agency_member", "client_member"] as const) {
      const ofType = targets.filter((t) => t.type === type);
      if (!ofType.length) continue;
      const ids = [...new Set(ofType.map((t) => t.id))];
      const base = db.from(table(type)).select("id, push_prefs").in("id", ids);
      const { data: members } = await (type === "agency_member" ? base.is("removed_at", null) : base);
      const active = new Map(((members ?? []) as Array<{ id: string; push_prefs: Record<string, boolean> | null }>).map((m) => [m.id, m.push_prefs]));
      const { data: subs } = await db.from("push_subscriptions").select("id, member_id, endpoint, keys_enc, failures").eq("member_type", type).in("member_id", ids);
      // a escolha de tipos e o "não repetir" são da pessoa: conferidos uma vez, valem para todos os aparelhos dela
      const allowed = new Map<string, boolean>();
      for (const s of (subs ?? []) as Array<{ id: string; member_id: string; endpoint: string; keys_enc: string; failures: number }>) {
        if (!active.has(s.member_id)) continue;
        if (!allowed.has(s.member_id)) {
          const ok = msg.kind === "teste" || (pushOn(active.get(s.member_id), msg.kind) && !(await firstExceeded(db, [{ key: `push:${msg.kind}:${s.member_id}:${msg.ref}`, max: 1, windowSeconds: DEDUPE_SECONDS, message: "repetido" }])));
          allowed.set(s.member_id, ok);
        }
        if (!allowed.get(s.member_id)) continue;
        const url = ofType.find((t) => t.id === s.member_id)?.url ?? msg.url;
        try {
          const keys = JSON.parse(await openField("push_subscriptions.keys_enc", s.keys_enc)) as { p256dh: string; auth: string };
          await webpush.sendNotification({ endpoint: s.endpoint, keys }, JSON.stringify({ title: msg.title, body: msg.body, url, tag: `${msg.kind}:${msg.ref}` }), { TTL: 3600, urgency: msg.kind === "urgente" ? "high" : "normal" });
          await db.from("push_subscriptions").update({ last_sent_at: new Date().toISOString(), failures: 0 }).eq("id", s.id);
          sent++;
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) await db.from("push_subscriptions").delete().eq("id", s.id);
          else {
            await db.from("push_subscriptions").update({ failures: (s.failures ?? 0) + 1 }).eq("id", s.id);
            console.error("avisos push: não saiu", status ?? (e as Error).message);
          }
        }
      }
    }
  } catch (e) {
    console.error("avisos push: falha ao avisar", (e as Error).message);
  }
  return sent;
}

/**
 * Os avisos da equipe (os mesmos do WhatsApp) também no celular e no computador. A agência pelo
 * papel e pelo escopo; nos pedidos de atendente e nos leads, também a área do cliente que atende
 * (a página da Caixa dela). Atendimento delegado ao cliente: a agência não recebe (urgente sim).
 */
export async function pushForNotice(db: SupabaseClient, n: TeamNotice): Promise<number> {
  if (!pushConfigured()) return 0;
  const body = renderTemplate(NOTICE_KINDS[n.kind].body, n.vars);
  const forClients = Boolean(n.clientId) && (CLIENT_PUSH_KINDS as string[]).includes(n.kind);
  const delegated = forClients && n.kind !== "urgente" && (await delegatedToClient(db, n.clientId!).catch(() => false));
  const agency = delegated ? [] : (await eligibleMembers(db, n).catch(() => [] as string[])).filter((id) => !n.onlyMemberIds || n.onlyMemberIds.includes(id));
  let clientPeople: string[] = [];
  if (forClients) {
    const { data: client } = await db.from("clients").select("allow_handoff").eq("id", n.clientId!).maybeSingle();
    if (client?.allow_handoff) {
      const { data } = await db.from("client_members").select("id").eq("client_id", n.clientId!);
      clientPeople = ((data ?? []) as Array<{ id: string }>).map((r) => r.id).filter((id) => !n.onlyClientMemberIds || n.onlyClientMemberIds.includes(id));
    }
  }
  // o lead pode estar numa conversa que não está na Caixa (a IA resolveu): abre a conversa direto
  const clientUrl = !n.conversationId ? `/cliente/${n.clientId}/caixa` : n.kind === "lead" ? `/cliente/${n.clientId}/conversas/${n.conversationId}` : `/cliente/${n.clientId}/caixa?fila=todas&c=${n.conversationId}`;
  return pushTo(db, [...agency.map((id) => ({ type: "agency_member" as const, id })), ...clientPeople.map((id) => ({ type: "client_member" as const, id, url: clientUrl }))], { kind: n.kind, title: TITLE[n.kind], body, url: `/${n.path.replace(/^\/+/, "")}`, ref: n.ref });
}

/** O título de cada tipo (o teste usa o seu). Pura. */
export const pushTitle = (k: PushKind) => TITLE[k];
