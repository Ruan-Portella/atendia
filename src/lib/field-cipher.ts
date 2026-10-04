import { createAdminClient } from "./supabase/admin";
import { clientKeyById, clientKeyForSeal, gcmOpen, gcmSeal, masterKey } from "./keys";

/*
 * Cifra por campo do que vem do contato (leva S; spec "Auditoria, criptografia e suporte"):
 * AES-256-GCM na aplicação, com dado adicional autenticado igual a "tabela.coluna" (um valor não
 * serve em outra coluna). Dois escopos:
 * - cliente: o que vem do contato de um chatbot de cliente, com a chave daquele cliente;
 * - plataforma: chatbot sem cliente (demos), com a chave mestra.
 * Formato: "v2.c.<id da chave>.<iv>.<tag>.<dado>" ou "v2.p<versão>.<iv>.<tag>.<dado>". O que
 * não começa com "v2." é valor antigo, ainda sem cifra (a recifra do histórico cuida, em lotes).
 * Chave apagada (cliente excluído): o valor vira UNREADABLE.
 *
 * Só as camadas únicas chamam estas funções (messages.ts, contacts.ts, leads.ts, unanswered.ts,
 * scope-refusals.ts e os módulos donos de cada coluna _enc).
 */

export type CipherField =
  | "messages.content"
  | "contacts.phone_enc"
  | "contacts.wa_user_enc"
  | "contacts.ig_enc"
  | "contacts.external_id_enc"
  | "conversations.context_enc"
  | "conversations.gate_id_map_enc"
  | "conversations.age_pending_reply_enc"
  | "conversations.age_pending_question"
  | "leads.phone_enc"
  | "leads.notes_enc"
  | "unanswered.question"
  | "scope_refusals.request"
  | "contact_links.external_id_enc"
  | "contact_links.context_enc"
  | "pairing_codes.external_id_enc"
  | "pairing_codes.context_enc"
  | "webhook_deliveries.payload_enc"
  | "action_calls.request_enc"
  | "action_calls.response_enc"
  | "compliance_checks.summary_enc";

/** Escopo da cifra: o cliente dono do dado, ou null (plataforma: chatbot sem cliente, demos). */
export interface CipherScope {
  clientId: string | null;
}
export const PLATFORM_SCOPE: CipherScope = { clientId: null };

/** O que aparece no lugar de um valor cuja chave foi apagada (cliente excluído). */
export const UNREADABLE = "(conteúdo apagado)";

export const isSealed = (v: string) => v.startsWith("v2.");

let identityForTests = false;
/** Testes antigos que olham o valor gravado: sem cifra (os testes de cifra ligam de volta). */
export function setCipherIdentityForTests(on: boolean): void {
  identityForTests = on;
}

/** Valor como vai para o banco. */
export async function sealField(field: CipherField, value: string, scope: CipherScope): Promise<string> {
  if (identityForTests) return value;
  if (scope.clientId) {
    const k = await clientKeyForSeal(scope.clientId);
    return `v2.c.${k.id}.${gcmSeal(k.key, value, field)}`;
  }
  const m = masterKey();
  return `v2.p${m.version}.${gcmSeal(m.key, value, field)}`;
}

/** Valor como sai do banco (o antigo, sem cifra, passa igual). */
export async function openField(field: CipherField, value: string): Promise<string> {
  if (!isSealed(value)) return value;
  const parts = value.split(".");
  try {
    if (parts[1] === "c") {
      const key = await clientKeyById(parts[2]);
      if (!key) return UNREADABLE;
      return gcmOpen(key, parts.slice(3).join("."), field).toString("utf8");
    }
    const version = /^p(\d+)$/.exec(parts[1])?.[1];
    if (!version) return value;
    return gcmOpen(masterKey(Number(version)).key, parts.slice(2).join("."), field).toString("utf8");
  } catch (e) {
    console.error("cifra: valor não abriu", field, (e as Error).message);
    return UNREADABLE;
  }
}

/** sealField que aceita vazio (coluna nula continua nula). */
export const sealNullable = async (field: CipherField, value: string | null | undefined, scope: CipherScope): Promise<string | null> => (value ? sealField(field, value, scope) : null);

/** openField que aceita vazio. */
export const openNullable = async (field: CipherField, value: unknown): Promise<string | null> => (typeof value === "string" && value ? openField(field, value) : null);

/* ------------------------------------------------------------------ escopo pelo chatbot ou pela conversa */

export interface ScopeResolver {
  bot(botId: string): Promise<CipherScope>;
  conversation(conversationId: string): Promise<CipherScope>;
}

const TTL_MS = 10 * 60_000;
const botCache = new Map<string, { scope: CipherScope; at: number }>();
const convCache = new Map<string, { botId: string; at: number }>();

const adminResolver: ScopeResolver = {
  async bot(botId) {
    const hit = botCache.get(botId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.scope;
    const { data } = await createAdminClient().from("bots").select("client_id, is_demo").eq("id", botId).maybeSingle();
    // chatbot de demonstração ou sem cliente: chave da plataforma
    const scope = { clientId: data && !data.is_demo ? ((data.client_id as string | null) ?? null) : null };
    botCache.set(botId, { scope, at: Date.now() });
    return scope;
  },
  async conversation(conversationId) {
    const hit = convCache.get(conversationId);
    if (hit && Date.now() - hit.at < TTL_MS) return adminResolver.bot(hit.botId);
    const { data } = await createAdminClient().from("conversations").select("bot_id").eq("id", conversationId).maybeSingle();
    if (!data) return PLATFORM_SCOPE;
    convCache.set(conversationId, { botId: String(data.bot_id), at: Date.now() });
    return adminResolver.bot(String(data.bot_id));
  },
};

let resolver: ScopeResolver = adminResolver;
/** Troca quem diz o escopo (testes). */
export function setScopeResolver(r: ScopeResolver | null): void {
  resolver = r ?? adminResolver;
  botCache.clear();
  convCache.clear();
}

export const scopeOfBot = (botId: string) => resolver.bot(botId);
export const scopeOfConversation = (conversationId: string) => resolver.conversation(conversationId);
