import type { SupabaseClient } from "@supabase/supabase-js";
import { campaignAudience, whatsappContactsByPhone, type AudienceContact } from "./contacts";
import type { ReminderRow } from "./reminder-sheet";
import { activeSuppressionsMany, blocks, suppressionScope, type SuppressionKind } from "./suppression";
import { consentStatesMany, type ConsentState } from "./marketing-consent";
import { agesMany, type AgeStatus } from "./gate/age";
import { dictionaryHits, hitSummary } from "./gate/match";
import { CATEGORIES, type GateCategory } from "./gate/rules";
export { REGULATED_ADVICE, renderVariables, variablesProblem, type VariableSpec } from "./campaign-text";

/*
 * Público de uma campanha de marketing (leva B3, parte 4): os contatos do WhatsApp do chatbot por
 * etiquetas ou lista, cada um uma vez, e quem fica de fora e por quê (spec Peça 7, "Montar"):
 * pediu para sair, sem aceite de novidades, menor de idade ou sem 18+ (campanha de bebida ou
 * remédio) e número dos EUA (a Meta não entrega marketing para +1). O motor confere tudo de novo
 * na hora de cada envio; aqui é a prévia e a lista de quem entra.
 */

export type ExclusionReason = "suppressed" | "no_consent" | "minor" | "no_age" | "country" | "no_phone" | "not_contact";

export const EXCLUSION_LABEL: Record<ExclusionReason, string> = {
  no_consent: "sem aceite de novidades",
  suppressed: "pediram para sair (SAIR ou descadastro do WhatsApp)",
  minor: "disseram que não têm 18 anos",
  no_age: "sem 18+ confirmado (campanha de bebida ou remédio)",
  country: "números dos EUA (+1): a Meta não entrega marketing para lá",
  no_phone: "sem telefone (só o nome de usuário do WhatsApp)",
  not_contact: "da lista, mas não são contatos deste chatbot (sem aceite)",
};

/** Por que um contato fica fora de uma campanha de marketing, ou null (entra). Pura. */
export function exclusionOf(o: { phone: string | null; suppressed: SuppressionKind[]; consent: ConsentState; regulated: boolean; age: AgeStatus }): ExclusionReason | null {
  if (!o.phone) return "no_phone";
  if (blocks(o.suppressed, "MARKETING")) return "suppressed";
  if (o.consent !== "granted") return "no_consent";
  // quem disse "não" ao 18+ não entra em campanha nenhuma (spec Peça 7)
  if (o.age === "nao") return "minor";
  if (o.regulated && o.age !== "sim") return "no_age";
  if (o.phone.startsWith("1")) return "country";
  return null;
}

/**
 * O que o texto do modelo (com as variáveis fixas) oferece, pelo dicionário do portão: item
 * proibido (a campanha não sai) ou regulamentado (bebida ou remédio: só para 18+). Pura.
 */
export function templateGate(text: string, exempt: readonly GateCategory[] = []): { prohibited: string[]; regulated: string[] } {
  const s = hitSummary(dictionaryHits(text, { channel: "whatsapp", exempt }));
  return { prohibited: s.proibidos.map((c) => CATEGORIES[c].label), regulated: s.regulamentados.map((c) => CATEGORIES[c].label) };
}

export interface MarketingAudience {
  included: Array<AudienceContact & { phone: string }>;
  excluded: Partial<Record<ExclusionReason, number>>;
  truncated: boolean;
}

/** Monta o público: etiquetas (qualquer uma) e/ou telefones, com as exclusões contadas por motivo. */
export async function buildMarketingAudience(db: SupabaseClient, o: { botId: string; wabaId: string | null; tags: string[]; phones: string[]; regulated: boolean }): Promise<MarketingAudience> {
  const { contacts, unknownPhones, truncated } = await campaignAudience(db, o.botId, { tags: o.tags, phones: o.phones });
  const phones = contacts.map((c) => c.phone).filter((p): p is string => Boolean(p));
  const scope = suppressionScope({ wabaId: o.wabaId, botId: o.botId });
  const [suppressed, consents, ages] = await Promise.all([
    activeSuppressionsMany(db, { channel: "whatsapp", scope, contacts: phones }),
    consentStatesMany(db, scope, phones),
    agesMany(db, o.botId, phones),
  ]);
  const excluded: Partial<Record<ExclusionReason, number>> = {};
  const count = (r: ExclusionReason, n = 1) => (excluded[r] = (excluded[r] ?? 0) + n);
  if (unknownPhones.length) count("not_contact", unknownPhones.length);
  const included: MarketingAudience["included"] = [];
  const seenPhones = new Set<string>();
  for (const c of contacts) {
    const reason = exclusionOf({ phone: c.phone, suppressed: c.phone ? (suppressed.get(c.phone) ?? []) : [], consent: c.phone ? (consents.get(c.phone) ?? "none") : "none", regulated: o.regulated, age: c.phone ? (ages.get(c.phone) ?? null) : null });
    if (reason) count(reason);
    // dois contatos com o mesmo telefone (raro): a pessoa recebe uma vez
    else if (!seenPhones.has(c.phone!)) {
      seenPhones.add(c.phone!);
      included.push({ ...c, phone: c.phone! });
    }
  }
  return { included, excluded, truncated };
}

/* ------------------------------------------------------------------ lembretes (parte 5) */

export type ReminderExclusion = "suppressed" | "no_declaration";

export const REMINDER_EXCLUSION_LABEL: Record<ReminderExclusion, string> = {
  suppressed: "pediram para sair dos lembretes (SAIR)",
  no_declaration: "nunca falaram com o chatbot, e o cliente ainda não fez a declaração de consentimento para lembretes",
};

/** Por que uma linha de lembrete fica de fora, ou null (entra). Pura. */
export function reminderExclusionOf(o: { suppressed: SuppressionKind[]; declared: boolean; messaged: boolean }): ReminderExclusion | null {
  if (blocks(o.suppressed, "UTILITY")) return "suppressed";
  // sem a declaração do cliente, só quem já mandou mensagem ao chatbot (spec Peça 7)
  if (!o.declared && !o.messaged) return "no_declaration";
  return null;
}

/** As linhas que entram, com o contato quando ele já existe, e as que ficam de fora por motivo. */
export async function buildReminderAudience(db: SupabaseClient, o: { botId: string; wabaId: string | null; rows: ReminderRow[]; declared: boolean }): Promise<{ included: Array<ReminderRow & { contactId: string | null }>; excluded: Partial<Record<ReminderExclusion, number>> }> {
  const phones = [...new Set(o.rows.map((r) => r.phone))];
  const [contacts, suppressed] = await Promise.all([
    whatsappContactsByPhone(db, o.botId, phones),
    activeSuppressionsMany(db, { channel: "whatsapp", scope: suppressionScope({ wabaId: o.wabaId, botId: o.botId }), contacts: phones }),
  ]);
  const included: Array<ReminderRow & { contactId: string | null }> = [];
  const excluded: Partial<Record<ReminderExclusion, number>> = {};
  for (const r of o.rows) {
    const contact = contacts.get(r.phone);
    const reason = reminderExclusionOf({ suppressed: suppressed.get(r.phone) ?? [], declared: o.declared, messaged: Boolean(contact?.messaged) });
    if (reason) excluded[reason] = (excluded[reason] ?? 0) + 1;
    else included.push({ ...r, name: r.name ?? contact?.name ?? null, contactId: contact?.id ?? null });
  }
  return { included, excluded };
}
