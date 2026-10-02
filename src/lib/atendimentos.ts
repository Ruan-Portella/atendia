import type { SupabaseClient } from "@supabase/supabase-js";
import { hmacHex } from "./hash";
import { PLANS } from "./plans";
import { QUOTA_TOLERANCE, hardLimitOf } from "./quota";
import { notifyAgencyOwner } from "./notify";
import { appUrl, currentPeriodBR, monthStartBR } from "./utils";
import { periodLabel } from "./report";

export { ATENDIMENTO_DEFINITION, QUOTA_TOLERANCE, hardLimitOf, quotaOf } from "./quota";

/*
 * Cota por atendimento (L1; spec "Planos e cota"). A abertura (open_atendimento, migração 0050)
 * acontece antes de cada chamada da IA, sob a trava do contato: o atendimento aberto há menos de
 * 24 horas segue até o fim, mesmo que a cota encha no meio; senão confere a cota da agência (com a
 * tolerância de 10%) e o sublimite do cliente. Sem vaga, o chamador entra no modo só humano.
 * Não contam: o teste ao vivo do painel, as demos e as avaliações (não passam por aqui).
 */

export type AtendimentoChannel = "widget" | "whatsapp" | "instagram";

/** Por que não abriu: a cota da agência (com a tolerância) ou o sublimite do cliente acabou. */
export type AtendimentoBlock = "quota_exceeded" | "client_quota_exceeded";

/** Chave do contato em hash (HMAC): ficha do contato no WhatsApp e no Instagram, visitor_id no widget. */
export const contactKeyHash = (channel: AtendimentoChannel, key: string) => hmacHex(`atendimento:${channel}:${key}`);

const PLAN_QUOTAS = Object.fromEntries(Object.values(PLANS).map((p) => [p.id, p.atendimentos]));

interface OpenRow {
  status: "aberto" | "novo" | "cota" | "sublimite";
  atendimento_id: number | null;
  used: number | null;
  quota: number | null;
  client_used: number | null;
  client_cap: number | null;
}

export interface OpenResult {
  blocked: AtendimentoBlock | null;
  /** Abriu agora (conta 1 no mês). */
  isNew: boolean;
  id: number | null;
}

/**
 * Abre (ou reaproveita) o atendimento deste contato antes de chamar a IA. Falha do banco não para
 * o bot (o bot nunca para por erro nosso): registra e deixa responder.
 */
export async function openAtendimento(
  db: SupabaseClient,
  bot: { id: string; agency_id: string },
  o: { channel: AtendimentoChannel; contactKey: string; conversationId: string | null },
): Promise<OpenResult> {
  const { data, error } = await db.rpc("open_atendimento", {
    p_bot_id: bot.id,
    p_channel: o.channel,
    p_contact_key_hash: contactKeyHash(o.channel, o.contactKey),
    p_conversation_id: o.conversationId,
    p_plan_quotas: PLAN_QUOTAS,
    p_tolerance: QUOTA_TOLERANCE,
  });
  const row = (Array.isArray(data) ? data[0] : data) as OpenRow | null;
  if (error || !row) {
    console.error("atendimento: não foi possível conferir a cota", error?.message);
    return { blocked: null, isNew: false, id: null };
  }
  if (row.status === "cota") return { blocked: "quota_exceeded", isNew: false, id: null };
  if (row.status === "sublimite") return { blocked: "client_quota_exceeded", isNew: false, id: null };
  if (row.status === "novo") {
    // avisos de 80% e 100%: o contador sobe de 1 em 1 sob a trava, então cada um sai uma vez por mês
    notifyQuotaLevels(db, bot, row).catch((e) => console.error("atendimento: aviso de cota", e));
  }
  return { blocked: null, isNew: row.status === "novo", id: row.atendimento_id };
}

/** Variante que lança o motivo (o chamador já trata "quota_exceeded" como modo só humano). */
export async function requireAtendimento(...args: Parameters<typeof openAtendimento>): Promise<OpenResult> {
  const r = await openAtendimento(...args);
  if (r.blocked) throw new Error(r.blocked);
  return r;
}

/* ------------------------------------------------------------------ avisos */

export type QuotaLevel = 80 | 100 | "fim";

/** Qual aviso da agência disparar neste atendimento (80% e 100% da cota; fim da tolerância). */
export function quotaAlertLevel(used: number, quota: number): QuotaLevel | null {
  if (quota <= 0) return null;
  const hard = hardLimitOf(quota);
  // cota pequena (menos de 10) não tem tolerância: o aviso de 100% já é o do modo só humano
  if (used === hard) return "fim";
  if (used === quota) return 100;
  if (used === Math.ceil(quota * 0.8) && used < quota) return 80;
  return null;
}

/** Qual aviso do sublimite do cliente (80% e 100%; sem tolerância: o limite é da agência). */
export function clientAlertLevel(used: number, cap: number): 80 | 100 | null {
  if (cap <= 0) return null;
  if (used === cap) return 100;
  if (used === Math.ceil(cap * 0.8) && used < cap) return 80;
  return null;
}

const fmt = (n: number) => new Intl.NumberFormat("pt-BR").format(n);

async function notifyQuotaLevels(db: SupabaseClient, bot: { id: string; agency_id: string }, row: OpenRow) {
  const usage = appUrl("/painel/cobranca/uso");
  const month = periodLabel(currentPeriodBR());
  const agencyLevel = row.used !== null && row.quota !== null ? quotaAlertLevel(row.used, row.quota) : null;
  if (agencyLevel && row.used !== null && row.quota !== null) {
    const [subject, lines] = agencyQuotaEmail(agencyLevel, row.used, row.quota, month, usage);
    await notifyAgencyOwner(db, bot.agency_id, subject, lines);
  }
  const clientLevel = row.client_used !== null && row.client_cap !== null ? clientAlertLevel(row.client_used, row.client_cap) : null;
  if (clientLevel && row.client_cap !== null) {
    const { data: b } = await db.from("bots").select("client_name").eq("id", bot.id).maybeSingle();
    const name = (b?.client_name as string | undefined) ?? "Um cliente";
    const [subject, lines] = clientCapEmail(clientLevel, name, row.client_cap, month, usage);
    await notifyAgencyOwner(db, bot.agency_id, subject, lines);
  }
}

const HUMAN_ONLY =
  "No modo só humano, a IA não responde a quem começa um atendimento novo: as mensagens do WhatsApp e do Instagram chegam em Conversas para a sua equipe responder, e o chat do site mostra um formulário de contato. Atendimentos já abertos seguem até completar 24 horas.";

/** Assunto e texto do aviso de cota da agência. Função pura. */
export function agencyQuotaEmail(level: QuotaLevel, used: number, quota: number, month: string, usageUrl: string): [string, string[]] {
  const hard = hardLimitOf(quota);
  if (level === 80) {
    return [
      "Você já usou 80% dos atendimentos do mês",
      [
        `Seus chatbots já fizeram ${fmt(used)} de ${fmt(quota)} atendimentos em ${month}.`,
        "",
        `Ao chegar na cota, vale uma tolerância de 10% (até ${fmt(hard)} atendimentos). Depois disso, a conta entra no modo só humano até o mês virar.`,
        HUMAN_ONLY,
        "",
        `Uso do mês e upgrade de plano: ${usageUrl}`,
      ],
    ];
  }
  if (level === 100) {
    return [
      "Cota de atendimentos do mês atingida",
      [
        `Seus chatbots chegaram a ${fmt(quota)} atendimentos em ${month}, a cota do plano.`,
        "",
        `A partir de agora vale a tolerância de 10%: mais ${fmt(hard - quota)} atendimentos. Depois, a conta entra no modo só humano até o mês virar.`,
        HUMAN_ONLY,
        "",
        `Para não parar, faça upgrade do plano: ${usageUrl}`,
      ],
    ];
  }
  return [
    "Seus chatbots entraram no modo só humano",
    [
      `Seus chatbots usaram a cota e a tolerância de ${month} (${fmt(hard)} atendimentos).`,
      "",
      HUMAN_ONLY,
      "",
      `A IA volta no dia 1º do próximo mês, ou na hora com o upgrade do plano: ${usageUrl}`,
    ],
  ];
}

/** Assunto e texto do aviso do sublimite de um cliente. Função pura. */
export function clientCapEmail(level: 80 | 100, clientName: string, cap: number, month: string, usageUrl: string): [string, string[]] {
  if (level === 80) {
    return [
      `${clientName}: 80% do limite de atendimentos do mês`,
      [
        `O cliente ${clientName} já usou 80% do limite de ${fmt(cap)} atendimentos que vocês definiram para ele em ${month}.`,
        "",
        "No limite, só os chatbots dele entram no modo só humano (os outros clientes seguem normais).",
        "",
        `Para mudar o limite: ${usageUrl}`,
      ],
    ];
  }
  return [
    `${clientName} chegou ao limite de atendimentos do mês`,
    [
      `O cliente ${clientName} chegou ao limite de ${fmt(cap)} atendimentos que vocês definiram para ele em ${month}.`,
      "",
      `Os chatbots dele entraram no modo só humano. ${HUMAN_ONLY}`,
      "",
      `A IA volta no dia 1º do próximo mês, ou quando vocês aumentarem o limite: ${usageUrl}`,
    ],
  ];
}

/* ------------------------------------------------------------------ leitura */

/** Atendimentos da agência no mês (São Paulo). */
export async function monthAtendimentos(db: SupabaseClient, agencyId: string, period = currentPeriodBR()): Promise<number> {
  const { count } = await db.from("atendimentos").select("id", { count: "exact", head: true }).eq("agency_id", agencyId).gte("started_at", monthStartBR(period).toISOString());
  return count ?? 0;
}

export interface BotMonthUsage {
  botId: string;
  clientId: string | null;
  atendimentos: number;
  messages: number;
  /** Mensagens do WhatsApp cobradas pela Meta, por categoria. */
  metaBilled: Record<string, number>;
}

/** Atendimentos do mês por cliente (o mesmo número que o sublimite confere). Service role. */
export async function clientMonthAtendimentos(db: SupabaseClient, agencyId: string, period = currentPeriodBR()): Promise<Map<string, number>> {
  const { data, error } = await db.rpc("client_month_atendimentos", { p_agency_id: agencyId, p_month_start: monthStartBR(period).toISOString() });
  if (error) throw new Error(`atendimentos por cliente: ${error.message}`);
  return new Map(((data ?? []) as Array<{ client_id: string; total: number | string }>).map((r) => [r.client_id, Number(r.total) || 0]));
}

/** Uso do mês por chatbot (Cobrança → Uso e custo). Service role; quem chama já conferiu a agência. */
export async function agencyMonthUsage(db: SupabaseClient, agencyId: string, period = currentPeriodBR()): Promise<BotMonthUsage[]> {
  const { data, error } = await db.rpc("agency_month_usage", { p_agency_id: agencyId, p_month_start: monthStartBR(period).toISOString(), p_period: period });
  if (error) throw new Error(`uso do mês: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    botId: r.bot_id as string,
    clientId: (r.client_id as string | null) ?? null,
    atendimentos: Number(r.atendimentos) || 0,
    messages: Number(r.messages) || 0,
    metaBilled: Object.fromEntries(Object.entries((r.meta_billed as Record<string, unknown>) ?? {}).map(([k, v]) => [k, Number(v) || 0])),
  }));
}
