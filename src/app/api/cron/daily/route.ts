import { createAdminClient } from "@/lib/supabase/admin";
import { deadline, isCronAuthorized } from "@/lib/cron";
import { applyRetention, refreshSources, trialReminders } from "@/lib/jobs";

export const maxDuration = 60;

/**
 * Cron diário (vercel.json). As tarefas rápidas primeiro; a releitura de sites usa o tempo
 * que sobrar. Uma tarefa com erro não impede as outras.
 */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return new Response("unauthorized", { status: 401 });
  const db = createAdminClient();
  const hasTime = deadline(50_000);
  const run = async <T,>(name: string, fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (e) {
      console.error(`cron diário: ${name} falhou`, e);
      return { error: (e as Error).message };
    }
  };
  const trial = await run("avisos de teste", () => trialReminders(db));
  const retention = await run("limpeza LGPD", () => applyRetention(db));
  const sources = await run("releitura de sites", () => refreshSources(db, hasTime));
  return Response.json({ trial, retention, sources });
}
