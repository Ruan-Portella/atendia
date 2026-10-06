import type { SupabaseClient } from "@supabase/supabase-js";
import { getPlan } from "./plans";
import { inviteOpen, memberLimit, type AgencyMember } from "./team";
import { audit, type AuditActor } from "./audit";
import { notifyAgencyOwner } from "./notify";
import { appUrl } from "./utils";

/*
 * Excedente do plano (leva B1', parte 4b; spec "Downgrade pausa o excedente sem apagar"): depois
 * de uma troca de plano, o que passa do limite novo fica pausado (paused_by_plan_at), nada é
 * apagado. A escolha automática mantém os chatbots com conversa mais recente, a equipe mais antiga
 * (o dono nunca pausa) e os webhooks mais antigos; a agência troca em Cobrança > Limites do plano.
 * Subindo de plano, o que estava pausado volta sozinho até o limite novo. Plano cancelado não passa
 * por aqui: o encerramento tem a carência própria (modo só humano).
 */

export type PlanItemKind = "bot" | "member" | "webhook";

export interface PlanLimits {
  bots: number;
  /** Pessoas da equipe, contando o dono e os convites pendentes. */
  members: number;
  /** Um por cliente: igual ao limite de chatbots, só com Integrações. */
  webhooks: number;
  /** Ações e webhooks. O Freelancer não tem; o teste grátis segue o Agência. */
  integrations: boolean;
}

/** Limites do plano. Pura. */
export function planLimits(planId: string): PlanLimits {
  const plan = getPlan(planId);
  const integrations = plan.id === "trial" || plan.id === "agencia" || plan.id === "escala";
  return { bots: plan.bots, members: memberLimit(plan.id), webhooks: integrations ? plan.bots : 0, integrations };
}

export interface FitItem {
  id: string;
  paused: boolean;
  /** Nunca pausa (o dono da agência). */
  keep?: boolean;
}

/**
 * Quem pausa e quem volta para caber no limite. `items` vem na ordem de prioridade (o primeiro fica
 * antes). Ativos além do limite: pausa os últimos. Sobrando vaga: voltam os primeiros pausados. Pura.
 */
export function fitToLimit(items: FitItem[], limit: number): { pause: string[]; resume: string[] } {
  const active = items.filter((i) => !i.paused);
  if (active.length > limit) {
    const kept = active.filter((i) => i.keep).length;
    const others = active.filter((i) => !i.keep);
    return { pause: others.slice(Math.max(0, limit - kept)).map((i) => i.id), resume: [] };
  }
  const room = limit - active.length;
  return { pause: [], resume: items.filter((i) => i.paused).slice(0, room).map((i) => i.id) };
}

export interface PlanBot {
  id: string;
  name: string;
  client_name: string | null;
  created_at: string;
  paused_by_plan_at: string | null;
  /** Última mensagem em qualquer conversa do chatbot. */
  last_activity: string | null;
}

export type PlanMember = Pick<AgencyMember, "id" | "email" | "display_name" | "role" | "user_id" | "invited_at" | "accepted_at" | "removed_at" | "invite_expires_at" | "paused_by_plan_at">;

export interface PlanWebhook {
  id: string;
  name: string;
  url: string;
  active: boolean;
  created_at: string;
  paused_by_plan_at: string | null;
}

export interface PlanSnapshot {
  planId: string;
  planName: string;
  limits: PlanLimits;
  bots: PlanBot[];
  /** Ocupam vaga: aceitos e convites ainda valendo (vencidos e removidos ficam de fora). */
  members: PlanMember[];
  webhooks: PlanWebhook[];
  actions: { active: number; pausedByPlan: number };
}

const ROLE_ORDER: Record<string, number> = { owner: 0, admin: 1, editor: 2, agent: 3 };
const time = (v: string | null | undefined) => (v ? Date.parse(v) : 0);

/** Ordem de prioridade dos chatbots: conversa mais recente primeiro; sem conversa, os mais antigos. Pura. */
export const botPriority = (a: PlanBot, b: PlanBot) => time(b.last_activity) - time(a.last_activity) || time(a.created_at) - time(b.created_at);

/** Equipe: dono, depois quem já entrou (admin, editor, atendente; os mais antigos antes), por último os convites. Pura. */
export const memberPriority = (a: PlanMember, b: PlanMember) =>
  Number(!a.accepted_at) - Number(!b.accepted_at) || ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || time(a.accepted_at ?? a.invited_at) - time(b.accepted_at ?? b.invited_at);

/** Webhooks: os mais antigos primeiro. Pura. */
export const webhookPriority = (a: PlanWebhook, b: PlanWebhook) => time(a.created_at) - time(b.created_at);

export async function planSnapshot(db: SupabaseClient, agencyId: string): Promise<PlanSnapshot | null> {
  const { data: agency } = await db.from("agencies").select("plan").eq("id", agencyId).maybeSingle();
  if (!agency) return null;
  const plan = getPlan(agency.plan as string);
  const [{ data: bots }, { data: members }, { data: webhooks }, { data: actions }] = await Promise.all([
    db.from("bots").select("id, name, client_name, created_at, paused_by_plan_at").eq("agency_id", agencyId).eq("is_demo", false),
    db.from("agency_members").select("id, email, display_name, role, user_id, invited_at, accepted_at, removed_at, invite_expires_at, paused_by_plan_at").eq("agency_id", agencyId).is("removed_at", null),
    db.from("webhooks").select("id, name, url, active, created_at, paused_by_plan_at").eq("agency_id", agencyId),
    db.from("actions").select("id, paused_by_plan_at, bots!inner(agency_id)").eq("bots.agency_id", agencyId),
  ]);
  const last = await Promise.all(
    (bots ?? []).map(async (b) => {
      const { data } = await db.from("conversations").select("last_message_at").eq("bot_id", b.id).order("last_message_at", { ascending: false }).limit(1).maybeSingle();
      return [b.id as string, (data?.last_message_at as string | undefined) ?? null] as const;
    }),
  );
  const lastBy = new Map(last);
  const actionRows = (actions ?? []) as Array<{ paused_by_plan_at: string | null }>;
  return {
    planId: plan.id,
    planName: plan.name,
    limits: planLimits(plan.id),
    bots: ((bots ?? []) as Omit<PlanBot, "last_activity">[]).map((b) => ({ ...b, last_activity: lastBy.get(b.id) ?? null })).sort(botPriority),
    members: ((members ?? []) as PlanMember[]).filter((m) => m.accepted_at || inviteOpen(m)).sort(memberPriority),
    webhooks: ((webhooks ?? []) as PlanWebhook[]).sort(webhookPriority),
    actions: { active: actionRows.filter((a) => !a.paused_by_plan_at).length, pausedByPlan: actionRows.filter((a) => a.paused_by_plan_at).length },
  };
}

export interface PlanChanges {
  bots: { pause: string[]; resume: string[] };
  members: { pause: string[]; resume: string[] };
  webhooks: { pause: string[]; resume: string[] };
  /** Ações: todas pausam sem Integrações e voltam com elas. */
  actions: "pause" | "resume" | null;
}

/** O que muda para caber no plano. Pura. */
export function planChanges(s: PlanSnapshot): PlanChanges {
  return {
    bots: fitToLimit(s.bots.map((b) => ({ id: b.id, paused: Boolean(b.paused_by_plan_at) })), s.limits.bots),
    members: fitToLimit(s.members.map((m) => ({ id: m.id, paused: Boolean(m.paused_by_plan_at), keep: m.role === "owner" })), s.limits.members),
    webhooks: fitToLimit(s.webhooks.map((w) => ({ id: w.id, paused: Boolean(w.paused_by_plan_at) })), s.limits.webhooks),
    actions: !s.limits.integrations && s.actions.active ? "pause" : s.limits.integrations && s.actions.pausedByPlan ? "resume" : null,
  };
}

const TABLE: Record<PlanItemKind, string> = { bot: "bots", member: "agency_members", webhook: "webhooks" };

async function setPaused(db: SupabaseClient, kind: PlanItemKind, agencyId: string, ids: string[], at: string | null) {
  if (!ids.length) return;
  const { error } = await db.from(TABLE[kind]).update({ paused_by_plan_at: at }).eq("agency_id", agencyId).in("id", ids);
  if (error) throw error;
}

async function setActionsPaused(db: SupabaseClient, agencyId: string, at: string | null) {
  const { data } = await db.from("actions").select("id, bots!inner(agency_id)").eq("bots.agency_id", agencyId).filter("paused_by_plan_at", at ? "is" : "not.is", null);
  const ids = (data ?? []).map((a) => a.id as string);
  if (!ids.length) return;
  const { error } = await db.from("actions").update({ paused_by_plan_at: at }).in("id", ids);
  if (error) throw error;
}


/**
 * Depois de uma troca de plano: pausa o excedente e devolve o que cabe. Avisa o dono por e-mail
 * quando algo foi pausado. Plano cancelado: nada (o encerramento cuida).
 */
export async function applyPlanLimits(db: SupabaseClient, agencyId: string, actor: { type: AuditActor; id: string | null } = { type: "system", id: null }): Promise<PlanChanges | null> {
  const s = await planSnapshot(db, agencyId);
  if (!s || s.planId === "cancelado") return null;
  const c = planChanges(s);
  const now = new Date().toISOString();
  for (const kind of ["bot", "member", "webhook"] as const) {
    const ch = c[`${kind}s`];
    await setPaused(db, kind, agencyId, ch.pause, now);
    await setPaused(db, kind, agencyId, ch.resume, null);
  }
  if (c.actions) await setActionsPaused(db, agencyId, c.actions === "pause" ? now : null);

  const changed = [c.bots, c.members, c.webhooks].some((x) => x.pause.length || x.resume.length) || c.actions !== null;
  if (!changed) return c;
  await audit(db, { agencyId, actorType: actor.type, actorId: actor.id, action: "plano.excedente", targetType: "agency", targetId: agencyId, after: { plano: s.planId, ...c } });

  const name = <T extends { id: string }>(list: T[], ids: string[], label: (x: T) => string) => list.filter((x) => ids.includes(x.id)).map(label);
  const paused = [
    ...name(s.bots, c.bots.pause, (b) => `Chatbot ${b.name}${b.client_name ? ` (${b.client_name})` : ""}`),
    ...name(s.members, c.members.pause, (m) => `Equipe: ${m.display_name ?? m.email}${m.accepted_at ? "" : " (convite)"}`),
    ...name(s.webhooks, c.webhooks.pause, (w) => `Webhook ${w.name}`),
    ...(c.actions === "pause" ? [`Ações dos chatbots (${s.actions.active}): o plano ${s.planName} não tem Integrações`] : []),
  ];
  if (paused.length) {
    await notifyAgencyOwner(db, agencyId, `Plano ${s.planName}: alguns itens foram pausados`, [
      `Sua conta mudou para o plano ${s.planName}. O que passou do limite foi pausado, sem apagar nada:`,
      ...paused.map((p) => `• ${p}`),
      "Chatbot pausado fica em modo só humano: a IA não responde e a sua equipe continua respondendo pelo painel.",
      `Para escolher o que fica ativo, abra Cobrança > Limites do plano: ${appUrl("/painel/cobranca/limites")}`,
    ]).catch(() => false);
  }
  return c;
}

export const KIND_LABEL: Record<PlanItemKind, { one: string; limit: (l: PlanLimits) => number }> = {
  bot: { one: "chatbot", limit: (l) => l.bots },
  member: { one: "pessoa da equipe", limit: (l) => l.members },
  webhook: { one: "webhook", limit: (l) => l.webhooks },
};

/**
 * A agência troca o que fica ativo (Cobrança > Limites do plano). Ativar só com vaga no plano; o
 * dono nunca pausa.
 */
export async function setPlanPause(db: SupabaseClient, agencyId: string, kind: PlanItemKind, id: string, pause: boolean, actor: { type: AuditActor; id: string | null }): Promise<{ ok: true } | { error: string }> {
  const s = await planSnapshot(db, agencyId);
  if (!s) return { error: "Agência não encontrada." };
  if (s.planId === "cancelado") return { error: "A assinatura está cancelada: assine um plano para escolher o que fica ativo." };
  const list: Array<{ id: string; paused_by_plan_at: string | null; role?: string }> = kind === "bot" ? s.bots : kind === "member" ? s.members : s.webhooks;
  const item = list.find((x) => x.id === id);
  if (!item) return { error: "Item não encontrado." };
  if (pause) {
    if (item.role === "owner") return { error: "O dono da agência não é pausado." };
    if (item.paused_by_plan_at) return { ok: true };
  } else {
    if (!item.paused_by_plan_at) return { ok: true };
    if (kind === "webhook" && !s.limits.integrations) return { error: `O plano ${s.planName} não tem Integrações: os webhooks voltam quando a conta mudar para o Agência ou o Escala.` };
    const limit = KIND_LABEL[kind].limit(s.limits);
    const active = list.filter((x) => !x.paused_by_plan_at).length;
    if (active >= limit) return { error: `O plano ${s.planName} permite ${limit} ${kind === "member" ? "pessoas na equipe (contando você e os convites)" : kind === "bot" ? "chatbots ativos" : "webhooks"}. Pause outro antes de ativar este.` };
  }
  await setPaused(db, kind, agencyId, [id], pause ? new Date().toISOString() : null);
  await audit(db, { agencyId, actorType: actor.type, actorId: actor.id, action: pause ? "plano.pausar" : "plano.ativar", targetType: TABLE[kind], targetId: id });
  return { ok: true };
}

/** Quantos itens estão pausados pelo plano (chatbots, equipe, webhooks e ações), para o aviso em Cobrança. */
export async function pausedByPlanCount(db: SupabaseClient, agencyId: string): Promise<number> {
  const head = { count: "exact" as const, head: true };
  const [bots, members, webhooks, actions] = await Promise.all([
    db.from("bots").select("id", head).eq("agency_id", agencyId).not("paused_by_plan_at", "is", null),
    db.from("agency_members").select("id", head).eq("agency_id", agencyId).is("removed_at", null).not("paused_by_plan_at", "is", null),
    db.from("webhooks").select("id", head).eq("agency_id", agencyId).not("paused_by_plan_at", "is", null),
    db.from("actions").select("id, bots!inner(agency_id)", head).eq("bots.agency_id", agencyId).not("paused_by_plan_at", "is", null),
  ]);
  return (bots.count ?? 0) + (members.count ?? 0) + (webhooks.count ?? 0) + (actions.count ?? 0);
}
