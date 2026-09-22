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
