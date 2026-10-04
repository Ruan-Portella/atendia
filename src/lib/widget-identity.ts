import type { SupabaseClient } from "@supabase/supabase-js";
import { contextHashOf, verifyIdentityToken, type IdentityBot, type IdentityClaims, type TokenProblem } from "./identity";
import { externalIdHash, widgetUserContact } from "./contacts";
import { sealField } from "./field-cipher";

/*
 * Identidade nas rotas do widget (/api/chat, /history, /updates, /handoff): o token vem no
 * cabeçalho Authorization e é conferido em toda requisição. A conversa de nível usuário fica
 * presa à pessoa (identity_hash) e ao contexto (context_hash): só volta com um token da mesma
 * pessoa e do mesmo contexto. Uma conversa anônima pode subir para usuário uma vez (o mesmo
 * navegador, com o primeiro token); uma de usuário nunca troca de identidade nem de contexto.
 * Teste de aceite: a pessoa A conversa, a pessoa B entra no mesmo navegador sem logout, e nada
 * de A aparece.
 */

export type WidgetWho =
  | { kind: "anon" }
  | { kind: "invalid"; problem: TokenProblem }
  | { kind: "token"; claims: IdentityClaims; identityHash: string | null; contextHash: string | null; contactId: string | null };

/** Cabeçalhos CORS das rotas do widget (o token vai no Authorization). */
export const WIDGET_ALLOW_HEADERS = "Content-Type, Authorization";

export const bearerOf = (req: Request) => {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.get("authorization") ?? "");
  return m ? m[1] : null;
};

/** Quem está falando: anônimo, token inválido (o widget pede outro uma vez) ou identificado. */
export async function widgetWho(db: SupabaseClient, bot: IdentityBot, req: Request): Promise<WidgetWho> {
  const token = bearerOf(req);
  if (!token) return { kind: "anon" };
  const v = await verifyIdentityToken(db, bot, token);
  if (!v.ok) return { kind: "invalid", problem: v.problem };
  const { claims } = v;
  const contact = claims.externalId ? await widgetUserContact(db, bot, claims.externalId, claims.userDisplay) : null;
  return { kind: "token", claims, identityHash: claims.externalId ? externalIdHash(claims.externalId) : null, contextHash: contextHashOf(claims.context), contactId: contact?.id ?? null };
}

export interface ConversationIdentity {
  visitor_id: string | null;
  identity_hash: string | null;
  context_hash: string | null;
}

/**
 * Esta requisição pode usar esta conversa? Função pura.
 * - ok: pode;
 * - upgrade: conversa anônima do mesmo navegador que este token passa a ser de usuário (uma vez);
 * - denied: outra pessoa, outro contexto ou sem token numa conversa de usuário (o widget abre outra).
 */
export function conversationAccess(conv: ConversationIdentity, who: WidgetWho, visitorId: string | null): "ok" | "upgrade" | "denied" {
  const userLevel = Boolean(conv.identity_hash || conv.context_hash);
  if (userLevel) {
    if (who.kind !== "token" || who.identityHash !== conv.identity_hash || who.contextHash !== conv.context_hash) return "denied";
    // só contexto (sem external_id): segue preso ao navegador também
    return conv.identity_hash || conv.visitor_id === visitorId ? "ok" : "denied";
  }
  if (conv.visitor_id !== visitorId) return "denied";
  return who.kind === "token" && (who.identityHash || who.contextHash) ? "upgrade" : "ok";
}

/** Colunas da conversa de nível usuário (conversa nova ou anônima que sobe). */
export function identityColumns(who: WidgetWho): Record<string, unknown> {
  if (who.kind !== "token" || (!who.identityHash && !who.contextHash)) return {};
  return {
    identity_hash: who.identityHash,
    context_hash: who.contextHash,
    context_enc: who.claims.context ? sealField("conversations.context_enc", JSON.stringify(who.claims.context)) : null,
    context_source: who.claims.context ? "token" : null,
    context_display: who.claims.contextDisplay,
    ...(who.contactId ? { contact_id: who.contactId } : {}),
  };
}

/** Conversa anônima deste navegador que passa a ser de usuário (só uma vez: depois ela fica presa). */
export async function upgradeConversation(db: SupabaseClient, conversationId: string, who: WidgetWho): Promise<void> {
  const cols = identityColumns(who);
  if (!Object.keys(cols).length) return;
  const { error } = await db.from("conversations").update(cols).eq("id", conversationId).is("identity_hash", null).is("context_hash", null);
  if (error) console.error("identidade: conversa não subiu para usuário", error.message);
}

/** O que a IA e as ações recebem da identidade (o contexto nunca vai para a IA). */
export interface ChatIdentity {
  externalId: string | null;
  userDisplay: Record<string, unknown> | null;
  contextDisplay: string | null;
  context: Record<string, unknown> | null;
  source: "token" | "pairing";
  ageVerified: boolean | null;
}

export const chatIdentityOf = (who: WidgetWho): ChatIdentity | null =>
  who.kind === "token" ? { externalId: who.claims.externalId, userDisplay: who.claims.userDisplay, contextDisplay: who.claims.contextDisplay, context: who.claims.context, source: "token", ageVerified: who.claims.ageVerified } : null;

/** Linha do prompt: com quem a IA fala (só o display; o contexto vai só para as ações). Função pura. */
export function identityPromptNote(id: ChatIdentity | null): string | null {
  if (!id || (!id.externalId && !id.contextDisplay)) return null;
  const name = typeof id.userDisplay?.name === "string" ? id.userDisplay.name.slice(0, 60) : null;
  const who = id.externalId ? `uma pessoa identificada pela empresa${name ? ` (${name})` : ""}` : "uma pessoa";
  const where = id.contextDisplay ? `, no contexto "${id.contextDisplay.slice(0, 120)}"` : "";
  return `Você está falando com ${who}${where}. A identidade já foi confirmada pela empresa: nunca peça documento, senha ou prova de quem ela é. Em respostas com dados da conta, cite o contexto.`;
}
