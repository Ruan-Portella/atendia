import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Rotas de cron só respondem à Vercel: ela manda `Authorization: Bearer $CRON_SECRET`.
 * Sem CRON_SECRET configurado, as rotas ficam desligadas (nunca abertas).
 */
export function isCronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.get("authorization") === `Bearer ${secret}`;
}

/** Para laços longos pararem antes do tempo máximo da função. */
export function deadline(ms: number) {
  const end = Date.now() + ms;
  return () => Date.now() < end;
}

/**
 * Roda `fn` só se ninguém estiver rodando a mesma rotina (trava em cron_locks, migração 0028).
 * Devolve { skipped: true } quando outra execução está no meio.
 */
export async function withCronLock<T>(db: SupabaseClient, name: string, seconds: number, fn: () => Promise<T>): Promise<T | { skipped: true }> {
  const { data: got, error } = await db.rpc("cron_lock", { p_name: name, p_seconds: seconds });
  if (error) throw new Error(`cron_lock: ${error.message}`);
  if (!got) return { skipped: true };
  let ok = false;
  try {
    const r = await fn();
    ok = true;
    return r;
  } finally {
    await db.rpc("cron_unlock", { p_name: name, p_ok: ok });
  }
}
