import * as Sentry from "@sentry/nextjs";
import { createAdminClient } from "@/lib/supabase/admin";
import { deadline, isCronAuthorized, withCronLock } from "@/lib/cron";
import { applyRetention, refreshSources, trialReminders } from "@/lib/jobs";
import { refreshInstagramTokens } from "@/lib/instagram-channel";
import { checkHealth } from "@/lib/health";
import { notifyPlatform } from "@/lib/notify";
import { sweepInbound } from "@/lib/inbound-queue";
import { inboundHandlers } from "@/lib/inbound-process";
import { classifyPending } from "@/lib/gate/base";
import { deleteStalePending } from "@/lib/acceptance";

// a classificação da base (portão, parte 6) usa o que sobrar depois das tarefas rápidas
export const maxDuration = 300;

/**
 * Cron diário (vercel.json). As tarefas rápidas primeiro; a releitura de sites usa o tempo
 * que sobrar. Uma tarefa com erro não impede as outras.
 */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return new Response("unauthorized", { status: 401 });
  // vigia de fora: o Sentry avisa se o job não rodar no horário ou falhar
  const result = await Sentry.withMonitor("cron-diario", () => withCronLock(createAdminClient(), "diario", 300, daily), {
    schedule: { type: "crontab", value: "0 6 * * *" },
    timezone: "UTC",
    checkinMargin: 30,
    maxRuntime: 5,
  });
  await Sentry.flush(2000);
  return Response.json(result);
}

async function daily() {
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
  // fila da Meta primeiro: evento esquecido é contato sem resposta
  const inbound = await run("fila da Meta", () => sweepInbound(db, inboundHandlers, hasTime));
  const trial = await run("avisos de teste", () => trialReminders(db));
  const retention = await run("limpeza LGPD", () => applyRetention(db));
  // aceite pelo link sem a Meta concluir a conexão em 7 dias é apagado
  const acceptances = await run("aceites pendentes", () => deleteStalePending(db));
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
  // portão: trechos novos que não couberam depois da leitura e os de regras antigas
  const base = await run("classificação da base", () => classifyPending(db, { budgetMs: 180_000 }));
  return { inbound, trial, retention, acceptances, instagram, aiUsage, disk, sources, base };
}
