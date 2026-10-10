import * as Sentry from "@sentry/nextjs";
import { createAdminClient } from "@/lib/supabase/admin";
import { deadline, isCronAuthorized, withCronLock } from "@/lib/cron";
import { runCampaignTick } from "@/lib/campaigns";
import { retryDueDeliveries } from "@/lib/webhooks";

export const maxDuration = 60;

/**
 * Tique dos envios: campanhas e lembretes (leva B3) e as novas tentativas dos webhooks (C pública).
 * Quem chama é o pg_cron do Supabase, a cada minuto e só quando há o que fazer (migrações 0082,
 * 0086 e 0088), com o mesmo CRON_SECRET da Vercel. Trava própria: dois tiques nunca rodam juntos;
 * o que não coube fica para o próximo minuto.
 */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return new Response("unauthorized", { status: 401 });
  const db = createAdminClient();
  try {
    const result = await withCronLock(db, "campanhas", 90, async () => {
      const hasTime = deadline(45_000);
      const campaigns = await runCampaignTick(db, { hasTime });
      // eventos de alto volume (status, envios de campanha) e falhas saem por aqui
      const webhooks = hasTime() ? await retryDueDeliveries(db, { hasTime, limit: 200 }) : 0;
      return { ...campaigns, webhooks };
    });
    return Response.json(result);
  } catch (e) {
    Sentry.captureException(e);
    await Sentry.flush(2000);
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
