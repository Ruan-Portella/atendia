import type { SupabaseClient } from "@supabase/supabase-js";
import { hmacHex } from "./hash";
import { ANSWERS_PER_ATENDIMENTO, BOT_SIZES, OVERAGE_PRICE_BRL, brlCents as brl2, isBotSize, type BotSize } from "./plans";
import { SIZE_QUOTAS, botQuota, overageAlertLevel, overageMax, quotaAlertLevel, type QuotaLevel } from "./quota";
import { notifyAgencyOwner } from "./notify";
import { appUrl, currentPeriodBR, monthStartBR } from "./utils";
import { periodLabel, shiftPeriod } from "./report";

export { ATENDIMENTO_DEFINITION, botQuota, overageAlertLevel, overageMax, quotaAlertLevel, quotaPhase, suggestSize } from "./quota";

/*
 * Cota por atendimento, por chatbot (spec "Limites por plano"). A abertura (open_atendimento,
 * migração 0094) acontece antes de cada resposta da IA, sob a trava do contato: o atendimento
 * aberto há menos de 24 horas soma uma resposta, até 40; depois disso (ou sem atendimento aberto),
 * confere a cota do mês do chatbot e abre outro. Sem vaga na cota, com o excedente ligado (migração
 * 0095), abre um atendimento a mais até o teto de gasto. Sem vaga, o chamador entra no modo só
 * humano, e só aquele chatbot para. Não contam: o teste ao vivo do painel, as demos e as avaliações.
 */

export type AtendimentoChannel = "widget" | "whatsapp" | "instagram";

/** Por que não abriu: a cota do mês do chatbot acabou (sem excedente, ou com o teto atingido). */
export type AtendimentoBlock = "quota_exceeded";

/** Chave do contato em hash (HMAC): ficha do contato no WhatsApp e no Instagram, visitor_id no widget. */
export const contactKeyHash = (channel: AtendimentoChannel, key: string) => hmacHex(`atendimento:${channel}:${key}`);

interface OpenRow {
  status: "aberto" | "novo" | "excedente" | "cota" | "teto";
  atendimento_id: number | null;
  used: number | null;
  quota: number | null;
  overage_on: boolean | null;
  overage_used: number | null;
  overage_max: number | null;
}

export interface OpenResult {
  blocked: AtendimentoBlock | null;
  /** Abriu agora (conta 1 no mês, na cota ou no excedente). */
  isNew: boolean;
  /** Abriu como atendimento a mais (excedente). */
  overage: boolean;
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
    p_size_quotas: SIZE_QUOTAS,
    p_answer_limit: ANSWERS_PER_ATENDIMENTO,
    p_overage_price: OVERAGE_PRICE_BRL,
  });
  const row = (Array.isArray(data) ? data[0] : data) as OpenRow | null;
  if (error || !row) {
    console.error("atendimento: não foi possível conferir a cota", error?.message);
    return { blocked: null, isNew: false, id: null, overage: false };
  }
  if (row.status === "cota" || row.status === "teto") return { blocked: "quota_exceeded", isNew: false, id: null, overage: false };
  if (row.status === "novo" || row.status === "excedente") {
    // avisos da cota (80%, 95%, 100%) e do teto do excedente (80%, 95%, teto): o contador sobe de
    // 1 em 1 sob a trava, então cada um sai uma vez por mês
    notifyQuotaLevel(db, bot, row).catch((e) => console.error("atendimento: aviso de cota", e));
  }
  return { blocked: null, isNew: row.status === "novo" || row.status === "excedente", id: row.atendimento_id, overage: row.status === "excedente" };
}

/** Variante que lança o motivo (o chamador já trata "quota_exceeded" como modo só humano). */
export async function requireAtendimento(...args: Parameters<typeof openAtendimento>): Promise<OpenResult> {
  const r = await openAtendimento(...args);
  if (r.blocked) throw new Error(r.blocked);
  return r;
}

/* ------------------------------------------------------------------ avisos */

const fmt = (n: number) => new Intl.NumberFormat("pt-BR").format(n);

async function notifyQuotaLevel(db: SupabaseClient, bot: { id: string; agency_id: string }, row: OpenRow) {
  const month = periodLabel(currentPeriodBR());
  const usage = appUrl("/painel/cobranca/uso");
  const who = async () => {
    const { data: b } = await db.from("bots").select("name, client_name, overage_cap_brl").eq("id", bot.id).maybeSingle();
    return { name: (b?.name as string | undefined) ?? "Chatbot", clientName: (b?.client_name as string | undefined) ?? null, cap: Number(b?.overage_cap_brl) || 0 };
  };
  let email: [string, string[]] | null = null;
  if (row.status === "novo" && row.used !== null && row.quota !== null) {
    const level = quotaAlertLevel(row.used, row.quota);
    if (level) {
      const b = await who();
      email = botQuotaEmail(level, b, row.used, row.quota, month, usage, row.overage_on ? b.cap : null);
    }
  } else if (row.status === "excedente" && row.overage_used !== null && row.overage_max !== null) {
    const level = overageAlertLevel(row.overage_used, row.overage_max);
    if (level) {
      const b = await who();
      email = botOverageEmail(level, b, row.overage_used, b.cap, month, usage);
    }
  }
  if (email) await notifyAgencyOwner(db, bot.agency_id, email[0], email[1]);
}

const HUMAN_ONLY =
  "No modo só humano, a IA desse chatbot não responde a quem começa um atendimento novo: as mensagens do WhatsApp e do Instagram chegam em Conversas para a sua equipe responder, e o chat do site mostra um formulário de contato. Quem já estava sendo atendido segue até completar 24 horas ou 40 respostas. Os outros chatbots continuam normais.";

/**
 * Assunto e texto do aviso de cota de um chatbot. `overageCap`: o teto do excedente, quando ele
 * está ligado (a cota cheia não para o chatbot). Função pura.
 */
export function botQuotaEmail(level: QuotaLevel, bot: { name: string; clientName: string | null }, used: number, quota: number, month: string, usageUrl: string, overageCap: number | null = null): [string, string[]] {
  const who = bot.clientName ? `${bot.name} (${bot.clientName})` : bot.name;
  if (overageCap) {
    if (level === 100) {
      return [
        `${who}: a cota do mês acabou e o excedente começou`,
        [
          `O chatbot ${who} chegou aos ${fmt(quota)} atendimentos de ${month}. O excedente está ligado: os próximos atendimentos custam ${brl2(OVERAGE_PRICE_BRL)} cada, cobrados no fim do mês, até o teto de ${brl2(overageCap)} (${fmt(overageMax(overageCap))} atendimentos a mais).`,
          "",
          "No teto, o chatbot entra no modo só humano até o mês virar.",
          "",
          `Uso, excedente e tamanho: ${usageUrl}`,
        ],
      ];
    }
    return [
      `${who}: ${level}% dos atendimentos do mês`,
      [
        `O chatbot ${who} já fez ${fmt(used)} de ${fmt(quota)} atendimentos em ${month}.`,
        "",
        `O excedente está ligado: passando da cota, cada atendimento a mais custa ${brl2(OVERAGE_PRICE_BRL)}, até o teto de ${brl2(overageCap)}.`,
        "",
        `Uso do mês por chatbot: ${usageUrl}`,
      ],
    ];
  }
  if (level === 100) {
    return [
      `${who}: a cota de atendimentos do mês acabou`,
      [
        `O chatbot ${who} chegou aos ${fmt(quota)} atendimentos de ${month} e entrou no modo só humano.`,
        "",
        HUMAN_ONLY,
        "",
        `A IA volta no dia 1º do próximo mês, ou na hora se o chatbot subir de tamanho: ${usageUrl}`,
      ],
    ];
  }
  return [
    `${who}: ${level}% dos atendimentos do mês`,
    [
      `O chatbot ${who} já fez ${fmt(used)} de ${fmt(quota)} atendimentos em ${month}.`,
      "",
      `Em ${fmt(quota)}, só este chatbot entra no modo só humano até o mês virar. Para não parar, suba o tamanho dele.`,
      "",
      `Uso do mês por chatbot: ${usageUrl}`,
    ],
  ];
}

/** Assunto e texto do aviso do teto do excedente (80%, 95% e o teto). Função pura. */
export function botOverageEmail(level: 80 | 95 | "teto", bot: { name: string; clientName: string | null }, extraUsed: number, cap: number, month: string, usageUrl: string): [string, string[]] {
  const who = bot.clientName ? `${bot.name} (${bot.clientName})` : bot.name;
  const spent = brl2(extraUsed * OVERAGE_PRICE_BRL);
  if (level === "teto") {
    return [
      `${who}: o excedente chegou ao teto`,
      [
        `O chatbot ${who} usou ${fmt(extraUsed)} atendimentos a mais em ${month}, ${spent} de excedente, o teto de ${brl2(cap)}. Ele entrou no modo só humano.`,
        "",
        HUMAN_ONLY,
        "",
        `A IA volta no dia 1º do próximo mês, ou na hora se vocês aumentarem o teto ou subirem o tamanho: ${usageUrl}`,
      ],
    ];
  }
  return [
    `${who}: ${level}% do teto do excedente`,
    [
      `O chatbot ${who} já usou ${fmt(extraUsed)} atendimentos a mais em ${month}: ${spent} de excedente, de um teto de ${brl2(cap)}.`,
      "",
      "No teto, ele entra no modo só humano até o mês virar. Para não parar, aumente o teto ou suba o tamanho.",
      "",
      `Uso, excedente e tamanho: ${usageUrl}`,
    ],
  ];
}

/* ------------------------------------------------------------------ leitura */

/** Atendimentos da agência no mês (São Paulo). */
export async function monthAtendimentos(db: SupabaseClient, agencyId: string, period = currentPeriodBR()): Promise<number> {
  const { count } = await db.from("atendimentos").select("id", { count: "exact", head: true }).eq("agency_id", agencyId).gte("started_at", monthStartBR(period).toISOString());
  return count ?? 0;
}

/** Cota e uso do mês de um chatbot. */
export interface BotQuotaStatus {
  botId: string;
  name: string;
  clientId: string | null;
  clientName: string | null;
  size: BotSize | null;
  volumePacks: number | null;
  /** Cota combinada fora da tabela (sob medida). */
  override: number | null;
  quota: number;
  /** Atendimentos do mês dentro da cota. */
  used: number;
  overageEnabled: boolean;
  overageCapBrl: number | null;
  /** Atendimentos a mais (excedente) no mês e quantos cabem no teto. */
  overageUsed: number;
  overageMax: number;
  /** Troca agendada para o dia 1º (descer ou tirar o tamanho): "none" = fica sem tamanho. */
  pendingSize: BotSize | "none" | null;
  pendingVolumePacks: number | null;
}

/**
 * Tamanho, cota e uso do mês de cada chatbot da agência (sem as demos). Service role. A troca
 * agendada que já venceu aparece aplicada (o banco aplica na próxima abertura de atendimento).
 */
export async function botQuotaStatus(db: SupabaseClient, agencyId: string, period = currentPeriodBR()): Promise<BotQuotaStatus[]> {
  const [{ data: bots, error }, { data: counts, error: countError }] = await Promise.all([
    db.from("bots").select("id, name, client_id, client_name, size, volume_packs, quota_override, overage_enabled, overage_cap_brl, pending_size, pending_volume_packs, pending_from, prorated_month, prorated_quota").eq("agency_id", agencyId).eq("is_demo", false).order("created_at"),
    db.rpc("bot_month_atendimentos", { p_agency_id: agencyId, p_month_start: monthStartBR(period).toISOString() }),
  ]);
  if (error) throw new Error(`cota dos chatbots: ${error.message}`);
  if (countError) throw new Error(`atendimentos por chatbot: ${countError.message}`);
  const counted = new Map(((counts ?? []) as Array<{ bot_id: string; total: number | string; overage: number | string }>).map((r) => [r.bot_id, { total: Number(r.total) || 0, overage: Number(r.overage) || 0 }]));
  return (bots ?? []).map((raw) => {
    const due = raw.pending_from && new Date(raw.pending_from as string).getTime() <= Date.now();
    const b = due ? { ...raw, size: raw.pending_size === "none" ? null : raw.pending_size, volume_packs: raw.pending_size === "volume" ? raw.pending_volume_packs : null, pending_size: null, pending_volume_packs: null, prorated_month: null, prorated_quota: null } : raw;
    return {
    botId: b.id as string,
    name: b.name as string,
    clientId: (b.client_id as string | null) ?? null,
    clientName: (b.client_name as string | null) ?? null,
    size: isBotSize(b.size) ? b.size : null,
    volumePacks: (b.volume_packs as number | null) ?? null,
    override: (b.quota_override as number | null) ?? null,
    quota: botQuota(b as { size: string | null; volume_packs: number | null; quota_override: number | null; prorated_month: string | null; prorated_quota: number | null }, period),
    used: (counted.get(b.id as string)?.total ?? 0) - (counted.get(b.id as string)?.overage ?? 0),
    overageEnabled: Boolean(b.overage_enabled),
    overageCapBrl: b.overage_cap_brl === null || b.overage_cap_brl === undefined ? null : Number(b.overage_cap_brl),
    overageUsed: counted.get(b.id as string)?.overage ?? 0,
    overageMax: b.overage_enabled ? overageMax(Number(b.overage_cap_brl)) : 0,
    pendingSize: b.pending_size === "none" ? "none" : isBotSize(b.pending_size) ? b.pending_size : null,
    pendingVolumePacks: (b.pending_volume_packs as number | null) ?? null,
    };
  });
}

/** Atendimentos de cada chatbot no mês passado (com o excedente), para a sugestão de tamanho. */
export async function lastMonthTotals(db: SupabaseClient, agencyId: string, period = currentPeriodBR()): Promise<Map<string, number>> {
  const { data, error } = await db.rpc("bot_month_atendimentos", { p_agency_id: agencyId, p_month_start: monthStartBR(shiftPeriod(period, -1)).toISOString(), p_month_end: monthStartBR(period).toISOString() });
  if (error) throw new Error(`atendimentos do mês passado: ${error.message}`);
  return new Map(((data ?? []) as Array<{ bot_id: string; total: number | string }>).map((r) => [r.bot_id, Number(r.total) || 0]));
}

/** Nome do tamanho para as telas: "P (160 atendimentos)", "Volume (3 pacotes)", "sob medida". */
export function sizeLabel(s: Pick<BotQuotaStatus, "size" | "volumePacks" | "override">): string {
  if (s.override !== null) return "sob medida";
  if (!s.size) return "sem tamanho";
  if (s.size === "volume") return `Volume (${s.volumePacks ?? 0} pacote${s.volumePacks === 1 ? "" : "s"})`;
  return BOT_SIZES[s.size].name;
}

export interface BotMonthUsage {
  botId: string;
  clientId: string | null;
  atendimentos: number;
  messages: number;
  /** Mensagens do WhatsApp cobradas pela Meta, por categoria. */
  metaBilled: Record<string, number>;
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
