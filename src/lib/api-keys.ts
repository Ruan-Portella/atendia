import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/*
 * Chaves da API pública (spec "Chaves de API"; migração 0059): dois limites combinados, escopo de
 * bots (lista, um cliente ou todos, inclusive os futuros) e permissões. A chave aparece uma vez;
 * o banco guarda só o sha256 (a chave tem 192 bits aleatórios, não precisa de hash lento) e o
 * início, para reconhecer. Criar e revogar fica no painel, nunca pela API: uma chave vazada não
 * cria outra. Nos pilotos (P1, P2) quem cria é a equipe BoaVoz, no backoffice.
 */

export const API_PERMISSIONS = ["messages", "conversations", "contacts", "pairing", "campaigns", "sources", "provisioning", "members"] as const;
export type ApiPermission = (typeof API_PERMISSIONS)[number];
export const isApiPermission = (v: string): v is ApiPermission => (API_PERMISSIONS as readonly string[]).includes(v);

/** O que cada permissão abre (tela do backoffice e, na C pública, do painel). */
export const PERMISSION_LABEL: Record<ApiPermission, string> = {
  messages: "mensagens (enviar e ler)",
  conversations: "conversas (ler, pausar e retomar a IA)",
  contacts: "contatos (idade, etiquetas, consentimento, exclusão)",
  pairing: "pareamento (P2)",
  campaigns: "campanhas",
  sources: "fontes da base",
  provisioning: "provisionamento (clientes, bots, links de conexão)",
  members: "equipe do portal",
};

export type ApiKeyScope = { type: "bots"; botIds: string[] } | { type: "client"; clientId: string } | { type: "all" };

export interface ApiKeyRow {
  id: string;
  agency_id: string;
  name: string;
  prefix: string;
  scope_type: "bots" | "client" | "all";
  scope_bot_ids: string[];
  scope_client_id: string | null;
  permissions: string[];
  last_used_at: string | null;
  revoked_at: string | null;
}

export const API_KEY_COLS = "id, agency_id, name, prefix, scope_type, scope_bot_ids, scope_client_id, permissions, last_used_at, revoked_at";

const KEY_PREFIX = "bv_live_";
/** Caracteres do início guardados para reconhecer a chave (bv_live_ + 6). */
const SHOWN = KEY_PREFIX.length + 6;

export const apiKeyHash = (key: string) => createHash("sha256").update(key).digest("hex");

/** Chave nova: bv_live_ + 32 caracteres base64url (24 bytes aleatórios). */
export function newApiKey(): { key: string; prefix: string; hash: string } {
  const key = `${KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
  return { key, prefix: key.slice(0, SHOWN), hash: apiKeyHash(key) };
}

/** Formato de chave do BoaVoz (evita consultar o banco com lixo). */
export const looksLikeApiKey = (v: string) => /^bv_live_[A-Za-z0-9_-]{32}$/.test(v);

/** Problema no cadastro (null = ok). Função pura. */
export function apiKeyProblem(i: { name: string; scope: ApiKeyScope; permissions: string[] }): string | null {
  if (!i.name.trim() || i.name.length > 80) return "Dê um nome à chave (até 80 caracteres), ex.: \"DuckDelivery produção\".";
  if (!i.permissions.length) return "Marque ao menos uma permissão.";
  if (i.permissions.some((p) => !isApiPermission(p))) return "Permissão desconhecida.";
  if (i.scope.type === "bots" && !i.scope.botIds.length) return "Escolha ao menos um chatbot para o escopo.";
  return null;
}

/** Bots (não demo) da agência que a chave alcança agora: o escopo "cliente" e "todos" incluem os futuros. */
export async function scopeBotIds(db: SupabaseClient, key: Pick<ApiKeyRow, "agency_id" | "scope_type" | "scope_bot_ids" | "scope_client_id">): Promise<string[]> {
  let q = db.from("bots").select("id").eq("agency_id", key.agency_id).eq("is_demo", false);
  if (key.scope_type === "bots") q = q.in("id", key.scope_bot_ids.length ? key.scope_bot_ids : ["00000000-0000-0000-0000-000000000000"]);
  else if (key.scope_type === "client") q = q.eq("client_id", key.scope_client_id ?? "00000000-0000-0000-0000-000000000000");
  const { data, error } = await q;
  if (error) throw new Error(`escopo da chave: ${error.message}`);
  return (data ?? []).map((b) => b.id as string);
}

/** Cria a chave; devolve o texto inteiro (mostrado uma vez só). */
export async function createApiKey(db: SupabaseClient, i: { agencyId: string; name: string; scope: ApiKeyScope; permissions: ApiPermission[]; createdBy: string }): Promise<{ id: string; key: string; prefix: string }> {
  const { key, prefix, hash } = newApiKey();
  const { data, error } = await db
    .from("api_keys")
    .insert({
      agency_id: i.agencyId,
      name: i.name.trim(),
      prefix,
      key_hash: hash,
      scope_type: i.scope.type,
      scope_bot_ids: i.scope.type === "bots" ? i.scope.botIds : [],
      scope_client_id: i.scope.type === "client" ? i.scope.clientId : null,
      permissions: [...new Set(i.permissions)],
      created_by: i.createdBy,
    })
    .select("id")
    .single();
  if (error) throw new Error(`chave não criada: ${error.message}`);
  return { id: data.id as string, key, prefix };
}

/** Revoga na hora (a próxima requisição com ela já dá 401). */
export async function revokeApiKey(db: SupabaseClient, agencyId: string, id: string, by: string): Promise<ApiKeyRow | null> {
  const { data, error } = await db.from("api_keys").update({ revoked_at: new Date().toISOString(), revoked_by: by }).eq("id", id).eq("agency_id", agencyId).is("revoked_at", null).select(API_KEY_COLS).maybeSingle<ApiKeyRow>();
  if (error) throw new Error(`chave não revogada: ${error.message}`);
  return data;
}
