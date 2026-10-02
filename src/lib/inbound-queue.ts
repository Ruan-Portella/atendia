import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { seal, unseal } from "./secret-box";
import { notifyPlatform } from "./notify";

/*
 * Fila de entrada da Meta (tabela inbound_events, migração 0026). O webhook grava cada evento
 * antes de responder 200; o processamento vem logo depois, agrupado e travado por contato, e
 * a varredura retoma o que ficou para trás. Detalhes no comentário da migração.
 */

export type InboundSource = "whatsapp" | "instagram";
export type InboundKind = "msg" | "echo" | "status" | "account_update" | "edit" | "delete";

/** A trava de um contato vale isto; precisa ficar acima do maxDuration (60 s) dos webhooks. */
export const LEASE_SECONDS = 90;
/** Voltas seguidas no mesmo contato (mensagem nova chegou enquanto respondia). */
const MAX_ROUNDS = 3;

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export interface InboundInput {
  /** Chave do evento, ex.: wa:msg:{wamid}. Vira hash (o id do WhatsApp contém o telefone). */
  key: string;
  source: InboundSource;
  kind: InboundKind;
  botId: string | null;
  /** Contato (telefone, IGSID): agrupa e trava. Sem contato, o evento é o próprio grupo. */
  contact?: string | null;
  payload: unknown;
}

export interface InboundEvent<T = unknown> {
  key_hash: string;
  source: InboundSource;
  kind: InboundKind;
  bot_id: string | null;
  contact_hash: string;
  created_at: string;
  attempts: number;
  payload: T;
}

export interface Group {
  source: InboundSource;
  bot_id: string | null;
  contact_hash: string;
}

const groupOf = (e: InboundInput): Group => ({ source: e.source, bot_id: e.botId, contact_hash: e.contact ? sha256(`${e.source}:${e.contact}`) : sha256(e.key) });

/**
 * Grava o evento. Devolve o grupo dele, ou null se já existia (reenvio da Meta). Erro do banco
 * sobe: o webhook responde 5xx e a Meta manda de novo.
 */
export async function acceptInbound(db: SupabaseClient, e: InboundInput): Promise<Group | null> {
  const g = groupOf(e);
  const { data, error } = await db.rpc("inbound_accept", {
    p_key_hash: sha256(e.key),
    p_source: e.source,
    p_kind: e.kind,
    p_bot_id: e.botId,
    p_contact_hash: g.contact_hash,
    p_payload_enc: seal(JSON.stringify(e.payload)),
  });
  if (error) throw new Error(`inbound_accept: ${error.message}`);
  return data ? g : null;
}

/** Mensagem que nós mesmos enviamos: o eco dela chega depois e já entra como tratado. */
export async function markOwnMessage(db: SupabaseClient, key: string, source: InboundSource) {
  await db.rpc("inbound_accept", { p_key_hash: sha256(key), p_source: source, p_kind: "echo", p_bot_id: null, p_contact_hash: sha256(key), p_payload_enc: null, p_done: true });
}

export type GroupHandler = (db: SupabaseClient, events: InboundEvent[]) => Promise<void>;

/**
 * Processa um contato: pega os eventos pendentes, trata todos juntos (a rajada vira uma resposta),
 * conclui, e repete se chegou mensagem nova no meio (até 3 voltas). Se outro processo está com o
 * contato, não faz nada: quem está com ele vê a mensagem nova na próxima volta.
 */
export async function processGroup(db: SupabaseClient, g: Group, handler: GroupHandler): Promise<void> {
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const { data, error } = await db.rpc("inbound_claim", { p_source: g.source, p_bot_id: g.bot_id, p_contact_hash: g.contact_hash, p_lease: LEASE_SECONDS });
    if (error) throw new Error(`inbound_claim: ${error.message}`);
    const rows = ((data ?? []) as Array<Omit<InboundEvent, "payload"> & { payload_enc: string | null }>).sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (!rows.length) return;
    const keys = rows.map((r) => r.key_hash);
    const events: InboundEvent[] = rows.map(({ payload_enc, ...r }) => ({ ...r, payload: payload_enc ? JSON.parse(unseal(payload_enc)) : null }));
    try {
      await handler(db, events);
      await db.rpc("inbound_finish", { p_keys: keys });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("fila: falha ao processar", g.source, e);
      const { data: failed } = await db.rpc("inbound_finish", { p_keys: keys, p_error: message });
      if (Number(failed) > 0) {
        await notifyPlatform("Evento da Meta falhou 5 vezes", [`Canal: ${g.source}. Bot: ${g.bot_id ?? "-"}. Eventos: ${Number(failed)}.`, `Último erro: ${message.slice(0, 300)}`, "O contato ficou sem resposta automática. Veja os logs da Vercel e o Sentry."]).catch(() => {});
      }
      return;
    }
  }
}

/** Retoma o que ficou para trás (função caiu, trava vencida). Roda a cada webhook e no cron diário. */
export async function sweepInbound(db: SupabaseClient, handlers: Record<InboundSource, GroupHandler>, hasTime: () => boolean = () => true, minAgeSeconds = 30) {
  const { data } = await db.rpc("inbound_due", { p_min_age: minAgeSeconds, p_limit: 20 });
  let groups = 0;
  for (const g of (data ?? []) as Group[]) {
    if (!hasTime()) break;
    await processGroup(db, g, handlers[g.source]);
    groups++;
  }
  return { groups };
}
