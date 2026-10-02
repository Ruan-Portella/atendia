import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * IA pausada pelo backoffice: a chave geral (todas as agências, emergência) ou a pausa desta
 * agência. Na dúvida (erro ao ler), não pausa: a pausa é decisão explícita de alguém.
 */
export async function isAiPaused(db: SupabaseClient, agencyId: string): Promise<boolean> {
  const [{ data: flags }, { data: agency }] = await Promise.all([
    db.from("platform_flags").select("ai_paused_at").eq("id", 1).maybeSingle(),
    db.from("agencies").select("ai_paused_at").eq("id", agencyId).maybeSingle(),
  ]);
  return Boolean(flags?.ai_paused_at || agency?.ai_paused_at);
}

/** Avisos do topo do painel da agência: IA pausada, WhatsApp desligado, canal suspenso, ordem da Meta. */
export async function panelNotices(db: SupabaseClient, agencyId: string) {
  const [{ data: flags }, { data: agency }, { data: measures }] = await Promise.all([
    db.from("platform_flags").select("ai_paused_at, whatsapp_disabled_at").eq("id", 1).maybeSingle(),
    db.from("agencies").select("ai_paused_at").eq("id", agencyId).maybeSingle(),
    db.from("enforcement_actions").select("source, channel").eq("agency_id", agencyId).eq("feature", "channel").is("lifted_at", null),
  ]);
  const active = (measures ?? []) as Array<{ source: string; channel: string }>;
  return {
    aiPaused: Boolean(flags?.ai_paused_at || agency?.ai_paused_at),
    whatsappDisabled: Boolean(flags?.whatsapp_disabled_at),
    /** Canais suspensos pela BoaVoz (whatsapp, instagram, widget ou all). */
    suspended: [...new Set(active.filter((m) => m.source === "boavoz").map((m) => m.channel))],
    metaOrder: active.some((m) => m.source === "meta_order"),
  };
}
