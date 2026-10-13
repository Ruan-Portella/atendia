import type { SupabaseClient } from "@supabase/supabase-js";
import { openField, sealField, scopeOfConversation } from "./field-cipher";

/*
 * Referências de botão (C pública, parte 5a; spec "Peça 1", confirmação das ações "executa", e
 * "Formatos de payload", seção 2): os parâmetros de uma chamada ficam aqui, cifrados com a chave do
 * cliente, e o canal recebe só o id. Só este módulo usa a tabela button_refs.
 */

export type RefStatus = "open" | "running" | "done" | "uncertain" | "failed" | "canceled" | "superseded";

export interface ButtonRef {
  id: string;
  bot_id: string;
  conversation_id: string;
  action_id: string;
  kind: "confirm" | "action";
  params: Record<string, unknown>;
  params_hash: string;
  single_use: boolean;
  status: RefStatus;
  used_key: string | null;
  first_call_at: string | null;
  expires_at: string;
}

/** 24 horas para o clique (e, depois da primeira chamada, para o "Tentar de novo"). */
export const REF_TTL_MS = 24 * 3_600_000;

const COLUMNS = "id, bot_id, conversation_id, action_id, kind, params_enc, params_hash, single_use, status, used_key, first_call_at, expires_at";

async function opened(row: Record<string, unknown> | null): Promise<ButtonRef | null> {
  if (!row) return null;
  const { params_enc, ...rest } = row;
  let params: Record<string, unknown> = {};
  try {
    params = JSON.parse(await openField("button_refs.params_enc", String(params_enc))) as Record<string, unknown>;
  } catch {
    // chave do cliente apagada ou valor com defeito: sem parâmetros (o clique é recusado)
    return null;
  }
  return { ...(rest as Omit<ButtonRef, "params">), params };
}

/** O call_id de uma chamada confirmada: o id da referência (o mesmo em toda repetição). */
export const refCallId = (refId: string) => `call_${refId.replace(/-/g, "")}`;

/** Grava a referência (aberta por 24 horas) e devolve o id. */
export async function createRef(db: SupabaseClient, r: { botId: string; conversationId: string; actionId: string; kind: "confirm" | "action"; params: Record<string, unknown>; paramsHash: string; singleUse?: boolean }): Promise<string> {
  const params_enc = await sealField("button_refs.params_enc", JSON.stringify(r.params), await scopeOfConversation(r.conversationId));
  const { data, error } = await db
    .from("button_refs")
    .insert({ bot_id: r.botId, conversation_id: r.conversationId, action_id: r.actionId, kind: r.kind, params_enc, params_hash: r.paramsHash, single_use: r.singleUse ?? true, expires_at: new Date(Date.now() + REF_TTL_MS).toISOString() })
    .select("id")
    .single();
  if (error || !data) throw new Error(`referência de botão não gravada: ${error?.message}`);
  return data.id as string;
}

export async function getRef(db: SupabaseClient, id: string): Promise<ButtonRef | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const { data } = await db.from("button_refs").select(COLUMNS).eq("id", id).maybeSingle();
  return opened(data as Record<string, unknown> | null);
}

/** Uma confirmação aberta por ação e conversa: a nova vence as anteriores. */
export async function supersedeOpenRefs(db: SupabaseClient, conversationId: string, actionId: string, exceptId?: string): Promise<void> {
  let q = db.from("button_refs").update({ status: "superseded" }).eq("conversation_id", conversationId).eq("action_id", actionId).eq("kind", "confirm").eq("status", "open");
  if (exceptId) q = q.neq("id", exceptId);
  const { error } = await q;
  if (error) console.error("referências: não substituídas", error.message);
}

/**
 * Consome a referência de forma atômica (status de origem → running), antes de chamar o endpoint.
 * Só uma chamada vence; null = já usada, vencida ou substituída. A primeira chamada fixa o prazo do
 * "Tentar de novo" (24 horas a partir dela).
 */
export async function claimRef(db: SupabaseClient, ref: ButtonRef, from: RefStatus[], key: string): Promise<boolean> {
  const now = new Date();
  const firstCall = ref.first_call_at ?? now.toISOString();
  const { data, error } = await db
    .from("button_refs")
    .update({ status: "running", used_key: key, used_at: now.toISOString(), first_call_at: firstCall, expires_at: new Date(Date.parse(firstCall) + REF_TTL_MS).toISOString() })
    .eq("id", ref.id)
    .in("status", from)
    .gt("expires_at", now.toISOString())
    .select("id");
  if (error) throw new Error(`referência não consumida: ${error.message}`);
  return Boolean(data?.length);
}

/** Cancelar: só uma referência aberta (nada foi chamado). */
export async function cancelRef(db: SupabaseClient, id: string): Promise<boolean> {
  const { data } = await db.from("button_refs").update({ status: "canceled", used_at: new Date().toISOString() }).eq("id", id).eq("status", "open").select("id");
  return Boolean(data?.length);
}

export async function setRefStatus(db: SupabaseClient, id: string, status: RefStatus): Promise<void> {
  const { error } = await db.from("button_refs").update({ status }).eq("id", id);
  if (error) console.error("referência: status não gravado", error.message);
}

/**
 * Chamada incerta desta ação na conversa, ainda dentro das 24 horas da primeira chamada (o
 * contato pediu por texto para tentar de novo).
 */
export async function uncertainRef(db: SupabaseClient, conversationId: string, actionId: string): Promise<ButtonRef | null> {
  const { data } = await db
    .from("button_refs")
    .select(COLUMNS)
    .eq("conversation_id", conversationId)
    .eq("action_id", actionId)
    .eq("status", "uncertain")
    .gt("expires_at", new Date().toISOString())
    .order("first_call_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return opened(data as Record<string, unknown> | null);
}

/** A incerta volta a esperar o Confirmar (com o mesmo call_id). */
export async function reopenRef(db: SupabaseClient, id: string): Promise<boolean> {
  const { data } = await db.from("button_refs").update({ status: "open" }).eq("id", id).eq("status", "uncertain").select("id");
  return Boolean(data?.length);
}

/** Rotina diária: referências vencidas há mais de 7 dias saem. */
export async function deleteExpiredRefs(db: SupabaseClient, before: string): Promise<void> {
  const { error } = await db.from("button_refs").delete().lt("expires_at", before);
  if (error) console.error("referências: limpeza", error.message);
}
