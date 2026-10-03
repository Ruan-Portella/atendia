import { cache } from "react";
import type Stripe from "stripe";
import { createAdminClient } from "./supabase/admin";
import { planFromPrice, stripe } from "./stripe";
import { PLANS, getPlan, type PlanId } from "./plans";
import { currentPeriodBR, monthStartBR } from "./utils";
import { quotaOf } from "./quota";
import { estimateCost, referencePrices, type UsageLine } from "./whatsapp-usage";
import type { ClientExportRow } from "./client-export";

/*
 * Números do backoffice (/admin). Contas agregadas no banco (funções admin_* da migração 0037);
 * receita direto do Stripe; custo real direto da OpenAI (chave de admin). Tudo só leitura.
 */

/** Dólar para a margem em reais (USD_BRL troca; é estimativa, não câmbio do dia). */
export const usdBrl = () => {
  const v = Number(process.env.USD_BRL);
  return Number.isFinite(v) && v > 0 ? v : 5.5;
};

export const usd = (v: number, digits = 2) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);

/* ------------------------------------------------------------------ períodos */

export type RangeKey = "mes" | "mes-passado" | "30d" | "7d";
export const RANGE_LABEL: Record<RangeKey, string> = { mes: "Este mês", "mes-passado": "Mês passado", "30d": "Últimos 30 dias", "7d": "Últimos 7 dias" };

/** Início do mês em Brasília (UTC-3, sem horário de verão desde 2019). */
export { monthStartBR };

export function rangeFor(key: RangeKey, now = new Date()): { since: Date; until: Date; label: string } {
  const period = currentPeriodBR(now);
  if (key === "mes") return { since: monthStartBR(period), until: now, label: RANGE_LABEL[key] };
  if (key === "mes-passado") {
    const [y, m] = period.split("-").map(Number);
    const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
    return { since: monthStartBR(prev), until: monthStartBR(period), label: RANGE_LABEL[key] };
  }
  const days = key === "7d" ? 7 : 30;
  return { since: new Date(now.getTime() - days * 86_400_000), until: now, label: RANGE_LABEL[key] };
}

/** Instante de N dias atrás (ISO), para filtros "nos últimos N dias". */
export const daysAgoIso = (days: number, now = Date.now()) => new Date(now - days * 86_400_000).toISOString();

export const isRangeKey =(v: string | undefined): v is RangeKey => v === "mes" || v === "mes-passado" || v === "30d" || v === "7d";

/* ------------------------------------------------------------------ custo de IA medido */

export interface AiCostRow {
  kind: string;
  model: string | null;
  channel: string | null;
  agency_id: string;
  calls: number;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  audio_seconds: number;
  cost_usd: number;
  unpriced: number;
}

interface Bucket {
  key: string;
  cost: number;
  calls: number;
}

const KIND_LABEL: Record<string, string> = { resposta: "Respostas", leitura: "Leitura de fontes", transcricao: "Áudio (transcrição)", classificacao: "Classificação (portão e risco)", avaliacao: "Avaliações da IA (testes do backoffice)" };
export const kindLabel = (k: string) => KIND_LABEL[k] ?? k;

/** Agrupa as linhas do banco por tipo, modelo, canal e agência; resposta média e % de cache. */
export function summarizeAiCosts(rows: AiCostRow[]) {
  const n = (v: unknown) => Number(v) || 0;
  const group = (key: (r: AiCostRow) => string, list: AiCostRow[] = rows): Bucket[] => {
    const m = new Map<string, Bucket>();
    for (const r of list) {
      const k = key(r);
      const b = m.get(k) ?? { key: k, cost: 0, calls: 0 };
      b.cost += n(r.cost_usd);
      b.calls += n(r.calls);
      m.set(k, b);
    }
    return [...m.values()].sort((a, b) => b.cost - a.cost);
  };
  const answers = rows.filter((r) => r.kind === "resposta");
  const sum = (rs: AiCostRow[], f: (r: AiCostRow) => number) => rs.reduce((t, r) => t + f(r), 0);
  const answerCalls = sum(answers, (r) => n(r.calls));
  const answerInput = sum(answers, (r) => n(r.input_tokens));
  return {
    total: { cost: sum(rows, (r) => n(r.cost_usd)), calls: sum(rows, (r) => n(r.calls)), unpriced: sum(rows, (r) => n(r.unpriced)) },
    answers: {
      calls: answerCalls,
      cost: sum(answers, (r) => n(r.cost_usd)),
      perAnswer: answerCalls ? sum(answers, (r) => n(r.cost_usd)) / answerCalls : 0,
      avgInput: answerCalls ? Math.round(answerInput / answerCalls) : 0,
      avgOutput: answerCalls ? Math.round(sum(answers, (r) => n(r.output_tokens)) / answerCalls) : 0,
      cachePct: answerInput ? Math.round((sum(answers, (r) => n(r.cached_input_tokens)) / answerInput) * 100) : 0,
    },
    audioMinutes: sum(rows, (r) => n(r.audio_seconds)) / 60,
    byKind: group((r) => r.kind),
    byModel: group((r) => (r.model ?? "—").replace(/-\d{4}-\d{2}-\d{2}$/, "")),
    byChannel: group((r) => r.channel ?? "—"),
    // avaliações (testes do backoffice) são custo da plataforma, não da agência dona do bot de teste
    byAgency: group((r) => r.agency_id, rows.filter((r) => r.kind !== "avaliacao")),
  };
}

export async function getAiCosts(since: Date, until: Date) {
  const db = createAdminClient();
  const [{ data: rows, error }, { data: daily }] = await Promise.all([
    db.rpc("admin_ai_costs", { p_since: since.toISOString(), p_until: until.toISOString() }),
    db.rpc("admin_ai_daily", { p_since: since.toISOString(), p_until: until.toISOString() }),
  ]);
  if (error) throw new Error(`custos de IA: ${error.message}`);
  return { summary: summarizeAiCosts((rows ?? []) as AiCostRow[]), daily: ((daily ?? []) as Array<{ day: string; cost_usd: number; calls: number }>).map((d) => ({ day: d.day, cost: Number(d.cost_usd) || 0, calls: Number(d.calls) || 0 })) };
}

/* ------------------------------------------------------------------ custo real da OpenAI */

export interface OpenAiCostBucket {
  start_time: number;
  results: Array<{ amount?: { value?: number; currency?: string }; line_item?: string | null; project_id?: string | null }>;
}

/** Soma os dias da API de custos: total, por item (modelo, entrada/saída), por projeto e por dia. */
export function sumOpenAiCosts(buckets: OpenAiCostBucket[], projectNames: Record<string, string> = {}) {
  const byItem = new Map<string, number>();
  const byProject = new Map<string, number>();
  const daily: Array<{ day: string; cost: number }> = [];
  let total = 0;
  for (const b of buckets) {
    let dayCost = 0;
    for (const r of b.results) {
      const v = Number(r.amount?.value) || 0;
      dayCost += v;
      const item = r.line_item ?? "outros";
      byItem.set(item, (byItem.get(item) ?? 0) + v);
      const project = r.project_id ? (projectNames[r.project_id] ?? r.project_id) : "sem projeto";
      byProject.set(project, (byProject.get(project) ?? 0) + v);
    }
    total += dayCost;
    daily.push({ day: new Date(b.start_time * 1000).toISOString().slice(0, 10), cost: dayCost });
  }
  const sorted = (m: Map<string, number>) => [...m.entries()].map(([key, cost]) => ({ key, cost })).filter((x) => x.cost > 0).sort((a, b) => b.cost - a.cost);
  return { total, byItem: sorted(byItem), byProject: sorted(byProject), daily };
}

/**
 * Custo real da conta da OpenAI (API de custos da organização; precisa de OPENAI_ADMIN_KEY).
 * null sem a chave. Inclui tudo da organização (produção, dev, avaliações), separado por projeto.
 */
export async function getOpenAiCosts(since: Date, until: Date): Promise<ReturnType<typeof sumOpenAiCosts> | { error: string } | null> {
  const key = process.env.OPENAI_ADMIN_KEY;
  if (!key) return null;
  const headers = { Authorization: `Bearer ${key}` };
  try {
    const buckets: OpenAiCostBucket[] = [];
    let page: string | null = null;
    for (let i = 0; i < 10; i++) {
      const q = new URLSearchParams({ start_time: String(Math.floor(since.getTime() / 1000)), end_time: String(Math.ceil(until.getTime() / 1000)), bucket_width: "1d", limit: "62" });
      q.append("group_by", "line_item");
      q.append("group_by", "project_id");
      if (page) q.set("page", page);
      const res = await fetch(`https://api.openai.com/v1/organization/costs?${q}`, { headers, cache: "no-store" });
      if (!res.ok) return { error: `a OpenAI respondeu ${res.status}: ${(await res.text()).slice(0, 200)}` };
      const json = (await res.json()) as { data?: OpenAiCostBucket[]; has_more?: boolean; next_page?: string | null };
      buckets.push(...(json.data ?? []));
      if (!json.has_more || !json.next_page) break;
      page = json.next_page;
    }
    // nomes dos projetos (se a chave puder listar; sem isso, fica o id)
    const names: Record<string, string> = {};
    const projects = await fetch("https://api.openai.com/v1/organization/projects?limit=100", { headers, cache: "no-store" }).catch(() => null);
    if (projects?.ok) for (const p of ((await projects.json()) as { data?: Array<{ id: string; name: string }> }).data ?? []) names[p.id] = p.name;
    return sumOpenAiCosts(buckets, names);
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/* ------------------------------------------------------------------ receita (Stripe) */

/** Valor mensal de um item de assinatura em centavos (anual ÷ 12, etc.). Descontos não entram. */
export function monthlyCents(item: { price?: { unit_amount?: number | null; recurring?: { interval?: string; interval_count?: number } | null } | null; quantity?: number | null }): number {
  const r = item.price?.recurring;
  if (!r) return 0;
  const amount = (item.price?.unit_amount ?? 0) * (item.quantity ?? 1);
  const count = r.interval_count || 1;
  const months = r.interval === "year" ? 12 * count : r.interval === "month" ? count : r.interval === "week" ? (count * 7) / 30.44 : count / 30.44;
  return amount / months;
}

export interface SubscriptionLike {
  id: string;
  status: string;
  customer: string | { id: string };
  canceled_at?: number | null;
  items: { data: Array<{ price?: { id?: string; unit_amount?: number | null; recurring?: { interval?: string; interval_count?: number } | null } | null; quantity?: number | null }> };
}

/** MRR (ativas e com pagamento atrasado), assinaturas por plano e cancelamentos recentes. */
export function summarizeSubscriptions(subs: SubscriptionLike[], now = Date.now()) {
  const live = subs.filter((s) => s.status === "active" || s.status === "past_due");
  const byPlan = new Map<string, { plan: string; count: number; mrrCents: number }>();
  let mrrCents = 0;
  for (const s of live) {
    const cents = s.items.data.reduce((t, i) => t + monthlyCents(i), 0);
    mrrCents += cents;
    const planId = s.items.data.map((i) => planFromPrice(i.price?.id)).find(Boolean) ?? null;
    const label = planId ? getPlan(planId).name : "outro preço";
    const b = byPlan.get(label) ?? { plan: label, count: 0, mrrCents: 0 };
    b.count += 1;
    b.mrrCents += cents;
    byPlan.set(label, b);
  }
  return {
    mrrCents: Math.round(mrrCents),
    active: subs.filter((s) => s.status === "active").length,
    pastDue: subs.filter((s) => s.status === "past_due" || s.status === "unpaid").length,
    canceled30d: subs.filter((s) => s.status === "canceled" && s.canceled_at && now - s.canceled_at * 1000 < 30 * 86_400_000).length,
    byPlan: [...byPlan.values()].sort((a, b) => b.mrrCents - a.mrrCents),
  };
}

export const getRevenue = cache(async () => {
  if (!stripe) return null;
  try {
    const subs: Stripe.Subscription[] = [];
    for await (const s of stripe.subscriptions.list({ status: "all", limit: 100 })) {
      subs.push(s);
      if (subs.length >= 2000) break;
    }
    const since30 = Math.floor(Date.now() / 1000) - 30 * 86_400;
    const paid: Stripe.Invoice[] = [];
    for await (const inv of stripe.invoices.list({ status: "paid", created: { gte: since30 }, limit: 100 })) {
      paid.push(inv);
      if (paid.length >= 2000) break;
    }
    const open = (await stripe.invoices.list({ status: "open", limit: 50 })).data.filter((i) => (i.attempt_count ?? 0) > 0);
    return {
      ...summarizeSubscriptions(subs as unknown as SubscriptionLike[]),
      paid30dCents: paid.reduce((t, i) => t + (i.amount_paid ?? 0), 0),
      failed: open.map((i) => ({ id: i.id, customer: typeof i.customer === "string" ? i.customer : (i.customer?.id ?? ""), amountCents: i.amount_due ?? 0, attempts: i.attempt_count ?? 0, url: i.hosted_invoice_url ?? null })),
      testMode: process.env.STRIPE_SECRET_KEY?.startsWith("sk_test") ?? false,
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
});

/* ------------------------------------------------------------------ custos fixos (margem completa) */

export interface FixedCost {
  id: number;
  name: string;
  amount: number;
  currency: "BRL" | "USD";
  notes: string | null;
  active: boolean;
}

export async function getFixedCosts(): Promise<FixedCost[]> {
  const { data, error } = await createAdminClient().from("platform_costs").select("id, name, amount, currency, notes, active").order("active", { ascending: false }).order("name");
  if (error) throw new Error(`custos fixos: ${error.message}`);
  return (data ?? []).map((c) => ({ id: Number(c.id), name: c.name as string, amount: Number(c.amount) || 0, currency: c.currency === "USD" ? "USD" : "BRL", notes: (c.notes as string | null) ?? null, active: Boolean(c.active) }));
}

/** Soma mensal dos custos fixos ativos, em reais (os em dólar pelo USD_BRL). */
export const fixedMonthlyBrl = (costs: FixedCost[], fx = usdBrl()) => costs.filter((c) => c.active).reduce((t, c) => t + (c.currency === "USD" ? c.amount * fx : c.amount), 0);

/* ------------------------------------------------------------------ WhatsApp (cobrado pela Meta de cada cliente) */

/**
 * Mensagens do WhatsApp no mês, por categoria e por agência, com a estimativa em reais pela
 * tabela de referência (WHATSAPP_PRICES_BRL). A Meta cobra no cartão de cada cliente: não é custo
 * da BoaVoz, é informação para o suporte (quem está gastando muito com modelos, por exemplo).
 */
export async function getWhatsAppUsage(period: string) {
  const { data, error } = await createAdminClient().rpc("admin_whatsapp_usage", { p_period: period });
  if (error) throw new Error(`WhatsApp: ${error.message}`);
  return summarizeWhatsApp((data ?? []) as Array<{ agency_id: string; category: string; sent: number; billed: number }>);
}

/** Soma por categoria e por agência, com a estimativa em reais (só o que tem preço de referência). */
export function summarizeWhatsApp(data: Array<{ agency_id: string; category: string; sent: number; billed: number }>, prices = referencePrices()) {
  const rows = data.map((r) => ({ agency: r.agency_id, category: r.category, sent: Number(r.sent) || 0, billed: Number(r.billed) || 0 }));
  const byCategory = new Map<string, UsageLine>();
  const byAgency = new Map<string, UsageLine[]>();
  for (const r of rows) {
    const c = byCategory.get(r.category) ?? { category: r.category, sent: 0, billed: 0 };
    c.sent += r.sent;
    c.billed += r.billed;
    byCategory.set(r.category, c);
    byAgency.set(r.agency, [...(byAgency.get(r.agency) ?? []), { category: r.category, sent: r.sent, billed: r.billed }]);
  }
  const categories = [...byCategory.values()].sort((a, b) => b.sent - a.sent);
  const total = estimateCost(categories, prices);
  return {
    sent: categories.reduce((t, c) => t + c.sent, 0),
    billed: categories.reduce((t, c) => t + c.billed, 0),
    estimateBrl: total.total,
    unpriced: total.unpriced,
    categories,
    agencies: [...byAgency.entries()]
      .map(([agency, lines]) => ({ agency, sent: lines.reduce((t, l) => t + l.sent, 0), billed: lines.reduce((t, l) => t + l.billed, 0), estimateBrl: estimateCost(lines, prices).total }))
      .sort((a, b) => b.estimateBrl - a.estimateBrl || b.sent - a.sent),
  };
}

/* ------------------------------------------------------------------ plataforma */

export interface AgencyRow {
  id: string;
  name: string;
  email: string | null;
  plan: PlanId | string;
  planName: string;
  priceBrl: number;
  trialEndsAt: string;
  createdAt: string;
  stripeCustomerId: string | null;
  bots: number;
  liveBots: number;
  whatsapp: number;
  instagram: number;
  /** Recursos liberados pelo BoaVoz (features.ts). */
  features: string[];
  /** Atendimentos do mês (a unidade da cota). */
  atendimentosMonth: number;
  quota: number;
  aiCostMonthUsd: number;
  lastActivity: string | null;
  /** IA pausada pelo backoffice só para esta agência. */
  aiPausedAt: string | null;
  aiPausedReason: string | null;
}

/** E-mail de quem é dono de cada agência (Auth do Supabase, até alguns milhares de contas). */
async function ownerEmails(): Promise<Map<string, string>> {
  const db = createAdminClient();
  const map = new Map<string, string>();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error || !data.users.length) break;
    for (const u of data.users) if (u.email) map.set(u.id, u.email);
    if (data.users.length < 1000) break;
  }
  return map;
}

export const getAgencies = cache(async (): Promise<AgencyRow[]> => {
  const db = createAdminClient();
  const period = currentPeriodBR();
  const [{ data: agencies, error }, { data: stats }, emails] = await Promise.all([
    db.from("agencies").select("id, owner_id, name, plan, quota_override, features, trial_ends_at, created_at, stripe_customer_id, ai_paused_at, ai_paused_reason").not("owner_id", "is", null).order("created_at", { ascending: false }),
    db.rpc("admin_agency_stats", { p_period: period, p_month_start: monthStartBR(period).toISOString() }),
    ownerEmails(),
  ]);
  if (error) throw new Error(`agências: ${error.message}`);
  const byId = new Map(((stats ?? []) as Array<Record<string, unknown>>).map((s) => [s.agency_id as string, s]));
  return (agencies ?? []).map((a) => {
    const s = byId.get(a.id as string) ?? {};
    const plan = getPlan(a.plan as string);
    return {
      id: a.id as string,
      name: a.name as string,
      email: emails.get(a.owner_id as string) ?? null,
      plan: a.plan as string,
      planName: plan.name,
      priceBrl: plan.priceBrl,
      trialEndsAt: a.trial_ends_at as string,
      createdAt: a.created_at as string,
      stripeCustomerId: (a.stripe_customer_id as string | null) ?? null,
      bots: Number(s.bots) || 0,
      liveBots: Number(s.live_bots) || 0,
      whatsapp: Number(s.whatsapp) || 0,
      instagram: Number(s.instagram) || 0,
      features: (a.features as string[] | null) ?? [],
      atendimentosMonth: Number(s.atendimentos_month) || 0,
      quota: quotaOf({ plan: a.plan as string, quota_override: a.quota_override as number | null }),
      aiCostMonthUsd: Number(s.ai_cost_month) || 0,
      lastActivity: (s.last_activity as string | null) ?? null,
      aiPausedAt: (a.ai_paused_at as string | null) ?? null,
      aiPausedReason: (a.ai_paused_reason as string | null) ?? null,
    };
  });
});

/** Situação da agência para os filtros: em teste, teste vencido, pagante, cancelada. */
export function agencyStatus(a: Pick<AgencyRow, "plan" | "trialEndsAt">, now = Date.now()): "teste" | "teste_vencido" | "pagante" | "cancelada" {
  if (a.plan === "trial") return new Date(a.trialEndsAt).getTime() > now ? "teste" : "teste_vencido";
  if (a.plan in PLANS) return "pagante";
  return "cancelada";
}

export async function getActivity(days: number) {
  const db = createAdminClient();
  const [{ data: daily, error }, { data: channels }] = await Promise.all([db.rpc("admin_daily_activity", { p_days: days }), db.rpc("admin_channel_split", { p_days: days })]);
  if (error) throw new Error(`atividade: ${error.message}`);
  return {
    daily: ((daily ?? []) as Array<Record<string, unknown>>).map((d) => ({
      day: String(d.day),
      conversations: Number(d.conversations) || 0,
      contact: Number(d.contact_messages) || 0,
      bot: Number(d.bot_messages) || 0,
      team: Number(d.team_messages) || 0,
    })),
    channels: ((channels ?? []) as Array<{ channel: string; conversations: number }>).map((c) => ({ channel: c.channel, conversations: Number(c.conversations) || 0 })),
  };
}

export async function getBotCounts() {
  const db = createAdminClient();
  const [all, live, demos, wa, ig] = await Promise.all([
    db.from("bots").select("id", { count: "exact", head: true }).eq("is_demo", false),
    db.from("bots").select("id", { count: "exact", head: true }).eq("is_demo", false).eq("status", "live"),
    db.from("bots").select("id", { count: "exact", head: true }).eq("is_demo", true),
    db.from("whatsapp_channels").select("bot_id", { count: "exact", head: true }).is("disconnected_at", null),
    db.from("instagram_channels").select("bot_id", { count: "exact", head: true }).is("disconnected_at", null),
  ]);
  return { bots: all.count ?? 0, live: live.count ?? 0, demos: demos.count ?? 0, whatsapp: wa.count ?? 0, instagram: ig.count ?? 0 };
}

/** Novo fim do teste: a partir de hoje ou do fim atual, o que vier depois. */
export function extendedTrialEnd(currentEnd: string | null | undefined, days: number, now = Date.now()): string {
  const base = Math.max(now, (currentEnd && Date.parse(currentEnd)) || 0);
  return new Date(base + days * 86_400_000).toISOString();
}

/** Chave geral da IA (todas as agências). */
export interface PlatformFlags {
  aiPausedAt: string | null;
  aiPausedReason: string | null;
  whatsappDisabledAt: string | null;
  whatsappDisabledReason: string | null;
  /** Abertura geral dos canais (features.ts). */
  whatsappOpenAt: string | null;
  instagramOpenAt: string | null;
  updatedBy: string | null;
}

export async function getPlatformFlags(): Promise<PlatformFlags> {
  const { data } = await createAdminClient().from("platform_flags").select("ai_paused_at, ai_paused_reason, whatsapp_disabled_at, whatsapp_disabled_reason, whatsapp_open_at, instagram_open_at, updated_by").eq("id", 1).maybeSingle();
  const v = (k: string) => ((data as Record<string, unknown> | null)?.[k] as string | null) ?? null;
  return { aiPausedAt: v("ai_paused_at"), aiPausedReason: v("ai_paused_reason"), whatsappDisabledAt: v("whatsapp_disabled_at"), whatsappDisabledReason: v("whatsapp_disabled_reason"), whatsappOpenAt: v("whatsapp_open_at"), instagramOpenAt: v("instagram_open_at"), updatedBy: v("updated_by") };
}

/** Uma medida de enforcement_actions, com o nome da agência e do chatbot para a tela. */
export interface MeasureRow {
  id: number;
  source: "boavoz" | "meta_order" | "meta_violation" | "meta_restriction";
  feature: "channel" | "regulados" | "restricao" | "outro";
  channel: string;
  agencyId: string | null;
  agencyName: string | null;
  botId: string | null;
  botLabel: string | null;
  wabaId: string | null;
  reason: string | null;
  createdBy: string | null;
  createdAt: string;
  liftedAt: string | null;
  liftedBy: string | null;
}

/** Medidas ativas (e as levantadas há pouco, com active=false), da mais nova para a mais antiga. */
export async function getMeasures(opts: { agencyId?: string; active?: boolean; limit?: number } = {}): Promise<MeasureRow[]> {
  let q = createAdminClient()
    .from("enforcement_actions")
    .select("id, source, feature, channel, agency_id, bot_id, waba_id, reason, created_by, created_at, lifted_at, lifted_by, agencies(name), bots(name, client_name)")
    .order("id", { ascending: false })
    .limit(opts.limit ?? 50);
  if (opts.agencyId) q = q.eq("agency_id", opts.agencyId);
  if (opts.active) q = q.is("lifted_at", null);
  const { data } = await q;
  const one = <T,>(x: T | T[] | null | undefined) => (Array.isArray(x) ? x[0] : x) ?? null;
  return (data ?? []).map((r) => {
    const agency = one(r.agencies as { name: string } | { name: string }[] | null);
    const bot = one(r.bots as { name: string; client_name: string } | { name: string; client_name: string }[] | null);
    return {
      id: r.id as number,
      source: r.source as MeasureRow["source"],
      feature: r.feature as MeasureRow["feature"],
      channel: r.channel as string,
      agencyId: (r.agency_id as string | null) ?? null,
      agencyName: agency?.name ?? null,
      botId: (r.bot_id as string | null) ?? null,
      botLabel: bot ? `${bot.name} · ${bot.client_name}` : null,
      wabaId: (r.waba_id as string | null) ?? null,
      reason: (r.reason as string | null) ?? null,
      createdBy: (r.created_by as string | null) ?? null,
      createdAt: r.created_at as string,
      liftedAt: (r.lifted_at as string | null) ?? null,
      liftedBy: (r.lifted_by as string | null) ?? null,
    };
  });
}

/* ------------------------------------------------------------------ revisão do negócio (tela de aceite) */

export interface ReviewRow {
  clientId: string;
  clientName: string;
  agencyId: string;
  agencyName: string | null;
  status: "ativo" | "em_revisao" | "aguardando_revisao" | "bloqueado";
  answers: Record<string, string>;
  answeredAt: string;
  answeredBy: string | null;
  reviewDueAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewNote: string | null;
  /** Prazo de resposta ao cliente já passou. */
  overdue: boolean;
}

/** Negócios em revisão (primeiro os que seguram o WhatsApp) e os revisados há pouco. */
export async function getBusinessReviews(): Promise<{ open: ReviewRow[]; recent: ReviewRow[] }> {
  const db = createAdminClient();
  const cols = "client_id, agency_id, status, answers, answered_at, answered_by, review_due_at, reviewed_at, reviewed_by, review_note, clients(name), agencies(name)";
  const [{ data: open }, { data: recent }] = await Promise.all([
    db.from("business_compliance").select(cols).in("status", ["aguardando_revisao", "em_revisao"]).order("review_due_at", { ascending: true }).limit(50),
    db.from("business_compliance").select(cols).not("reviewed_at", "is", null).order("reviewed_at", { ascending: false }).limit(10),
  ]);
  const one = <T,>(x: T | T[] | null | undefined) => (Array.isArray(x) ? x[0] : x) ?? null;
  const map = (r: Record<string, unknown>): ReviewRow => ({
    clientId: r.client_id as string,
    clientName: one(r.clients as { name: string } | null)?.name ?? "cliente apagado",
    agencyId: r.agency_id as string,
    agencyName: one(r.agencies as { name: string } | null)?.name ?? null,
    status: r.status as ReviewRow["status"],
    answers: (r.answers ?? {}) as Record<string, string>,
    answeredAt: r.answered_at as string,
    answeredBy: (r.answered_by as string | null) ?? null,
    reviewDueAt: (r.review_due_at as string | null) ?? null,
    reviewedAt: (r.reviewed_at as string | null) ?? null,
    reviewedBy: (r.reviewed_by as string | null) ?? null,
    reviewNote: (r.review_note as string | null) ?? null,
    overdue: Boolean(r.review_due_at) && Date.parse(r.review_due_at as string) < Date.now(),
  });
  const rows = (open ?? []).map(map);
  // os que seguram o WhatsApp primeiro; depois pelo prazo
  rows.sort((a, b) => Number(b.status === "aguardando_revisao") - Number(a.status === "aguardando_revisao") || String(a.reviewDueAt).localeCompare(String(b.reviewDueAt)));
  return { open: rows, recent: (recent ?? []).map(map) };
}

export interface AcceptanceRow {
  id: number;
  channel: string;
  version: string;
  via: string;
  status: string;
  who: string;
  metaName: string | null;
  clientName: string | null;
  agencyName: string | null;
  at: string;
}

/** Últimos aceites (confirmados e pendentes do link). */
export async function getRecentAcceptances(limit = 20): Promise<AcceptanceRow[]> {
  const { data } = await createAdminClient()
    .from("business_acceptances")
    .select("id, channel, version, via, status, accepted_by_name, accepted_by_email, meta_verified_name, created_at, confirmed_at, clients(name), agencies(name)")
    .order("id", { ascending: false })
    .limit(limit);
  const one = <T,>(x: T | T[] | null | undefined) => (Array.isArray(x) ? x[0] : x) ?? null;
  return (data ?? []).map((r) => ({
    id: r.id as number,
    channel: r.channel as string,
    version: r.version as string,
    via: r.via as string,
    status: r.status as string,
    who: r.accepted_by_name ? `${r.accepted_by_name} <${r.accepted_by_email}>` : (r.accepted_by_email as string),
    metaName: (r.meta_verified_name as string | null) ?? null,
    clientName: one(r.clients as { name: string } | { name: string }[] | null)?.name ?? null,
    agencyName: one(r.agencies as { name: string } | { name: string }[] | null)?.name ?? null,
    at: (r.confirmed_at as string | null) ?? (r.created_at as string),
  }));
}

/* ------------------------------------------------------------------ incidentes de segurança */

export interface IncidentRow {
  id: number;
  title: string;
  severity: "baixo" | "medio" | "alto";
  status: "aberto" | "contido" | "encerrado";
  detectedAt: string;
  description: string | null;
  affected: string | null;
  actions: string | null;
  riskRelevant: boolean | null;
  agenciesNotifiedAt: string | null;
  anpdNotifiedAt: string | null;
  closedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  updatedAt: string;
}

/** Incidentes, os abertos primeiro (docs/incidentes.md). */
export async function getIncidents(limit = 30): Promise<IncidentRow[]> {
  const { data } = await createAdminClient().from("security_incidents").select("*").order("detected_at", { ascending: false }).limit(limit);
  const rows = (data ?? []).map((r) => ({
    id: r.id as number,
    title: r.title as string,
    severity: r.severity as IncidentRow["severity"],
    status: r.status as IncidentRow["status"],
    detectedAt: r.detected_at as string,
    description: (r.description as string | null) ?? null,
    affected: (r.affected as string | null) ?? null,
    actions: (r.actions as string | null) ?? null,
    riskRelevant: (r.risk_relevant as boolean | null) ?? null,
    agenciesNotifiedAt: (r.agencies_notified_at as string | null) ?? null,
    anpdNotifiedAt: (r.anpd_notified_at as string | null) ?? null,
    closedAt: (r.closed_at as string | null) ?? null,
    createdBy: (r.created_by as string | null) ?? null,
    updatedBy: (r.updated_by as string | null) ?? null,
    updatedAt: r.updated_at as string,
  }));
  return rows.sort((a, b) => Number(a.status === "encerrado") - Number(b.status === "encerrado"));
}

/* ------------------------------------------------------------------ lista de clientes exportável */

export const AGENCY_STATUS_LABEL = { pagante: "Pagante", teste: "Em teste", teste_vencido: "Teste vencido", cancelada: "Cancelada" } as const;

/** Trechos da base por chatbot. */
export async function botChunkCounts(botIds: string[]): Promise<Map<string, number>> {
  if (!botIds.length) return new Map();
  const { data, error } = await createAdminClient().rpc("admin_bot_chunk_counts", { p_bot_ids: botIds });
  if (error) throw new Error(`trechos por chatbot: ${error.message}`);
  return new Map(((data ?? []) as Array<{ bot_id: string; chunks: number | string }>).map((r) => [r.bot_id, Number(r.chunks) || 0]));
}

/** Uma linha por chatbot (sem as demos), para a tela e para o CSV. */
export async function getClientExport(): Promise<ClientExportRow[]> {
  const [{ data, error }, agencies] = await Promise.all([createAdminClient().rpc("admin_client_export"), getAgencies()]);
  if (error) throw new Error(`lista de clientes: ${error.message}`);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const chunks = await botChunkCounts(rows.map((r) => r.bot_id as string));
  const byId = new Map(agencies.map((a) => [a.id, a]));
  const s = (v: unknown) => (v as string | null) ?? null;
  return rows.map((r) => {
    const a = byId.get(r.agency_id as string);
    return {
      agencyId: r.agency_id as string,
      agencyName: r.agency_name as string,
      ownerEmail: a?.email ?? null,
      planName: a?.planName ?? getPlan(r.plan as string).name,
      agencySituation: a ? AGENCY_STATUS_LABEL[agencyStatus(a)] : "",
      clientId: s(r.client_id),
      clientName: (r.client_name as string | null) ?? "",
      botId: r.bot_id as string,
      botName: r.bot_name as string,
      botStatus: r.bot_status as string,
      botCreatedAt: r.bot_created_at as string,
      chunks: chunks.get(r.bot_id as string) ?? 0,
      waPhone: s(r.wa_phone),
      wabaId: s(r.waba_id),
      businessId: s(r.business_id),
      coexistence: Boolean(r.coexistence),
      waConnectedAt: s(r.wa_connected_at),
      waDisconnectedAt: s(r.wa_disconnected_at),
      waDisconnectReason: s(r.wa_disconnect_reason),
      igUsername: s(r.ig_username),
      igConnected: r.has_instagram ? !r.ig_disconnected_at : null,
      complianceStatus: s(r.compliance_status),
    };
  });
}

/* ------------------------------------------------------------------ "isto não é {categoria}" (portão) */

export interface GateReviewRow {
  id: number;
  agencyId: string;
  agencyName: string | null;
  botId: string;
  botName: string;
  clientName: string;
  conversationId: string | null;
  category: string;
  note: string | null;
  status: "pendente" | "aprovado" | "recusado";
  requestedBy: string;
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

export interface GateExceptionRow {
  botId: string;
  botName: string;
  clientName: string;
  agencyId: string;
  agencyName: string | null;
  category: string;
  approvedBy: string;
  createdAt: string;
}

/** Pedidos de revisão do portão (abertos e os últimos decididos) e as exceções ativas. */
export async function getGateReviews(): Promise<{ open: GateReviewRow[]; recent: GateReviewRow[]; exceptions: GateExceptionRow[] }> {
  const db = createAdminClient();
  const cols = "id, agency_id, bot_id, conversation_id, category, note, status, requested_by, created_at, decided_by, decided_at, decision_note, bots(name, client_name), agencies(name)";
  const [{ data: open }, { data: recent }, { data: exceptions }] = await Promise.all([
    db.from("gate_review_requests").select(cols).eq("status", "pendente").order("created_at").limit(50),
    db.from("gate_review_requests").select(cols).neq("status", "pendente").order("decided_at", { ascending: false }).limit(10),
    db.from("bot_gate_exceptions").select("bot_id, category, approved_by, created_at, bots(name, client_name, agency_id, agencies(name))").order("created_at", { ascending: false }).limit(100),
  ]);
  const one = <T,>(x: T | T[] | null | undefined) => (Array.isArray(x) ? x[0] : x) ?? null;
  const map = (r: Record<string, unknown>): GateReviewRow => {
    const bot = one(r.bots as { name: string; client_name: string } | null);
    return {
      id: r.id as number,
      agencyId: r.agency_id as string,
      agencyName: one(r.agencies as { name: string } | null)?.name ?? null,
      botId: r.bot_id as string,
      botName: bot?.name ?? "chatbot apagado",
      clientName: bot?.client_name ?? "",
      conversationId: (r.conversation_id as string | null) ?? null,
      category: r.category as string,
      note: (r.note as string | null) ?? null,
      status: r.status as GateReviewRow["status"],
      requestedBy: r.requested_by as string,
      createdAt: r.created_at as string,
      decidedBy: (r.decided_by as string | null) ?? null,
      decidedAt: (r.decided_at as string | null) ?? null,
      decisionNote: (r.decision_note as string | null) ?? null,
    };
  };
  return {
    open: (open ?? []).map(map),
    recent: (recent ?? []).map(map),
    exceptions: (exceptions ?? []).map((e) => {
      type BotRef = { name: string; client_name: string; agency_id: string; agencies: { name: string } | { name: string }[] | null };
      const bot = one(e.bots as unknown as BotRef | BotRef[] | null);
      return {
        botId: e.bot_id as string,
        botName: bot?.name ?? "chatbot apagado",
        clientName: bot?.client_name ?? "",
        agencyId: bot?.agency_id ?? "",
        agencyName: one(bot?.agencies)?.name ?? null,
        category: e.category as string,
        approvedBy: e.approved_by as string,
        createdAt: e.created_at as string,
      };
    }),
  };
}
