import { createAdminClient } from "./supabase/admin";
import { checkHealth, type HealthReport } from "./health";

/*
 * Backoffice: qualidade da IA (perguntas sem resposta, recusas, portão, pedidos urgentes) e
 * operação (saúde, fila da Meta, canais, tarefas agendadas). Só leitura, service role.
 */

export interface BotRef {
  name: string;
  client: string;
  agency: string | null;
  agencyId: string;
}

/** Nome do bot, do cliente e da agência para listas que só têm o id do bot. */
export async function botRefs(ids: string[]): Promise<Map<string, BotRef>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const { data } = await createAdminClient().from("bots").select("id, name, client_name, agency_id, agencies(name)").in("id", unique);
  return new Map(
    (data ?? []).map((b) => {
      const agency = (Array.isArray(b.agencies) ? b.agencies[0] : b.agencies) as { name?: string } | null;
      return [b.id as string, { name: b.name as string, client: b.client_name as string, agency: agency?.name ?? null, agencyId: b.agency_id as string }];
    }),
  );
}

/* ------------------------------------------------------------------ qualidade */

export interface QualityCount {
  metric: string;
  key: string;
  n: number;
}

/** Agrupa as contas do banco por métrica (ex.: "recusa_nivel" → { fixo: 3, flexivel: 1 }). */
export function groupQuality(rows: QualityCount[]): Record<string, Array<{ key: string; n: number }>> {
  const out: Record<string, Array<{ key: string; n: number }>> = {};
  for (const r of rows) (out[r.metric] ??= []).push({ key: r.key, n: Number(r.n) || 0 });
  for (const k of Object.keys(out)) out[k].sort((a, b) => b.n - a.n);
  return out;
}

export async function getQuality(since: Date) {
  const db = createAdminClient();
  const [{ data: counts, error }, { data: unanswered }, { data: refusals }, { data: urgent }] = await Promise.all([
    db.rpc("admin_quality_counts", { p_since: since.toISOString() }),
    db.from("unanswered").select("id, bot_id, question, created_at").eq("resolved", false).order("created_at", { ascending: false }).limit(25),
    db.from("scope_refusals").select("id, bot_id, level, request, created_at").gte("created_at", since.toISOString()).order("created_at", { ascending: false }).limit(25),
    db.from("conversations").select("id, bot_id, channel, handoff_urgent_at, handled_at").gte("handoff_urgent_at", since.toISOString()).order("handoff_urgent_at", { ascending: false }).limit(15),
  ]);
  if (error) throw new Error(`qualidade: ${error.message}`);
  const grouped = groupQuality((counts ?? []) as QualityCount[]);
  const ids = [
    ...(unanswered ?? []).map((u) => u.bot_id as string),
    ...(refusals ?? []).map((r) => r.bot_id as string),
    ...(urgent ?? []).map((c) => c.bot_id as string),
    ...(grouped.sem_resposta_bot ?? []).map((x) => x.key),
    ...(grouped.recusa_bot ?? []).map((x) => x.key),
  ];
  return { grouped, unanswered: unanswered ?? [], refusals: refusals ?? [], urgent: urgent ?? [], bots: await botRefs(ids) };
}

/* ------------------------------------------------------------------ operação */

/** Tarefas agendadas (vercel.json): de quanto em quanto tempo cada uma precisa rodar com sucesso. */
export const CRON_EXPECTED_HOURS: Record<string, number> = { diario: 26, drain: 26 };
export const CRON_LABEL: Record<string, string> = { diario: "Rotina diária (retenção, tokens, avisos)", drain: "Varredura da fila da Meta" };

export function cronLate(lastOkAt: string | null, name: string, now = Date.now()): boolean {
  const hours = CRON_EXPECTED_HOURS[name];
  if (!hours) return false;
  return !lastOkAt || now - Date.parse(lastOkAt) > hours * 3_600_000;
}

/** Instagram: token que vence em até 10 dias (a rotina diária renova; se não renovou, avisa). */
export const IG_TOKEN_WARN_DAYS = 10;

export async function getOperations(now = Date.now()) {
  const db = createAdminClient();
  const day = new Date(now - 86_400_000).toISOString();
  const week = new Date(now - 7 * 86_400_000).toISOString();
  const igLimit = new Date(now + IG_TOKEN_WARN_DAYS * 86_400_000).toISOString();
  const head = { count: "exact" as const, head: true };
  const [health, pending, oldest, failed24, failed7, done24, failedList, waDown, waPay, igDown, igExp, crons] = await Promise.all([
    checkHealth(db).catch((e): HealthReport => ({ ok: false, oldestPendingSeconds: null, queueStuck: false, dbWrite: false, dbWriteMs: null, diskBytes: null, diskRatio: null, diskWarning: false, error: (e as Error).message })),
    db.from("inbound_events").select("key_hash", head).in("status", ["received", "processing"]),
    db.from("inbound_events").select("created_at").in("status", ["received", "processing"]).order("created_at").limit(1).maybeSingle(),
    db.from("inbound_events").select("key_hash", head).eq("status", "failed").gte("created_at", day),
    db.from("inbound_events").select("key_hash", head).eq("status", "failed").gte("created_at", week),
    db.from("inbound_events").select("key_hash", head).eq("status", "done").gte("created_at", day),
    db.from("inbound_events").select("key_hash, source, kind, bot_id, attempts, last_error, created_at").eq("status", "failed").gte("created_at", week).order("created_at", { ascending: false }).limit(15),
    db.from("whatsapp_channels").select("bot_id, display_phone, disconnected_at, disconnect_reason").not("disconnected_at", "is", null).order("disconnected_at", { ascending: false }).limit(20),
    db.from("whatsapp_channels").select("bot_id, display_phone, payment_issue_at").is("disconnected_at", null).not("payment_issue_at", "is", null).limit(20),
    db.from("instagram_channels").select("bot_id, username, disconnected_at, disconnect_reason").not("disconnected_at", "is", null).order("disconnected_at", { ascending: false }).limit(20),
    db.from("instagram_channels").select("bot_id, username, token_expires_at").is("disconnected_at", null).lt("token_expires_at", igLimit).limit(20),
    db.from("cron_locks").select("name, last_run_at, last_ok_at").order("name"),
  ]);
  const channels = {
    waDisconnected: waDown.data ?? [],
    waPayment: waPay.data ?? [],
    igDisconnected: igDown.data ?? [],
    igExpiring: igExp.data ?? [],
  };
  const ids = [...(failedList.data ?? []).map((f) => f.bot_id as string), ...Object.values(channels).flatMap((list) => list.map((c) => c.bot_id as string))];
  // tarefas que ainda não rodaram nenhuma vez também aparecem (atrasadas)
  const cronRows = new Map((crons.data ?? []).map((c) => [c.name as string, c]));
  const cronList = Object.keys(CRON_EXPECTED_HOURS).map((name) => {
    const c = cronRows.get(name);
    const lastOkAt = (c?.last_ok_at as string | null) ?? null;
    return { name, label: CRON_LABEL[name] ?? name, lastRunAt: (c?.last_run_at as string | null) ?? null, lastOkAt, late: cronLate(lastOkAt, name, now) };
  });
  return {
    health,
    queue: {
      pending: pending.count ?? 0,
      oldestPendingAt: (oldest.data?.created_at as string | undefined) ?? null,
      failed24h: failed24.count ?? 0,
      failed7d: failed7.count ?? 0,
      done24h: done24.count ?? 0,
      failed: failedList.data ?? [],
    },
    channels,
    crons: cronList,
    bots: await botRefs(ids),
  };
}

/* ------------------------------------------------------------------ conformidade */

export interface SuppressionCount {
  channel: string;
  kind: string;
  reason: string;
  active: number;
  created_since: number;
  revoked_since: number;
}

/**
 * Pedidos de exclusão de dados (Meta), descadastros e o registro de acesso ao backoffice.
 * `email` filtra o registro de acesso por quem entrou.
 */
export async function getCompliance(since: Date, email?: string | null) {
  const db = createAdminClient();
  let log = db.from("admin_access_log").select("id, email, path, created_at").order("created_at", { ascending: false }).limit(100);
  if (email) log = log.ilike("email", `%${email.replace(/[%_]/g, "")}%`);
  const [{ data: deletions }, { data: suppressions, error }, { data: access }, logged] = await Promise.all([
    db.from("deletion_requests").select("code, source, status, summary, created_at, completed_at").order("created_at", { ascending: false }).limit(30),
    db.rpc("admin_suppression_counts", { p_since: since.toISOString() }),
    log,
    db.from("deletion_log").select("id", { count: "exact", head: true }).gte("created_at", since.toISOString()),
  ]);
  if (error) throw new Error(`descadastros: ${error.message}`);
  return {
    deletions: deletions ?? [],
    deletedRowsSince: logged.count ?? 0,
    suppressions: ((suppressions ?? []) as SuppressionCount[]).map((s) => ({ ...s, active: Number(s.active) || 0, created_since: Number(s.created_since) || 0, revoked_since: Number(s.revoked_since) || 0 })),
    access: access ?? [],
  };
}

/** Avisos para o topo da visão geral (vazio = tudo certo). */
export function operationAlerts(ops: Awaited<ReturnType<typeof getOperations>>): string[] {
  const out: string[] = [];
  if (!ops.health.dbWrite) out.push("O banco não aceitou escrita na checagem de saúde.");
  if (ops.health.queueStuck) out.push("A fila de mensagens da Meta está parada (evento pendente há mais de 30 minutos).");
  if (ops.health.diskWarning) out.push(`Disco do banco em ${Math.round((ops.health.diskRatio ?? 0) * 100)}% do limite do plano.`);
  if (ops.queue.failed24h) out.push(`${ops.queue.failed24h} evento(s) da Meta com erro nas últimas 24 h.`);
  if (ops.channels.waPayment.length) out.push(`${ops.channels.waPayment.length} número(s) de WhatsApp com a Meta recusando por falta de pagamento.`);
  if (ops.channels.igExpiring.length) out.push(`${ops.channels.igExpiring.length} conta(s) do Instagram com token vencendo em até ${IG_TOKEN_WARN_DAYS} dias.`);
  for (const c of ops.crons) if (c.late) out.push(`Tarefa agendada atrasada: ${c.label}.`);
  return out;
}
