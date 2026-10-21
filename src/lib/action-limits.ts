import type { SupabaseClient } from "@supabase/supabase-js";
import { firstExceeded } from "./rate-limit";
import { botQuota, type BotQuotaFields } from "./quota";
import { notifyAgencyOwner } from "./notify";
import { appUrl, currentPeriodBR } from "./utils";

/*
 * Os tetos das chamadas de ação (spec, Tetos de chamadas; itens menores da conferência de 20/10,
 * parte 2), iguais na IA, nos botões e nos passos de roteiro: 15 por minuto por conversa, 600 por
 * minuto por chatbot (só contra abuso) e, no mês, 10 vezes a cota do chatbot (no mínimo 1.000, para
 * o teste e as demos). No teto do chatbot, o dono recebe aviso no painel (na aba Ações) e por
 * e-mail: o do minuto, no máximo um por dia; o do mês, um por mês.
 */

export const ACTION_PER_CONVERSATION_MINUTE = 15;
export const ACTION_PER_BOT_MINUTE = 600;
export const ACTION_MONTH_MULTIPLIER = 10;
export const ACTION_MONTH_FLOOR = 1_000;

export type ActionLimitHit = "conversa" | "bot_minuto" | "mes";

/** O teto do mês do chatbot: 10 vezes a cota (no mínimo 1.000). Pura. */
export const monthlyActionCap = (bot: BotQuotaFields, period = currentPeriodBR()) => Math.max(ACTION_MONTH_FLOOR, ACTION_MONTH_MULTIPLIER * botQuota(bot, period));

/** O que a IA recebe em cada teto. */
export const LIMIT_OUTPUT: Record<ActionLimitHit, { ok: false; motivo: string; instrucao: string }> = {
  conversa: { ok: false, motivo: "rate_limited", instrucao: "Diga que são muitas consultas seguidas e peça para tentar de novo em um minuto." },
  bot_minuto: { ok: false, motivo: "rate_limited", instrucao: "Diga que são muitas consultas seguidas e peça para tentar de novo em um minuto." },
  mes: { ok: false, motivo: "limite_mensal", instrucao: "Diga que essa consulta está indisponível no momento e ofereça chamar alguém da equipe." },
};

/** O aviso da aba Ações: o teto do minuto nas últimas 24 horas, ou o do mês neste mês. Pura. */
export function actionCapNotice(bot: { action_cap_hit_at?: string | null; action_cap_kind?: string | null }, now = new Date()): string | null {
  if (!bot.action_cap_hit_at || !bot.action_cap_kind) return null;
  const at = new Date(bot.action_cap_hit_at);
  const when = at.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  if (bot.action_cap_kind === "minuto" && now.getTime() - at.getTime() < 86_400_000) return `Em ${when}, este chatbot bateu o teto de ${ACTION_PER_BOT_MINUTE} chamadas de ação por minuto: as consultas a mais voltaram "tente de novo em um minuto". Se o movimento é real, fale com o suporte.`;
  if (bot.action_cap_kind === "mes" && currentPeriodBR(at) === currentPeriodBR(now)) return `Em ${when}, este chatbot chegou ao teto de chamadas de ação do mês (10 vezes a cota): até o dia 1º, a IA não chama as ações e oferece a equipe. Para aumentar, suba o tamanho em Cobrança.`;
  return null;
}

/** O e-mail ao dono quando o chatbot bate um teto. Pura. */
export function actionCapEmail(kind: "minuto" | "mes", bot: { name: string; clientName: string | null }, cap: number, url: string): [string, string[]] {
  const who = bot.clientName ? `${bot.name} (${bot.clientName})` : bot.name;
  if (kind === "minuto") {
    return [
      `O chatbot ${who} bateu o teto de chamadas de ação por minuto`,
      [
        `O chatbot ${who} chegou a ${ACTION_PER_BOT_MINUTE} chamadas de ação num minuto. As consultas a mais voltaram com "muitas consultas seguidas, tente de novo em um minuto" para os contatos.`,
        "",
        "Se o movimento é real, fale com o suporte para aumentar o teto. Se não, pode ser um ataque ao chat do site ou uma integração chamando sem parar.",
        "",
        `Ver as ações do chatbot: ${url}`,
      ],
    ];
  }
  return [
    `O chatbot ${who} chegou ao teto de chamadas de ação do mês`,
    [
      `O chatbot ${who} fez ${cap.toLocaleString("pt-BR")} chamadas de ação neste mês (10 vezes a cota dele). Até o dia 1º, a IA deixa de chamar as ações desse chatbot e oferece a equipe quando precisar delas.`,
      "",
      "Para aumentar, suba o tamanho do chatbot em Cobrança ou fale com o suporte.",
      "",
      `Ver as ações do chatbot: ${url}`,
    ],
  ];
}

/** Guarda o teto batido (o aviso da aba Ações) e avisa o dono uma vez por dia (minuto) ou por mês. */
async function recordCapHit(db: SupabaseClient, botId: string, kind: "minuto" | "mes", cap: number, now: Date): Promise<void> {
  const { data: b } = await db.from("bots").select("agency_id, name, client_name, action_cap_hit_at, action_cap_kind").eq("id", botId).maybeSingle();
  if (!b) return;
  const prev = (b.action_cap_hit_at as string | null) ?? null;
  const sameMonth = prev ? new Date(prev).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 7) === currentPeriodBR(now) : false;
  const recent = kind === "mes" ? b.action_cap_kind === "mes" && sameMonth : Boolean(prev) && now.getTime() - Date.parse(prev!) < 86_400_000 && b.action_cap_kind === "minuto";
  if (recent) return;
  await db.from("bots").update({ action_cap_hit_at: now.toISOString(), action_cap_kind: kind }).eq("id", botId);
  const [subject, lines] = actionCapEmail(kind, { name: b.name as string, clientName: (b.client_name as string | null) ?? null }, cap, appUrl(`/painel/bots/${botId}?tab=acoes`));
  await notifyAgencyOwner(db, b.agency_id as string, subject, lines).catch(() => false);
}

/**
 * Confere os tetos antes de uma chamada de ação (conta a chamada). null: pode chamar. O teto do mês
 * só é contado quando os do minuto passam.
 */
export async function checkActionLimits(db: SupabaseClient, i: { botId: string; conversationId: string }, now = new Date()): Promise<ActionLimitHit | null> {
  const minute = await firstExceeded(db, [
    { key: `acao:${i.conversationId}:m`, max: ACTION_PER_CONVERSATION_MINUTE, windowSeconds: 60, message: "conversa" },
    { key: `acao:bot:${i.botId}:m`, max: ACTION_PER_BOT_MINUTE, windowSeconds: 60, message: "bot_minuto" },
  ]);
  if (minute) {
    if (minute.message === "bot_minuto") await recordCapHit(db, i.botId, "minuto", ACTION_PER_BOT_MINUTE, now).catch((e) => console.error("ações: aviso do teto", (e as Error).message));
    return minute.message as ActionLimitHit;
  }
  const { data: bot } = await db.from("bots").select("size, volume_packs, quota_override, prorated_month, prorated_quota").eq("id", i.botId).maybeSingle();
  const cap = monthlyActionCap((bot ?? { size: null }) as BotQuotaFields, currentPeriodBR(now));
  const { data: within, error } = await db.rpc("hit_action_month", { p_bot_id: i.botId, p_cap: cap });
  if (error) {
    // falha nossa não para a ação
    console.error("ações: teto do mês não conferido", error.message);
    return null;
  }
  if (within === false) {
    await recordCapHit(db, i.botId, "mes", cap, now).catch((e) => console.error("ações: aviso do teto", (e as Error).message));
    return "mes";
  }
  return null;
}
