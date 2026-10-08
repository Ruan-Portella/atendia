import * as Sentry from "@sentry/nextjs";
import { createAdminClient } from "@/lib/supabase/admin";
import { deadline, isCronAuthorized, withCronLock } from "@/lib/cron";
import { runCampaignTick } from "@/lib/campaigns";

export const maxDuration = 60;

/**
 * Tique das campanhas e lembretes (leva B3). Quem chama é o pg_cron do Supabase, a cada minuto e
 * só quando há campanha agendada ou enviando (migração 0082), com o mesmo CRON_SECRET da Vercel.
 * Trava própria: dois tiques nunca rodam juntos; o que não coube fica para o próximo minuto.
 */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return new Response("unauthorized", { status: 401 });
  const db = createAdminClient();
  try {
    const result = await withCronLock(db, "campanhas", 90, () => runCampaignTick(db, { hasTime: deadline(45_000) }));
    return Response.json(result);
  } catch (e) {
    Sentry.captureException(e);
    await Sentry.flush(2000);
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
