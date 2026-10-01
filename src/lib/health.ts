import type { SupabaseClient } from "@supabase/supabase-js";

/** Disco do banco no plano atual (Supabase Free: 500 MB). Trocar DB_DISK_LIMIT_MB ao migrar para o Pro. */
const diskLimitBytes = () => Number(process.env.DB_DISK_LIMIT_MB ?? 500) * 1024 * 1024;
export const DISK_WARN_RATIO = 0.7;

export interface HealthReport {
  ok: boolean;
  dbWrite: boolean;
  dbWriteMs: number | null;
  diskBytes: number | null;
  diskRatio: number | null;
  diskWarning: boolean;
  error?: string;
}

/**
 * Saúde da produção: o banco aceita escrita e quanto do disco está usado.
 * (A idade do evento pendente mais antigo entra junto com a fila inbound_events, no passo 2.)
 */
export async function checkHealth(db: SupabaseClient): Promise<HealthReport> {
  const started = Date.now();
  const write = await db.from("health_checks").upsert({ id: 1, checked_at: new Date().toISOString() });
  const dbWrite = !write.error;
  const size = await db.rpc("db_size_bytes");
  const diskBytes = typeof size.data === "number" ? size.data : size.data ? Number(size.data) : null;
  const diskRatio = diskBytes === null ? null : Math.round((diskBytes / diskLimitBytes()) * 1000) / 1000;
  return {
    ok: dbWrite,
    dbWrite,
    dbWriteMs: dbWrite ? Date.now() - started : null,
    diskBytes,
    diskRatio,
    diskWarning: diskRatio !== null && diskRatio >= DISK_WARN_RATIO,
    ...(write.error ? { error: write.error.message } : {}),
  };
}
