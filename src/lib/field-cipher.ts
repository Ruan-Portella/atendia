import { createAdminClient } from "./supabase/admin";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
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
  | "messages.components_enc"
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
  | "leads.instagram_enc"
  | "unanswered.question"
  | "scope_refusals.request"
  | "contact_links.external_id_enc"
  | "contact_links.context_enc"
  | "pairing_codes.external_id_enc"
  | "pairing_codes.context_enc"
  | "webhook_deliveries.payload_enc"
  | "action_calls.request_enc"
  | "action_calls.response_enc"
  | "compliance_checks.summary_enc"
  | "attachments.object"
  | "attachments.filename_enc"
  | "campaign_sends.phone_enc"
  | "campaign_sends.variables_enc";

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

/* ------------------------------------------------------------------ arquivos (binário) */

/**
 * Arquivo cifrado: "v2.c.<id da chave>" ou "v2.p<versão>" e uma quebra de linha, depois iv (12
 * bytes), tag (16) e o dado; mesmo esquema e mesmas chaves dos campos, com o dado adicional
 * autenticado igual ao campo.
 */
export async function sealBytes(field: CipherField, data: Uint8Array, scope: CipherScope): Promise<Uint8Array> {
  if (identityForTests) return data;
  let head: string;
  let key: Buffer;
  if (scope.clientId) {
    const k = await clientKeyForSeal(scope.clientId);
    head = `v2.c.${k.id}`;
    key = k.key;
  } else {
    const m = masterKey();
    head = `v2.p${m.version}`;
    key = m.key;
  }
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(field));
  const body = Buffer.concat([c.update(data), c.final()]);
  return Buffer.concat([Buffer.from(`${head}\n`), iv, c.getAuthTag(), body]);
}

/** O arquivo aberto, ou null (chave apagada, formato desconhecido ou dado adulterado). */
export async function openBytes(field: CipherField, buf: Uint8Array): Promise<Uint8Array | null> {
  if (identityForTests) return buf;
  const b = Buffer.from(buf);
  const nl = b.indexOf(0x0a);
  if (nl < 4 || nl > 80) return null;
  const parts = b.subarray(0, nl).toString("utf8").split(".");
  if (parts[0] !== "v2") return null;
  let key: Buffer | null;
  try {
    if (parts[1] === "c") key = await clientKeyById(parts.slice(2).join("."));
    else {
      const version = /^p(\d+)$/.exec(parts[1] ?? "")?.[1];
      if (!version) return null;
      key = masterKey(Number(version)).key;
    }
    if (!key) return null;
    const d = createDecipheriv("aes-256-gcm", key, b.subarray(nl + 1, nl + 13));
    d.setAAD(Buffer.from(field));
    d.setAuthTag(b.subarray(nl + 13, nl + 29));
    return Buffer.concat([d.update(b.subarray(nl + 29)), d.final()]);
  } catch (e) {
    console.error("cifra: arquivo não abriu", field, (e as Error).message);
    return null;
  }
}

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
