import type { SupabaseClient } from "@supabase/supabase-js";

export interface CampaignBotOption {
  id: string;
  name: string;
  clientName: string;
}

/**
 * Os chatbots que podem mandar campanha: do escopo de quem está logado (a RLS), fora as demos, com o
 * WhatsApp conectado a uma conta da Meta. Com `clientId`, só os daquele cliente. Usado pela tela Nova
 * campanha e pelo painel lateral da lista (redesenho, etapa 5).
 */
export async function campaignBotOptions(supabase: SupabaseClient, admin: SupabaseClient, clientId?: string | null): Promise<CampaignBotOption[]> {
  let q = supabase.from("bots").select("id, name, client_name").eq("is_demo", false).order("name");
  if (clientId) q = q.eq("client_id", clientId);
  const { data: bots } = await q;
  const ids = (bots ?? []).map((b) => b.id as string);
  const { data: channels } = ids.length ? await admin.from("whatsapp_channels").select("bot_id").in("bot_id", ids).is("disconnected_at", null).not("waba_id", "is", null) : { data: [] };
  const connected = new Set((channels ?? []).map((c) => c.bot_id as string));
  return (bots ?? []).filter((b) => connected.has(b.id as string)).map((b) => ({ id: b.id as string, name: b.name as string, clientName: (b.client_name as string | null) ?? "" }));
}
