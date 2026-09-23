import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { appUrl } from "./utils";

/**
 * Link de conexão do WhatsApp: a agência gera e manda ao cliente, que abre sem conta nem login e
 * conecta o próprio número com o Facebook dele. Vale 7 dias e só para uma conexão. No banco fica
 * só o hash do token. O link é sempre no domínio da plataforma: a Meta só abre o login nos
 * domínios cadastrados no app (o domínio próprio da agência não serve).
 */

export const LINK_DAYS = 7;

/** Canal que o link conecta (a tabela nasceu só para o WhatsApp; hoje serve aos dois). */
export type LinkChannel = "whatsapp" | "instagram";
/** Depois de usado, o link ainda mostra a página de "pronto" (com o passo do cartão) por um tempo. */
const DONE_PAGE_DAYS = 7;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export const connectLinkUrl = (token: string) => appUrl(`/conectar/${token}`);

/** Novo link para o chatbot e o canal; os desse canal ainda não usados deixam de valer. Service role. */
export async function createConnectLink(db: SupabaseClient, botId: string, channel: LinkChannel = "whatsapp"): Promise<{ token: string; url: string; expiresAt: string }> {
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + LINK_DAYS * 86_400_000).toISOString();
  await db.from("whatsapp_connect_links").delete().eq("bot_id", botId).eq("channel", channel).is("used_at", null);
  const { error } = await db.from("whatsapp_connect_links").insert({ token_hash: hashToken(token), bot_id: botId, expires_at: expiresAt, channel });
  if (error) throw new Error("não foi possível criar o link");
  return { token, url: connectLinkUrl(token), expiresAt };
}

export type LinkState = "open" | "used" | "expired";

export interface ResolvedLink {
  state: LinkState;
  channel: LinkChannel;
  botId: string;
  agencyId: string;
  bot: { name: string; client_name: string; is_demo: boolean };
  agency: { name: string; logo_url: string | null; brand_color: string; support_whatsapp: string | null; custom_domain: string | null; custom_domain_verified_at: string | null };
}

/** O link existe? Diz se ainda dá para conectar, se já foi usado (página de "pronto") ou venceu. */
export async function resolveConnectLink(db: SupabaseClient, token: string, now = Date.now()): Promise<ResolvedLink | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const { data: link } = await db.from("whatsapp_connect_links").select("bot_id, expires_at, used_at, channel").eq("token_hash", hashToken(token)).maybeSingle();
  if (!link) return null;
  const { data: bot } = await db.from("bots").select("name, client_name, is_demo, agency_id").eq("id", link.bot_id).maybeSingle();
  if (!bot) return null;
  const { data: agency } = await db.from("agencies").select("name, logo_url, brand_color, support_whatsapp, custom_domain, custom_domain_verified_at").eq("id", bot.agency_id).single();
  return {
    state: linkState(link, now),
    channel: link.channel === "instagram" ? "instagram" : "whatsapp",
    botId: link.bot_id as string,
    agencyId: bot.agency_id as string,
    bot: { name: bot.name, client_name: bot.client_name, is_demo: bot.is_demo },
    agency: agency ?? { name: "", logo_url: null, brand_color: "#1f4e3d", support_whatsapp: null, custom_domain: null, custom_domain_verified_at: null },
  };
}

export function linkState(link: { expires_at: string; used_at: string | null }, now = Date.now()): LinkState {
  if (link.used_at) return now - new Date(link.used_at).getTime() < DONE_PAGE_DAYS * 86_400_000 ? "used" : "expired";
  return new Date(link.expires_at).getTime() > now ? "open" : "expired";
}

/** Marca o link como usado (só uma conexão por link). Service role. */
export async function markConnectLinkUsed(db: SupabaseClient, token: string) {
  await db.from("whatsapp_connect_links").update({ used_at: new Date().toISOString() }).eq("token_hash", hashToken(token)).is("used_at", null);
}
