import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";
import { hmacHex } from "./hash";
import { ANSWERS_PER_ATENDIMENTO, BOT_SIZES, OVERAGE_PRICE_BRL, brlCents as brl2, isBotSize, type BotSize } from "./plans";
import { SIZE_QUOTAS, botQuota, overageAlertLevel, overageMax, quotaAlertLevel, type QuotaLevel } from "./quota";
import { notifyAgencyOwner } from "./notify";
import { appUrl, currentPeriodBR, monthStartBR } from "./utils";
import { periodLabel, shiftPeriod } from "./report";
import { OVERAGE_PRICE_CENTS, afterCreditUse, creditBalance } from "./billing-credit";
import { emitOverageCapWarning, emitOverageChanged, emitOverageStarted, emitQuotaReached, emitQuotaWarning, type UsageSnapshot } from "./billing-events";

export { ATENDIMENTO_DEFINITION, botQuota, overageAlertLevel, overageMax, quotaAlertLevel, quotaPhase, suggestSize } from "./quota";

/*
 * Cota por atendimento, por chatbot (spec "Limites por plano"). A abertura (open_atendimento,
 * migração 0094) acontece antes de cada resposta da IA, sob a trava do contato: o atendimento
 * aberto há menos de 24 horas soma uma resposta, até 40; depois disso (ou sem atendimento aberto),
 * confere a cota do mês do chatbot e abre outro. Sem vaga na cota, com o excedente ligado, abre um
 * atendimento a mais pago com o crédito pré-pago da conta (migração 0098), até o teto opcional do
 * chatbot. Sem vaga (ou sem crédito, ou com o excedente suspenso por pico no widget), o chamador
 * entra no modo só humano, e só aquele chatbot para. Não contam: o teste ao vivo do painel, as demos e as avaliações.
 */

export type AtendimentoChannel = "widget" | "whatsapp" | "instagram";

/** Por que não abriu: a cota do mês do chatbot acabou (sem excedente, no teto, sem crédito ou com o excedente suspenso). */
export type AtendimentoBlock = "quota_exceeded";

/** Chave do contato em hash (HMAC): ficha do contato no WhatsApp e no Instagram, visitor_id no widget. */
export const contactKeyHash = (channel: AtendimentoChannel, key: string) => hmacHex(`atendimento:${channel}:${key}`);

export interface OpenRow {
  status: "aberto" | "novo" | "excedente" | "cota" | "teto" | "sem_credito" | "suspenso" | "pico";
  atendimento_id: number | null;
  used: number | null;
  quota: number | null;
  overage_on: boolean | null;
  overage_used: number | null;
  /** Atendimentos a mais que cabem no teto do chatbot (sem teto, null). */
  overage_max: number | null;
  /** Saldo do crédito depois do desconto (só no excedente e sem crédito). */
  credit_left: number | null;
}

const STOPPED = new Set(["cota", "teto", "sem_credito", "suspenso", "pico"]);

/** Depois da resposta (after do Next); fora de uma requisição, roda solto. */
function inBackground(fn: () => Promise<unknown>) {
  try {
    after(fn);
  } catch {
    void fn().catch(() => undefined);
  }
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
  if (STOPPED.has(row.status)) {
    if (row.status === "pico") inBackground(() => notifySpike(db, bot, row).catch((e) => console.error("atendimento: aviso de pico", e)));
    // crédito acabou: bot.quota_reached (um por dia e chatbot; o crédito pode voltar e acabar de novo)
    if (row.status === "sem_credito") {
      inBackground(async () => emitQuotaReached(db, bot.id, "sem_credito", await usageSnapshot(db, bot.id, row), new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" })).catch((e) => console.error("atendimento: webhook sem crédito", e)));
    }
    return { blocked: "quota_exceeded", isNew: false, id: null, overage: false };
  }
  if (row.status === "novo" || row.status === "excedente") {
    // avisos da cota (80%, 95%, 100%) e do teto do excedente (80%, 95%, teto): o contador sobe de
    // 1 em 1 sob a trava, então cada um sai uma vez por mês
    inBackground(() => notifyQuotaLevel(db, bot, row).catch((e) => console.error("atendimento: aviso de cota", e)));
  }
  // crédito: saldo baixo, acabou e a recarga automática
  if (row.status === "excedente" && row.credit_left !== null) inBackground(() => afterCreditUse(db, bot.agency_id, row.credit_left!));
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

/** O uso do mês como os webhooks mandam, a partir da abertura do atendimento. Função pura. */
export function snapshotOf(row: Pick<OpenRow, "used" | "quota" | "overage_on" | "overage_used" | "overage_max">, capBrl: number | null, period = currentPeriodBR()): UsageSnapshot {
  return { month: period, used: row.used ?? 0, quota: row.quota ?? 0, overage: { enabled: Boolean(row.overage_on), used: row.overage_used ?? 0, capBrl, max: row.overage_max ?? null } };
}

async function usageSnapshot(db: SupabaseClient, botId: string, row: OpenRow): Promise<UsageSnapshot> {
  const { data: b } = await db.from("bots").select("overage_cap_brl").eq("id", botId).maybeSingle();
  return snapshotOf(row, b?.overage_cap_brl === null || b?.overage_cap_brl === undefined ? null : Number(b.overage_cap_brl));
}

/**
 * Avisos da cota e do excedente, por e-mail ao dono e pelos webhooks (bot.quota_warning,
 * bot.quota_reached, bot.overage_started e bot.overage_cap_warning).
 */
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
      email = botQuotaEmail(level, b, row.used, row.quota, month, usage, row.overage_on ? { capBrl: b.cap || null, creditCents: await creditBalance(db, bot.agency_id) } : null);
      const u = snapshotOf(row, b.cap || null);
      // cota cheia: sem o excedente, o chatbot parou; com ele, o webhook sai no primeiro atendimento a mais
      if (level !== 100) await emitQuotaWarning(db, bot.id, level, u);
      else if (!row.overage_on) await emitQuotaReached(db, bot.id, "cota", u);
      // aviso no WhatsApp do dono (95% e a cota cheia que para o chatbot), pelo assistente da BoaVoz
      if (level === 95 || (level === 100 && !row.overage_on)) {
        const { botTitle, sendTeamNotice } = await import("./team-notices");
        await sendTeamNotice(db, { kind: "cota", agencyId: bot.agency_id, botId: bot.id, vars: [botTitle({ name: b.name, client_name: b.clientName }), `${level}%`], path: "painel/cobranca/uso", ref: `${bot.id}:${currentPeriodBR()}:${level}` });
      }
    }
  } else if (row.status === "excedente" && row.overage_used !== null) {
    const level = row.overage_max !== null ? overageAlertLevel(row.overage_used, row.overage_max) : null;
    if (level || row.overage_used === 1) {
      const b = await who();
      const u = snapshotOf(row, b.cap || null);
      if (row.overage_used === 1) await emitOverageStarted(db, bot.id, u);
      if (level) {
        email = botOverageEmail(level, b, row.overage_used, b.cap, month, usage);
        if (level === "teto") await emitQuotaReached(db, bot.id, "teto", u);
        else await emitOverageCapWarning(db, bot.id, level, u);
      }
    }
  }
  if (email) await notifyAgencyOwner(db, bot.agency_id, email[0], email[1]);
}

/** Pico no chat do site: o excedente do chatbot ficou suspenso até o dono confirmar (e-mail e webhooks). */
async function notifySpike(db: SupabaseClient, bot: { id: string; agency_id: string }, row: OpenRow) {
  const { data: b } = await db.from("bots").select("name, client_name, overage_cap_brl").eq("id", bot.id).maybeSingle();
  const capBrl = b?.overage_cap_brl === null || b?.overage_cap_brl === undefined ? null : Number(b.overage_cap_brl);
  const at = new Date().toISOString();
  await emitOverageChanged(db, bot.id, { enabled: true, capBrl, suspended: "pico" }, at);
  await emitQuotaReached(db, bot.id, "excedente_suspenso", snapshotOf(row, capBrl), at);
  const [subject, lines] = spikeEmail({ name: (b?.name as string | undefined) ?? "Chatbot", clientName: (b?.client_name as string | undefined) ?? null }, appUrl("/painel/cobranca/uso"));
  await notifyAgencyOwner(db, bot.agency_id, subject, lines);
}

/** Assunto e texto do aviso de pico no chat do site. Função pura. */
export function spikeEmail(bot: { name: string; clientName: string | null }, usageUrl: string): [string, string[]] {
  const who = bot.clientName ? `${bot.name} (${bot.clientName})` : bot.name;
  return [
    `${who}: pico no chat do site, excedente suspenso`,
    [
      `O chat do site de ${who} recebeu muito mais conversas novas que o normal nas últimas 24 horas (mais de 5 vezes a média da semana). Para um robô não gastar o crédito da conta, o excedente desse chatbot ficou suspenso: com a cota do mês cheia, ele entra no modo só humano.`,
      "",
      `Se for tráfego de verdade (uma campanha, por exemplo), marque "tráfego real" e o excedente volta na hora. Se for ataque, marque "ataque": o excedente fica suspenso até o mês virar. Os dois botões ficam em Uso e custo: ${usageUrl}`,
    ],
  ];
}

const HUMAN_ONLY =
  "No modo só humano, a IA desse chatbot não responde a quem começa um atendimento novo: as mensagens do WhatsApp e do Instagram chegam em Conversas para a sua equipe responder, e o chat do site mostra um formulário de contato. Quem já estava sendo atendido segue até completar 24 horas ou 40 respostas. Os outros chatbots continuam normais.";

/**
 * Assunto e texto do aviso de cota de um chatbot. `overage`: o excedente ligado (a cota cheia não
 * para o chatbot), com o teto opcional e o saldo do crédito da conta. Função pura.
 */
export function botQuotaEmail(level: QuotaLevel, bot: { name: string; clientName: string | null }, used: number, quota: number, month: string, usageUrl: string, overage: { capBrl: number | null; creditCents: number } | null = null): [string, string[]] {
  const who = bot.clientName ? `${bot.name} (${bot.clientName})` : bot.name;
  if (overage) {
    const credit = brl2(overage.creditCents / 100);
    const cap = overage.capBrl ? ` O teto do mês deste chatbot é ${brl2(overage.capBrl)} (${fmt(overageMax(overage.capBrl))} atendimentos a mais).` : "";
    const each = `cada atendimento a mais usa ${brl2(OVERAGE_PRICE_BRL)} do crédito da conta (saldo: ${credit})`;
    if (level === 100) {
      return [
        `${who}: a cota do mês acabou e o excedente começou`,
        [
          `O chatbot ${who} chegou aos ${fmt(quota)} atendimentos de ${month}. O excedente está ligado: ${each}.${cap}`,
          "",
          overage.creditCents < OVERAGE_PRICE_CENTS
            ? "O crédito da conta não paga o próximo atendimento a mais: compre crédito, senão o chatbot entra no modo só humano."
            : "Sem crédito (ou no teto), o chatbot entra no modo só humano até o mês virar.",
          "",
          `Uso, excedente e tamanho: ${usageUrl}`,
        ],
      ];
    }
    return [
      `${who}: ${level}% dos atendimentos do mês`,
      [`O chatbot ${who} já fez ${fmt(used)} de ${fmt(quota)} atendimentos em ${month}.`, "", `O excedente está ligado: passando da cota, ${each}.${cap}`, "", `Uso do mês por chatbot: ${usageUrl}`],
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
  /** Atendimentos a mais (excedente) no mês e até quantos dá para chegar (teto e crédito). */
  overageUsed: number;
  overageMax: number;
  /** Atendimentos a mais que o teto do chatbot permite (sem teto, null). */
  overageCapMax: number | null;
  /** Excedente suspenso: pico no widget (até o dono confirmar) ou ataque (até o mês virar). */
  overageSuspended: "pico" | "ataque" | null;
  /** O crédito da conta não paga o próximo atendimento a mais. */
  creditShort: boolean;
  /** Troca agendada para o dia 1º (descer ou tirar o tamanho): "none" = fica sem tamanho. */
  pendingSize: BotSize | "none" | null;
  pendingVolumePacks: number | null;
}

/**
 * Tamanho, cota e uso do mês de cada chatbot da agência (sem as demos). Service role. A troca
 * agendada que já venceu aparece aplicada (o banco aplica na próxima abertura de atendimento).
 */
export async function botQuotaStatus(db: SupabaseClient, agencyId: string, period = currentPeriodBR()): Promise<BotQuotaStatus[]> {
  const [{ data: bots, error }, { data: counts, error: countError }, credit] = await Promise.all([
    db.from("bots").select("id, name, client_id, client_name, size, volume_packs, quota_override, overage_enabled, overage_cap_brl, overage_suspended_reason, overage_suspended_until, pending_size, pending_volume_packs, pending_from, prorated_month, prorated_quota").eq("agency_id", agencyId).eq("is_demo", false).eq("is_template", false).order("created_at"),
    db.rpc("bot_month_atendimentos", { p_agency_id: agencyId, p_month_start: monthStartBR(period).toISOString() }),
    creditBalance(db, agencyId),
  ]);
  const creditFits = Math.floor(credit / OVERAGE_PRICE_CENTS);
  if (error) throw new Error(`cota dos chatbots: ${error.message}`);
  if (countError) throw new Error(`atendimentos por chatbot: ${countError.message}`);
  const counted = new Map(((counts ?? []) as Array<{ bot_id: string; total: number | string; overage: number | string }>).map((r) => [r.bot_id, { total: Number(r.total) || 0, overage: Number(r.overage) || 0 }]));
  return (bots ?? []).map((raw) => {
    const due = raw.pending_from && new Date(raw.pending_from as string).getTime() <= Date.now();
    const b = due ? { ...raw, size: raw.pending_size === "none" ? null : raw.pending_size, volume_packs: raw.pending_size === "volume" ? raw.pending_volume_packs : null, pending_size: null, pending_volume_packs: null, prorated_month: null, prorated_quota: null } : raw;
    const extra = counted.get(b.id as string)?.overage ?? 0;
    const capMax = b.overage_cap_brl === null || b.overage_cap_brl === undefined ? null : overageMax(Number(b.overage_cap_brl));
    // "ataque" vencido (o mês virou) já não vale; o banco limpa na próxima abertura
    const attackOver = b.overage_suspended_reason === "ataque" && b.overage_suspended_until && new Date(b.overage_suspended_until as string).getTime() <= Date.now();
    const suspended = !attackOver && (b.overage_suspended_reason === "pico" || b.overage_suspended_reason === "ataque") ? (b.overage_suspended_reason as "pico" | "ataque") : null;
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
    overageUsed: extra,
    overageMax: b.overage_enabled && !suspended ? Math.min(capMax ?? Number.MAX_SAFE_INTEGER, extra + creditFits) : extra,
    overageCapMax: capMax,
    overageSuspended: suspended,
    creditShort: Boolean(b.overage_enabled) && creditFits === 0,
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
  /** Contatos que receberam campanha ou lembrete no mês (não contam na cota). */
  campaignContacts: number;
}

/** Uso do mês por chatbot (Cobrança → Uso e custo e GET /v1/usage), sem os modelos. Service role; quem chama já conferiu a agência. */
export async function agencyMonthUsage(db: SupabaseClient, agencyId: string, period = currentPeriodBR()): Promise<BotMonthUsage[]> {
  const { data, error } = await db.rpc("agency_month_usage", { p_agency_id: agencyId, p_month_start: monthStartBR(period).toISOString(), p_period: period, p_month_end: monthStartBR(shiftPeriod(period, 1)).toISOString() });
  if (error) throw new Error(`uso do mês: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    botId: r.bot_id as string,
    clientId: (r.client_id as string | null) ?? null,
    atendimentos: Number(r.atendimentos) || 0,
    messages: Number(r.messages) || 0,
    metaBilled: Object.fromEntries(Object.entries((r.meta_billed as Record<string, unknown>) ?? {}).map(([k, v]) => [k, Number(v) || 0])),
    campaignContacts: Number(r.campaign_contacts) || 0,
  }));
}
