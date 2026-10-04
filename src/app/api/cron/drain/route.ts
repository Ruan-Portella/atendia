import * as Sentry from "@sentry/nextjs";
import { createAdminClient } from "@/lib/supabase/admin";
import { deadline, isCronAuthorized, withCronLock } from "@/lib/cron";
import { sweepInbound } from "@/lib/inbound-queue";
import { inboundHandlers } from "@/lib/inbound-process";
import { retryDueDeliveries } from "@/lib/webhooks";

export const maxDuration = 60;

/** Agenda em vercel.json. No Hobby, 1 vez por dia; no Pro, a cada minuto (só muda o agendamento). */
const DRAIN_SCHEDULE = "15 6 * * *";

/**
 * Drain: retoma a fila da Meta (eventos que ficaram para trás). Com o cron por minuto, é ele que
 * garante a resposta quando o processamento logo depois do webhook falha; no Hobby, a varredura
 * também roda a cada webhook. Trava própria: duas execuções nunca rodam juntas.
 */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return new Response("unauthorized", { status: 401 });
  const db = createAdminClient();
  const result = await Sentry.withMonitor(
    "drain",
    () =>
      withCronLock(db, "drain", 90, async () => {
        const hasTime = deadline(45_000);
        const inbound = await sweepInbound(db, inboundHandlers, hasTime, 0);
        // novas tentativas dos webhooks que já venceram (1 min, 5 min, 30 min… depois da falha)
        const webhooks = await retryDueDeliveries(db, { hasTime }).catch(() => 0);
        return { inbound, webhooks };
      }),
    { schedule: { type: "crontab", value: DRAIN_SCHEDULE }, timezone: "UTC", checkinMargin: 30, maxRuntime: 2 },
  );
  await Sentry.flush(2000);
  return Response.json(result);
}
