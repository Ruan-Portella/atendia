import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyAgencyOwner } from "./notify";
import { appUrl } from "./utils";
import { audit } from "./audit";

/*
 * Ordens, infrações e restrições que a Meta manda no webhook account_update viram medidas em
 * enforcement_actions (lidas pela regra de estado, conversation-mode):
 *   DISABLED_UPDATE DISABLE              → meta_order, bloqueia o número (nada entra nem sai)
 *   DISABLED_UPDATE SCHEDULE_FOR_DISABLE → meta_order "outro": só registro e aviso (ainda funciona)
 *   DISABLED_UPDATE REINSTATE            → levanta as ordens ativas da conta
 *   ACCOUNT_VIOLATION                    → meta_violation: bebida/remédio em "regulados", o resto "outro" (só registro)
 *   ACCOUNT_RESTRICTION                  → meta_restriction "restricao" (só registro por enquanto)
 */

export interface MetaAccountDetail {
  ban_info?: { waba_ban_state?: string; waba_ban_date?: string };
  violation_info?: { violation_type?: string };
  restriction_info?: Array<{ restriction_type?: string; expiration?: string | number }>;
  /** PARTNER_REMOVED: motivo e quem iniciou a remoção. */
  disconnection_info?: { reason?: string; initiated_by?: string };
}

export type MetaMeasure = {
  source: "meta_order" | "meta_violation" | "meta_restriction";
  feature: "channel" | "regulados" | "restricao" | "outro";
  reason: string;
};

/** Infração ligada a bebida, remédio ou tabaco: a mesma área do portão de regulados. */
const REGULATED_VIOLATION = /ALCOHOL|DRUG|HEALTH|MEDIC|PHARMA|TOBACCO|SUPPLEMENT/i;

/** O que o evento quer dizer: medida nova, levantar a ordem, ou nada. Função pura. */
export function metaMeasureFor(event: string, detail: MetaAccountDetail): MetaMeasure | "reinstate" | null {
  if (event === "DISABLED_UPDATE") {
    const state = detail.ban_info?.waba_ban_state ?? "";
    if (state === "DISABLE") return { source: "meta_order", feature: "channel", reason: "a Meta desativou a conta do WhatsApp" };
    if (state === "SCHEDULE_FOR_DISABLE") return { source: "meta_order", feature: "outro", reason: `a Meta agendou a desativação da conta${detail.ban_info?.waba_ban_date ? ` para ${detail.ban_info.waba_ban_date}` : ""}` };
    if (state === "REINSTATE") return "reinstate";
    return null;
  }
  if (event === "ACCOUNT_VIOLATION") {
    const type = detail.violation_info?.violation_type ?? "não informada";
    return { source: "meta_violation", feature: REGULATED_VIOLATION.test(type) ? "regulados" : "outro", reason: `infração na Meta: ${type}` };
  }
  if (event === "ACCOUNT_RESTRICTION") {
    const types = (detail.restriction_info ?? []).map((r) => r.restriction_type).filter(Boolean).join(", ");
    return { source: "meta_restriction", feature: "restricao", reason: `restrição da Meta${types ? `: ${types}` : ""}` };
  }
  return null;
}

/** Grava a medida (uma vez por motivo enquanto ativa) e avisa a agência; REINSTATE levanta as ordens. */
export async function recordMetaEnforcement(db: SupabaseClient, input: { event: string; wabaId: string; detail: MetaAccountDetail }) {
  const measure = metaMeasureFor(input.event, input.detail);
  if (!measure) return;
  if (measure === "reinstate") {
    const { data } = await db.from("enforcement_actions").update({ lifted_at: new Date().toISOString(), lifted_by: "meta" }).eq("source", "meta_order").eq("waba_id", input.wabaId).is("lifted_at", null).select("id");
    if (data?.length) {
      console.warn("whatsapp: Meta reativou a conta", input.wabaId);
      await audit(db, { agencyId: null, actorType: "system", actorId: "meta", action: "meta.levantar_ordem", targetType: "waba", targetId: input.wabaId });
    }
    return;
  }

  const { data: channels } = await db.from("whatsapp_channels").select("bot_id, display_phone, bots(name, client_name, agency_id)").eq("waba_id", input.wabaId);
  const first = channels?.[0];
  const bot = (Array.isArray(first?.bots) ? first.bots[0] : first?.bots) as { name: string; client_name: string; agency_id: string } | null | undefined;
  const { data: same } = await db.from("enforcement_actions").select("id").eq("source", measure.source).eq("feature", measure.feature).eq("waba_id", input.wabaId).eq("reason", measure.reason).is("lifted_at", null).limit(1);
  if (same?.length) return;
  await db.from("enforcement_actions").insert({
    source: measure.source,
    feature: measure.feature,
    channel: "whatsapp",
    agency_id: bot?.agency_id ?? null,
    bot_id: channels?.length === 1 ? first!.bot_id : null,
    waba_id: input.wabaId,
    reason: measure.reason,
    detail: { event: input.event, ...input.detail },
    created_by: "meta",
  });
  console.warn("whatsapp: medida da Meta", input.wabaId, measure);
  await audit(db, { agencyId: bot?.agency_id ?? null, actorType: "system", actorId: "meta", action: "meta.medida", targetType: "waba", targetId: input.wabaId, after: { ...measure } });
  if (!bot) return;

  const blocks = measure.feature === "channel";
  await notifyAgencyOwner(db, bot.agency_id, `WhatsApp de ${bot.client_name}: ${measure.reason}`, [
    `A Meta mandou um aviso sobre a conta do WhatsApp de ${bot.client_name} (${bot.name}${first?.display_phone ? ` · ${first.display_phone}` : ""}): ${measure.reason}.`,
    "",
    blocks
      ? "Enquanto a ordem estiver ativa, nada entra nem sai por esse número no BoaVoz. As conversas antigas continuam no painel."
      : "Por enquanto o número continua funcionando. Confira o aviso no Gerenciador do WhatsApp da Meta.",
    "",
    `Painel: ${appUrl(`/painel/bots/${first!.bot_id}?tab=whatsapp`)}`,
  ]).catch(() => false);
}
