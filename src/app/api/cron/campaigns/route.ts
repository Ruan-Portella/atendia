import * as Sentry from "@sentry/nextjs";
import { createAdminClient } from "@/lib/supabase/admin";
import { deadline, isCronAuthorized, withCronLock } from "@/lib/cron";
import { runCampaignTick } from "@/lib/campaigns";
import { retryDueDeliveries } from "@/lib/webhooks";
import { expireApiPauses } from "@/lib/api-pause";

export const maxDuration = 60;

/**
 * Tique dos envios: campanhas e lembretes (leva B3), as novas tentativas dos webhooks e as pausas
 * da integração que venceram (C pública). Quem chama é o pg_cron do Supabase, a cada minuto e só
 * quando há o que fazer (migrações 0082, 0086, 0088 e 0089), com o mesmo CRON_SECRET da Vercel. Trava própria: dois tiques nunca rodam juntos;
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
      // pausa da integração vencida: volta para a IA (que responde a pergunta pendente)
      const pauses = hasTime() ? await expireApiPauses(db, { hasTime }) : 0;
      return { ...campaigns, webhooks, pauses };
    });
    return Response.json(result);
  } catch (e) {
    Sentry.captureException(e);
    await Sentry.flush(2000);
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
