import { clientIp, firstExceeded, hashId } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCronAuthorized } from "@/lib/cron";
import { checkHealth } from "@/lib/health";

export const dynamic = "force-dynamic";

/**
 * Vigia de fora (monitor de disponibilidade a cada minuto): 200 quando o banco aceita escrita,
 * 503 quando não. Sem o segredo, só o status; com `Authorization: Bearer $CRON_SECRET`, os detalhes.
 */
export async function GET(req: Request) {
  // ?teste-sentry=1 com o segredo: erro de propósito, para conferir que chega ao Sentry
  if (isCronAuthorized(req) && new URL(req.url).searchParams.get("teste-sentry") === "1") throw new Error("Teste do Sentry (ignorar)");
  // sem o segredo, poucas checagens por minuto e IP: cada uma grava no banco (relatório de segurança de 23/10/2026)
  if (!isCronAuthorized(req)) {
    const over = await firstExceeded(createAdminClient(), [{ key: `health:${hashId(clientIp(req))}`, max: 6, windowSeconds: 60, message: "" }]);
    if (over) return Response.json({ error: "rate_limited" }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } });
  }
  let report;
  try {
    report = await checkHealth(createAdminClient());
  } catch (e) {
    report = { ok: false, error: (e as Error).message };
  }
  const body = isCronAuthorized(req) ? report : { ok: report.ok };
  return Response.json(body, { status: report.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
