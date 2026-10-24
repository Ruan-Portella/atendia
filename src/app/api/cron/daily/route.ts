import * as Sentry from "@sentry/nextjs";
import { disconnectUnsized } from "@/lib/free-account";
import { releaseDomainsWithoutPack } from "@/lib/domain-pack";
import { emitMonthClosed } from "@/lib/month-close";
import { createAdminClient } from "@/lib/supabase/admin";
import { deadline, isCronAuthorized, withCronLock } from "@/lib/cron";
import { applyRetention, refreshSources } from "@/lib/jobs";
import { unlinkInactive } from "@/lib/pairing";
import { reencryptHistory } from "@/lib/reencrypt";
import { refreshReportDaily } from "@/lib/report-daily";
import { sweepAttachments } from "@/lib/attachments";
import { refreshInstagramTokens, refreshInstagramUsernames } from "@/lib/instagram-channel";
import { checkHealth } from "@/lib/health";
import { notifyPlatform } from "@/lib/notify";
import { sweepInbound } from "@/lib/inbound-queue";
import { inboundHandlers } from "@/lib/inbound-process";
import { classifyPending } from "@/lib/gate/base";
import { runDueAnalyses } from "@/lib/bot-analysis";
import { deleteStalePending } from "@/lib/acceptance";
import { linkLegacyConversations } from "@/lib/contacts";
import { runContinuousChecks } from "@/lib/continuous-check";
import { runDueAccountDeletions } from "@/lib/account-deletion";
import { apiInvitesDigest } from "@/lib/api-members";
import { checkErrorRates, checkSubscriptions } from "@/lib/meta-monitor";
import { checkAiCostAlarm } from "@/lib/ai-cost-alarm";
import { expireContactMemories } from "@/lib/contacts";
import { purgeOrphanSignals } from "@/lib/person-signals";
import { purgeStatusDaily } from "@/lib/status";
import { sweepMfaRecoveries } from "@/lib/mfa-recovery";
import { remindDueRequests } from "@/lib/data-subject";
import { MEMORY_DAYS } from "@/lib/contact-memory";

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
  const started = Date.now();
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
  // totais diários antes da retenção: o que ela apagar já está somado nos relatórios
  const reports = await run("totais diários", () => refreshReportDaily(db, () => hasTime()));
  // verificação contínua por cliente (B1'): depois dos totais diários, que dão o volume da semana
  const continuous = await run("verificação contínua", () => runContinuousChecks(db));
  const retention = await run("limpeza LGPD", () => applyRetention(db, () => hasTime()));
  // arquivos recebidos que ficaram sem conversa (chatbot ou cliente excluído) ou venceram
  const files = await run("arquivos sem conversa", () => sweepAttachments(db, () => hasTime()));
  // memória do contato vencida (180 dias sem atualização)
  const memories = await run("memórias vencidas", () => expireContactMemories(db, new Date(Date.now() - MEMORY_DAYS * 86_400_000).toISOString()));
  // sinais de contas excluídas saem 12 meses depois (trava da conta grátis)
  const signals = await run("sinais de contas excluídas", () => purgeOrphanSignals(db));
  // o histórico da página de status fica 120 dias
  const statusDays = await run("histórico da página de status", () => purgeStatusDaily(db));
  // pedidos de recuperação do segundo fator: os sem confirmação vencem em 24 horas; os encerrados saem em 1 ano
  const mfaRecoveries = await run("recuperações do segundo fator", () => sweepMfaRecoveries(db));
  // pedidos do titular perto do prazo: o dono fica sabendo (2 dias antes e no vencimento)
  const dsrReminders = await run("prazo dos pedidos do titular", () => remindDueRequests(db));
  // aceite pelo link sem a Meta concluir a conexão em 7 dias é apagado
  const acceptances = await run("aceites pendentes", () => deleteStalePending(db));
  // contas com a exclusão vencida (7 dias depois do pedido do dono): canais, assinatura, arquivos e a agência
  const accounts = await run("exclusão de contas", () => runDueAccountDeletions(db));
  // cifra por campo (leva S): o histórico ainda sem cifra é cifrado em lotes, com o tempo que sobrar
  const cipher = await run("recifra do histórico", () => reencryptHistory(db, () => hasTime(), 200));
  // vínculo do WhatsApp sem o sinal de identidade da Meta cai depois de 180 dias sem mensagem (P2)
  const links = await run("vínculos inativos", () => unlinkInactive(db));
  // conversas de antes dos contatos ganham a ficha do contato, em lotes
  const contacts = await run("contatos das conversas antigas", () => linkLegacyConversations(db));
  // auditoria (1 ano) e registros de acesso (6 meses): só a retenção apaga, em lotes
  const logs = await run("registros vencidos", async () => {
    const { data, error } = await db.rpc("purge_logs");
    if (error) throw error;
    return data;
  });
  // o acesso ao Instagram vale 60 dias: renova antes de vencer
  const instagram = await run("tokens do Instagram", () => refreshInstagramTokens(db));
  // o nome de usuário muda no Instagram sem aviso e os links ig.me levam o nome (E1): até 20 s
  const igNames = await run("nomes do Instagram", () => refreshInstagramUsernames(db, deadline(20_000)));
  // cada número e cada conta do Instagram ainda tem o app inscrito (sem isso, nada chega): até 20 s
  const subscriptions = await run("inscrição do app na Meta", () => checkSubscriptions(db, { hasTime: deadline(20_000) }));
  // erro alto de IA ou da Meta nas últimas 24 horas: aviso ao Ruan
  const errors = await run("erro alto", () => checkErrorRates(db));
  // custo de IA: totais do mês e limpeza dos registros com mais de 90 dias
  const aiUsage = await run("totais de IA", async () => {
    const { error } = await db.rpc("ai_usage_rollup");
    if (error) throw error;
    return { ok: true };
  });
  // alarme interno: custo de IA da conta acima de 50% da receita líquida dela no mês (só aviso ao Ruan)
  const aiCost = await run("custo de IA x receita", () => checkAiCostAlarm(db));
  // disco: avisa a partir de 70% (com 95% o banco fica só leitura e os bots param)
  const disk = await run("disco do banco", async () => {
    const h = await checkHealth(db);
    if (h.diskWarning) await notifyPlatform("Disco do banco acima de 70%", [`Uso: ${Math.round((h.diskRatio ?? 0) * 100)}% (${Math.round((h.diskBytes ?? 0) / 1024 / 1024)} MB).`, "Com 95% o Supabase deixa o banco só leitura e todos os bots param. Limpe dados antigos ou migre para o Pro."]);
    return { ratio: h.diskRatio };
  });
  // registros das chamadas à API (D', parte 7): 30 dias
  const apiLogs = await run("registros da API", async () => {
    const { error, count } = await db.from("api_requests").delete({ count: "exact" }).lt("created_at", new Date(Date.now() - 30 * 86_400_000).toISOString());
    if (error) throw error;
    return { apagados: count ?? 0 };
  });
  // resumo ao dono das pessoas convidadas ao portal pela API (D', parte 4c)
  const invites = await run("convites pela API", () => apiInvitesDigest(db));
  const sources = await run("releitura de sites", () => refreshSources(db, hasTime));
  // portão: trechos novos que não couberam depois da leitura e os de regras antigas
  const base = await run("classificação da base", () => classifyPending(db, { budgetMs: 180_000 }));
  // análise do bot: as agendadas (gatilhos agrupados) e os clientes antigos
  // o que sobrar dos 5 minutos da rotina (cada análise é uma chamada de IA)
  // chatbot sem tamanho não fica com canal (o webhook da Stripe já desconecta na hora; aqui, o que sobrou)
  const inbox = await run("chatbots sem tamanho", () => disconnectUnsized(db));
  // domínio próprio sem o pacote sai (o webhook da Stripe já faz na virada; aqui, o que sobrou)
  const domains = await run("domínio sem pacote", () => releaseDomainsWithoutPack(db));
  // bot.month_closed: o fechamento do mês anterior de cada chatbot (só nos 3 primeiros dias do mês)
  const monthClosed = await run("fechamento do mês", () => emitMonthClosed(db));
  const analysis = await run("análise do bot", () => runDueAnalyses(db, { budgetMs: Math.max(0, 285_000 - (Date.now() - started)) }));
  return { inbound, inbox, domains, monthClosed, invites, apiLogs, reports, continuous, retention, files, memories, signals, statusDays, mfaRecoveries, dsrReminders, acceptances, accounts, cipher, links, contacts, logs, instagram, igNames, subscriptions, errors, aiUsage, aiCost, disk, sources, base, analysis };
}
