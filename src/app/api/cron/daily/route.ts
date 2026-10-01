import { createAdminClient } from "@/lib/supabase/admin";
import { deadline, isCronAuthorized } from "@/lib/cron";
import { applyRetention, refreshSources, trialReminders } from "@/lib/jobs";
import { refreshInstagramTokens } from "@/lib/instagram-channel";
import { checkHealth } from "@/lib/health";
import { notifyPlatform } from "@/lib/notify";

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
  // o acesso ao Instagram vale 60 dias: renova antes de vencer
  const instagram = await run("tokens do Instagram", () => refreshInstagramTokens(db));
  // custo de IA: totais do mês e limpeza dos registros com mais de 90 dias
  const aiUsage = await run("totais de IA", async () => {
    const { error } = await db.rpc("ai_usage_rollup");
    if (error) throw error;
    return { ok: true };
  });
  // disco: avisa a partir de 70% (com 95% o banco fica só leitura e os bots param)
  const disk = await run("disco do banco", async () => {
    const h = await checkHealth(db);
    if (h.diskWarning) await notifyPlatform("Disco do banco acima de 70%", [`Uso: ${Math.round((h.diskRatio ?? 0) * 100)}% (${Math.round((h.diskBytes ?? 0) / 1024 / 1024)} MB).`, "Com 95% o Supabase deixa o banco só leitura e todos os bots param. Limpe dados antigos ou migre para o Pro."]);
    return { ratio: h.diskRatio };
  });
  const sources = await run("releitura de sites", () => refreshSources(db, hasTime));
  return Response.json({ trial, retention, instagram, aiUsage, disk, sources });
}
