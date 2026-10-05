import type { SupabaseClient } from "@supabase/supabase-js";
import { SENSITIVE_DAYS, effectiveRetention, retentionLabel, retentionReduced } from "./retention";

/*
 * Modo dados sensíveis por chatbot (leva S): as conversas saem num prazo curto (7 a 90 dias). Liga
 * o cliente (área do cliente, gestor) ou a agência (painel, dono e administrador): a mesma regra
 * nos dois lados. Encurtar o prazo pede confirmação, porque a limpeza diária apaga sem desfazer.
 */

export interface SensitiveChange {
  name: string;
  on: boolean;
  days: number;
  /** prazo que vale para as conversas deste chatbot, depois da mudança */
  afterLabel: string;
  before: { sensitive_mode: boolean; sensitive_retention_days: number | null };
  /** ligou ou desligou */
  toggled: boolean;
  /** o prazo ficou mais curto (o outro lado recebe aviso) */
  reduced: boolean;
}

export async function applySensitiveMode(
  db: SupabaseClient,
  o: { botId: string; on: boolean; days: number; confirmed: boolean; clientMonths: number | null; agencyMonths: number | null },
): Promise<{ ok: true; change: SensitiveChange } | { ok: false; message: string }> {
  const { data: bot } = await db.from("bots").select("name, sensitive_mode, sensitive_retention_days").eq("id", o.botId).maybeSingle();
  if (!bot) return { ok: false, message: "Assistente não encontrado." };
  const days = o.on ? ((SENSITIVE_DAYS as readonly number[]).includes(o.days) ? o.days : null) : (bot.sensitive_retention_days as number);
  if (days === null) return { ok: false, message: `Escolha o prazo: ${SENSITIVE_DAYS.join(", ").replace(/, (\d+)$/, " ou $1")} dias.` };
  const base = { isDemo: false, clientMonths: o.clientMonths, agencyMonths: o.agencyMonths };
  const before = effectiveRetention({ ...base, sensitiveMode: Boolean(bot.sensitive_mode), sensitiveDays: bot.sensitive_retention_days as number }).days;
  const after = effectiveRetention({ ...base, sensitiveMode: o.on, sensitiveDays: days }).days;
  const reduced = retentionReduced(before, after);
  if (reduced && !o.confirmed) return { ok: false, message: `Para encurtar o prazo, marque a confirmação: as conversas deste assistente com mais de ${retentionLabel(after)} são apagadas na próxima limpeza diária.` };
  const { error } = await db.from("bots").update({ sensitive_mode: o.on, sensitive_retention_days: days }).eq("id", o.botId);
  if (error) return { ok: false, message: "Não foi possível salvar. Tente de novo." };
  return {
    ok: true,
    change: {
      name: bot.name as string,
      on: o.on,
      days,
      afterLabel: retentionLabel(after),
      before: { sensitive_mode: Boolean(bot.sensitive_mode), sensitive_retention_days: (bot.sensitive_retention_days as number | null) ?? null },
      toggled: o.on !== Boolean(bot.sensitive_mode),
      reduced,
    },
  };
}

/** O que mudou, em uma frase para o e-mail do outro lado. Pura. */
export const sensitiveChangeText = (c: SensitiveChange) =>
  c.on ? `ligou o modo dados sensíveis do assistente ${c.name}: as conversas dele passam a ser apagadas depois de ${c.days} dias` : `desligou o modo dados sensíveis do assistente ${c.name}: as conversas voltam ao prazo de ${c.afterLabel}`;

/** Mensagem de sucesso na tela. Pura. */
export const sensitiveSavedText = (c: SensitiveChange) =>
  c.on ? `Modo dados sensíveis ligado: as conversas de ${c.name} ficam ${c.days} dias.` : `Modo dados sensíveis desligado: vale o prazo de ${c.afterLabel}.`;
