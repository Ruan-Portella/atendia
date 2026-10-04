import type { SupabaseClient } from "@supabase/supabase-js";
import { PLATFORM_SCOPE, sealField, scopeOfBot, type CipherField, type CipherScope } from "./field-cipher";
import { countPlainMessages, reencryptMessages } from "./messages";
import { countPlainContacts, reencryptContacts } from "./contacts";
import { countPlainLeads, reencryptLeads } from "./leads";

/*
 * Recifra do histórico (leva S): o que foi gravado antes da cifra por campo (sem o cabeçalho
 * "v2.") passa a ser cifrado com a chave do cliente, em lotes, pela rotina diária e pelo botão do
 * backoffice. Ler continua funcionando no meio do caminho (o valor antigo passa igual).
 */

interface Target {
  table: string;
  column: string;
  field: CipherField;
  /** Colunas para achar o chatbot dono da linha. */
  select: string;
  botOf: (row: Record<string, unknown>) => string | null;
}

const one = <T,>(x: T | T[] | null | undefined) => (Array.isArray(x) ? x[0] : x) ?? null;

export const TARGETS: Target[] = [
  { table: "conversations", column: "context_enc", field: "conversations.context_enc", select: "id, bot_id", botOf: (r) => r.bot_id as string },
  { table: "conversations", column: "gate_id_map_enc", field: "conversations.gate_id_map_enc", select: "id, bot_id", botOf: (r) => r.bot_id as string },
  { table: "conversations", column: "age_pending_reply_enc", field: "conversations.age_pending_reply_enc", select: "id, bot_id", botOf: (r) => r.bot_id as string },
  { table: "conversations", column: "age_pending_question", field: "conversations.age_pending_question", select: "id, bot_id", botOf: (r) => r.bot_id as string },
  { table: "unanswered", column: "question", field: "unanswered.question", select: "id, bot_id", botOf: (r) => r.bot_id as string },
  { table: "scope_refusals", column: "request", field: "scope_refusals.request", select: "id, bot_id", botOf: (r) => r.bot_id as string },
  { table: "contact_links", column: "external_id_enc", field: "contact_links.external_id_enc", select: "id, bot_id", botOf: (r) => r.bot_id as string },
  { table: "contact_links", column: "context_enc", field: "contact_links.context_enc", select: "id, bot_id", botOf: (r) => r.bot_id as string },
  { table: "pairing_codes", column: "external_id_enc", field: "pairing_codes.external_id_enc", select: "id, bot_id", botOf: (r) => r.bot_id as string },
  { table: "pairing_codes", column: "context_enc", field: "pairing_codes.context_enc", select: "id, bot_id", botOf: (r) => r.bot_id as string },
  { table: "compliance_checks", column: "summary_enc", field: "compliance_checks.summary_enc", select: "id, bot_id", botOf: (r) => r.bot_id as string },
  { table: "action_calls", column: "request_enc", field: "action_calls.request_enc", select: "id, actions(bot_id)", botOf: (r) => (one(r.actions as { bot_id: string } | null)?.bot_id ?? null) },
  { table: "action_calls", column: "response_enc", field: "action_calls.response_enc", select: "id, actions(bot_id)", botOf: (r) => (one(r.actions as { bot_id: string } | null)?.bot_id ?? null) },
  {
    table: "webhook_deliveries",
    column: "payload_enc",
    field: "webhook_deliveries.payload_enc",
    select: "id",
    // o corpo traz o chatbot ({"bot": {"id": "bot_<uuid>"}})
    botOf: (r) => /"bot":\{"id":"bot_([0-9a-f-]{36})"/.exec(String(r.payload_enc ?? ""))?.[1] ?? null,
  },
];

const label = (t: Target) => `${t.table}.${t.column}`;

/** Quanto falta recifrar, por coluna. */
export async function plainCounts(db: SupabaseClient): Promise<Record<string, number>> {
  const out: Record<string, number> = { "messages.content": await countPlainMessages(db), "contacts (identificadores)": await countPlainContacts(db), "leads (telefone e interesse)": await countPlainLeads(db) };
  for (const t of TARGETS) {
    const { count } = await db.from(t.table).select("id", { count: "exact", head: true }).not(t.column, "is", null).not(t.column, "like", "v2.*");
    out[label(t)] = count ?? 0;
  }
  return out;
}

async function reencryptTarget(db: SupabaseClient, t: Target, limit: number): Promise<number> {
  const { data, error } = await db.from(t.table).select(`${t.select}, ${t.column}`).not(t.column, "is", null).not(t.column, "like", "v2.*").limit(limit);
  if (error) throw new Error(`recifra de ${label(t)}: ${error.message}`);
  let done = 0;
  for (const row of (data ?? []) as unknown as Array<Record<string, unknown>>) {
    const value = String(row[t.column]);
    const botId = t.botOf(row);
    const scope: CipherScope = botId ? await scopeOfBot(botId) : PLATFORM_SCOPE;
    const { data: upd } = await db.from(t.table).update({ [t.column]: await sealField(t.field, value, scope) }).eq("id", row.id as string).not(t.column, "like", "v2.*").select("id");
    if (upd?.length) done++;
  }
  return done;
}

/** Recifra em lotes até acabar ou o tempo acabar. Devolve quantas linhas foram cifradas em cada coluna. */
export async function reencryptHistory(db: SupabaseClient, hasTime: () => boolean, batch = 200): Promise<Record<string, number>> {
  const done: Record<string, number> = {};
  const add = (k: string, n: number) => (done[k] = (done[k] ?? 0) + n);
  const steps: Array<[string, () => Promise<number>]> = [
    ["messages.content", () => reencryptMessages(db, batch)],
    ["contacts (identificadores)", () => reencryptContacts(db, batch)],
    ["leads (telefone e interesse)", () => reencryptLeads(db, batch)],
    ...TARGETS.map((t) => [label(t), () => reencryptTarget(db, t, batch)] as [string, () => Promise<number>]),
  ];
  for (const [k, run] of steps) {
    while (hasTime()) {
      const n = await run();
      add(k, n);
      if (n < batch) break;
    }
    if (!hasTime()) break;
  }
  return done;
}
