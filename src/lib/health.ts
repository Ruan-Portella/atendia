import type { SupabaseClient } from "@supabase/supabase-js";
import { checkHashSentinel } from "./hash";

/** Disco do banco no plano atual (Supabase Free: 500 MB). Trocar DB_DISK_LIMIT_MB ao migrar para o Pro. */
const diskLimitBytes = () => Number(process.env.DB_DISK_LIMIT_MB ?? 500) * 1024 * 1024;
export const DISK_WARN_RATIO = 0.7;

/** Evento da Meta pendente há mais que isto = fila parada (o health responde 503). */
export const STUCK_MINUTES = 30;

export interface HealthReport {
  ok: boolean;
  oldestPendingSeconds: number | null;
  queueStuck: boolean;
  dbWrite: boolean;
  dbWriteMs: number | null;
  diskBytes: number | null;
  diskRatio: number | null;
  diskWarning: boolean;
  /** A chave de hash (CONTACT_HASH_KEY) é a mesma de sempre? false: mudou (contatos e supressões somem). */
  hashKeyOk?: boolean | null;
  error?: string;
}

/**
 * Saúde da produção: o banco aceita escrita, quanto do disco está usado e se a fila da Meta
 * está andando (evento pendente há mais de 30 minutos = parada).
 */
export async function checkHealth(db: SupabaseClient): Promise<HealthReport> {
  const started = Date.now();
  const write = await db.from("health_checks").upsert({ id: 1, checked_at: new Date().toISOString() });
  const dbWrite = !write.error;
  const size = await db.rpc("db_size_bytes");
  const diskBytes = typeof size.data === "number" ? size.data : size.data ? Number(size.data) : null;
  const pending = await db.rpc("inbound_oldest_pending_seconds");
  const oldestPendingSeconds = pending.error ? null : Number(pending.data ?? 0);
  const queueStuck = oldestPendingSeconds !== null && oldestPendingSeconds > STUCK_MINUTES * 60;
  const diskRatio = diskBytes === null ? null : Math.round((diskBytes / diskLimitBytes()) * 1000) / 1000;
  const hashKeyOk = await checkHashSentinel(db).catch(() => null);
  return {
    ok: dbWrite && !queueStuck && hashKeyOk !== false,
    hashKeyOk,
    oldestPendingSeconds,
    queueStuck,
    dbWrite,
    dbWriteMs: dbWrite ? Date.now() - started : null,
    diskBytes,
    diskRatio,
    diskWarning: diskRatio !== null && diskRatio >= DISK_WARN_RATIO,
    ...(write.error ? { error: write.error.message } : {}),
  };
}
