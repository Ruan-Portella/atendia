import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanId } from "./plans";
import { isEmail } from "./validation";
import type { AgencyRole, InvitableRole, MemberScope } from "./roles";

export * from "./roles";

/*
 * Equipe da agência (leva B1'): papéis fixos com escopo. agency_members é a fonte das funções de
 * acesso da RLS (migração 0073); aqui ficam as regras que o servidor confere antes de gravar com
 * a service role. Uma agência ativa por usuário no MVP: quem precisa de duas usa outro e-mail.
 */

/** Membros por plano, contando o dono e os convites pendentes (revistos na revisão de preços). */
export const MEMBER_LIMITS: Record<PlanId, number> = { trial: 2, freelancer: 2, agencia: 5, escala: 15, cancelado: 1 };
export const memberLimit = (planId: string): number => MEMBER_LIMITS[planId as PlanId] ?? 1;

/** Dias que o link do convite vale. */
export const INVITE_DAYS = 7;

export interface AgencyMember {
  id: string;
  agency_id: string;
  user_id: string | null;
  email: string;
  role: AgencyRole;
  scope: MemberScope;
  display_name: string | null;
  avatar_url: string | null;
  invited_by: string | null;
  invited_at: string;
  invite_expires_at: string | null;
  accepted_at: string | null;
  removed_at: string | null;
  paused_by_plan_at: string | null;
}

export const MEMBER_COLS = "id, agency_id, user_id, email, role, scope, display_name, avatar_url, invited_by, invited_at, invite_expires_at, accepted_at, removed_at, paused_by_plan_at";

export const inviteTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export const newInviteToken = () => randomBytes(24).toString("base64url");

/** Convite ainda vale? (não aceito, não removido, dentro do prazo). Pura. */
export function inviteOpen(m: Pick<AgencyMember, "accepted_at" | "removed_at" | "invite_expires_at">, now = Date.now()): boolean {
  return !m.accepted_at && !m.removed_at && Boolean(m.invite_expires_at) && new Date(m.invite_expires_at!).getTime() > now;
}

/**
 * Vínculo vivo do usuário (aceito e não removido; pausado pelo plano também volta, para a tela
 * avisar). Erro de banco derruba: quem chama nunca pode concluir "sem agência" por engano.
 */
export async function activeMembership(db: SupabaseClient, userId: string): Promise<AgencyMember | null> {
  const { data, error } = await db.from("agency_members").select(MEMBER_COLS).eq("user_id", userId).is("removed_at", null).not("accepted_at", "is", null).maybeSingle<AgencyMember>();
  if (error) throw new Error(`equipe: vínculo não lido (${error.message})`);
  return data ?? null;
}

/** Convites em aberto para o e-mail, com o nome da agência. */
export async function openInvitesFor(db: SupabaseClient, email: string): Promise<Array<AgencyMember & { agency_name: string }>> {
  const { data, error } = await db.from("agency_members").select(`${MEMBER_COLS}, agencies!inner(name)`).eq("email", email.toLowerCase()).is("removed_at", null).is("accepted_at", null).gt("invite_expires_at", new Date().toISOString());
  if (error) throw new Error(`equipe: convites não lidos (${error.message})`);
  return ((data ?? []) as unknown as Array<AgencyMember & { agencies: { name: string } | Array<{ name: string }> }>).map(({ agencies, ...m }) => ({ ...m, agency_name: (Array.isArray(agencies) ? agencies[0]?.name : agencies?.name) ?? "" }));
}

/** O usuário já fez parte de alguma agência (vínculo removido)? Assim ele não vira agência nova sem querer. */
export async function hadMembership(db: SupabaseClient, userId: string): Promise<boolean> {
  const { count } = await db.from("agency_members").select("id", { count: "exact", head: true }).eq("user_id", userId);
  return Boolean(count);
}

/** Lugares ocupados no plano: membros aceitos e convites em aberto, com o dono. */
export async function seatsUsed(db: SupabaseClient, agencyId: string): Promise<number> {
  const { data } = await db.from("agency_members").select("accepted_at, removed_at, invite_expires_at").eq("agency_id", agencyId).is("removed_at", null);
  return ((data ?? []) as Array<Pick<AgencyMember, "accepted_at" | "removed_at" | "invite_expires_at">>).filter((m) => m.accepted_at || inviteOpen(m)).length;
}

/** O e-mail já está numa agência do BoaVoz (dono ou membro aceito)? */
export async function emailHasAgency(db: SupabaseClient, email: string): Promise<boolean> {
  const { count } = await db.from("agency_members").select("id", { count: "exact", head: true }).eq("email", email.toLowerCase()).is("removed_at", null).not("accepted_at", "is", null);
  return Boolean(count);
}

export interface ScopeInput {
  scope: MemberScope;
  clientIds: string[];
  botIds: string[];
}

/** Lê o escopo do formulário: "all" ou "selected" com client:<id> e bot:<id> marcados. Pura. */
export function scopeFromForm(fd: FormData): ScopeInput {
  const scope: MemberScope = fd.get("scope") === "selected" ? "selected" : "all";
  const items = fd.getAll("scope_item").map(String);
  const ids = (prefix: string) => [...new Set(items.filter((v) => v.startsWith(prefix)).map((v) => v.slice(prefix.length)).filter((v) => /^[0-9a-f-]{36}$/i.test(v)))];
  return { scope, clientIds: scope === "selected" ? ids("client:") : [], botIds: scope === "selected" ? ids("bot:") : [] };
}

/** Confere papel e escopo juntos (dono e administrador veem tudo). null = válido. Pura. */
export function accessProblem(role: AgencyRole, s: ScopeInput): string | null {
  if (s.scope === "selected" && (role === "owner" || role === "admin")) return "Dono e administrador veem todos os clientes.";
  if (s.scope === "selected" && !s.clientIds.length && !s.botIds.length) return "Escolha pelo menos um cliente ou chatbot, ou deixe \"Todos os clientes\".";
  return null;
}

/** Só aceita clientes e chatbots (não demos) desta agência no escopo. */
async function validScope(db: SupabaseClient, agencyId: string, s: ScopeInput): Promise<ScopeInput | null> {
  if (s.scope === "all") return s;
  const [{ data: clients }, { data: bots }] = await Promise.all([
    s.clientIds.length ? db.from("clients").select("id").eq("agency_id", agencyId).in("id", s.clientIds) : Promise.resolve({ data: [] }),
    s.botIds.length ? db.from("bots").select("id").eq("agency_id", agencyId).eq("is_demo", false).in("id", s.botIds) : Promise.resolve({ data: [] }),
  ]);
  if ((clients ?? []).length !== s.clientIds.length || (bots ?? []).length !== s.botIds.length) return null;
  return s;
}

async function writeScope(db: SupabaseClient, memberId: string, s: ScopeInput): Promise<boolean> {
  const { error: delError } = await db.from("agency_member_scopes").delete().eq("member_id", memberId);
  if (delError) return false;
  const rows = [...s.clientIds.map((client_id) => ({ member_id: memberId, client_id })), ...s.botIds.map((bot_id) => ({ member_id: memberId, bot_id }))];
  if (!rows.length) return true;
  const { error } = await db.from("agency_member_scopes").insert(rows);
  return !error;
}

export const ONE_AGENCY_MESSAGE = "Este e-mail já está numa agência do BoaVoz. Peça outro e-mail à pessoa: cada usuário fica em uma agência só.";

/** Convida (ou convida de novo, com link novo) um e-mail para a equipe. */
export async function inviteMember(
  db: SupabaseClient,
  o: { agencyId: string; planId: string; by: string; email: string; role: InvitableRole; access: ScopeInput },
): Promise<{ ok: true; memberId: string; token: string } | { ok: false; message: string }> {
  const email = o.email.trim().toLowerCase();
  if (!isEmail(email)) return { ok: false, message: "E-mail inválido." };
  const problem = accessProblem(o.role, o.access);
  if (problem) return { ok: false, message: problem };
  const access = await validScope(db, o.agencyId, o.access);
  if (!access) return { ok: false, message: "Algum cliente ou chatbot escolhido não existe mais. Recarregue a página." };

  const { data: existing } = await db.from("agency_members").select(MEMBER_COLS).eq("agency_id", o.agencyId).eq("email", email).is("removed_at", null).maybeSingle<AgencyMember>();
  if (existing?.accepted_at) return { ok: false, message: "Essa pessoa já está na equipe." };
  if (await emailHasAgency(db, email)) return { ok: false, message: ONE_AGENCY_MESSAGE };
  // convidar de novo o mesmo e-mail não ocupa outro lugar
  const seats = (await seatsUsed(db, o.agencyId)) - (existing && inviteOpen(existing) ? 1 : 0);
  if (seats >= memberLimit(o.planId)) return { ok: false, message: `O seu plano permite ${memberLimit(o.planId)} pessoas na equipe, contando você e os convites pendentes. Remova alguém ou mude de plano.` };
  // convite vencido ou pendente do mesmo e-mail: sai e dá lugar ao novo (o link antigo para de valer)
  if (existing) await db.from("agency_members").update({ removed_at: new Date().toISOString(), invite_token_hash: null }).eq("id", existing.id);

  const token = newInviteToken();
  const { data: row, error } = await db
    .from("agency_members")
    .insert({ agency_id: o.agencyId, email, role: o.role, scope: access.scope, invited_by: o.by, invite_token_hash: inviteTokenHash(token), invite_expires_at: new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString() })
    .select("id")
    .single();
  if (error || !row) return { ok: false, message: "Não foi possível criar o convite. Tente de novo." };
  if (!(await writeScope(db, row.id, access))) {
    await db.from("agency_members").delete().eq("id", row.id);
    return { ok: false, message: "Não foi possível gravar o escopo. Tente de novo." };
  }
  return { ok: true, memberId: row.id, token };
}

/** Convite pelo token do link (sem conferir prazo: a tela explica o que houve). */
export async function inviteByToken(db: SupabaseClient, token: string): Promise<(AgencyMember & { agency_name: string }) | null> {
  if (!token || token.length > 100) return null;
  const { data } = await db.from("agency_members").select(`${MEMBER_COLS}, agencies!inner(name)`).eq("invite_token_hash", inviteTokenHash(token)).maybeSingle();
  if (!data) return null;
  const { agencies, ...m } = data as unknown as AgencyMember & { agencies: { name: string } | Array<{ name: string }> };
  return { ...m, agency_name: (Array.isArray(agencies) ? agencies[0]?.name : agencies?.name) ?? "" };
}

/**
 * Aceita o convite: o link prova a posse do e-mail, e a sessão precisa ser desse mesmo e-mail.
 * UPDATE condicional (accepted_at is null): dois cliques não aceitam duas vezes.
 */
export async function acceptInvite(db: SupabaseClient, o: { token: string; userId: string; email: string }): Promise<{ ok: true; member: AgencyMember } | { ok: false; message: string }> {
  const invite = await inviteByToken(db, o.token);
  if (!invite || invite.removed_at) return { ok: false, message: "Este convite não vale mais. Peça um novo para a agência." };
  if (invite.accepted_at) return { ok: false, message: "Este convite já foi usado." };
  if (!inviteOpen(invite)) return { ok: false, message: `O convite venceu (vale ${INVITE_DAYS} dias). Peça um novo para a agência.` };
  if (invite.email !== o.email.trim().toLowerCase()) return { ok: false, message: `Este convite é para ${invite.email}. Entre com esse e-mail para aceitar.` };
  if (await activeMembership(db, o.userId)) return { ok: false, message: "Você já faz parte de uma agência no BoaVoz. Para entrar nesta, use outro e-mail." };
  const { data, error } = await db
    .from("agency_members")
    .update({ user_id: o.userId, accepted_at: new Date().toISOString(), invite_token_hash: null })
    .eq("id", invite.id)
    .is("accepted_at", null)
    .is("removed_at", null)
    .select(MEMBER_COLS)
    .maybeSingle<AgencyMember>();
  if (error || !data) return { ok: false, message: "Não foi possível aceitar o convite. Tente de novo." };
  return { ok: true, member: data };
}

/** Recusa os convites em aberto do e-mail (a pessoa prefere a própria agência). */
export async function declineInvites(db: SupabaseClient, email: string): Promise<Array<{ id: string; agency_id: string }>> {
  const { data } = await db
    .from("agency_members")
    .update({ removed_at: new Date().toISOString(), invite_token_hash: null })
    .eq("email", email.toLowerCase())
    .is("accepted_at", null)
    .is("removed_at", null)
    .select("id, agency_id");
  return (data ?? []) as Array<{ id: string; agency_id: string }>;
}

/** Membro desta agência (vivo), para editar ou remover. */
export async function memberOf(db: SupabaseClient, agencyId: string, memberId: string): Promise<AgencyMember | null> {
  const { data } = await db.from("agency_members").select(MEMBER_COLS).eq("id", memberId).eq("agency_id", agencyId).is("removed_at", null).maybeSingle<AgencyMember>();
  return data ?? null;
}

/** Escopo gravado de cada membro. */
export async function scopesOf(db: SupabaseClient, memberIds: string[]): Promise<Map<string, { clientIds: string[]; botIds: string[] }>> {
  const out = new Map<string, { clientIds: string[]; botIds: string[] }>();
  if (!memberIds.length) return out;
  const { data } = await db.from("agency_member_scopes").select("member_id, client_id, bot_id").in("member_id", memberIds);
  for (const r of (data ?? []) as Array<{ member_id: string; client_id: string | null; bot_id: string | null }>) {
    const cur = out.get(r.member_id) ?? { clientIds: [], botIds: [] };
    if (r.client_id) cur.clientIds.push(r.client_id);
    if (r.bot_id) cur.botIds.push(r.bot_id);
    out.set(r.member_id, cur);
  }
  return out;
}

/** Troca papel e escopo. O dono não muda por aqui; administrador só o dono cria ou rebaixa. */
export async function updateMemberAccess(
  db: SupabaseClient,
  o: { agencyId: string; memberId: string; actorRole: AgencyRole; role: InvitableRole; access: ScopeInput },
): Promise<{ ok: true; before: { role: AgencyRole; scope: MemberScope }; member: AgencyMember } | { ok: false; message: string }> {
  const m = await memberOf(db, o.agencyId, o.memberId);
  if (!m) return { ok: false, message: "Pessoa não encontrada." };
  if (m.role === "owner") return { ok: false, message: "O dono da agência não muda de papel." };
  if (o.actorRole !== "owner" && (m.role === "admin" || o.role === "admin") && m.role !== o.role) return { ok: false, message: "Só o dono da agência dá ou tira o papel de administrador." };
  const problem = accessProblem(o.role, o.access);
  if (problem) return { ok: false, message: problem };
  const access = await validScope(db, o.agencyId, o.access);
  if (!access) return { ok: false, message: "Algum cliente ou chatbot escolhido não existe mais. Recarregue a página." };
  const { data, error } = await db.from("agency_members").update({ role: o.role, scope: access.scope }).eq("id", m.id).select(MEMBER_COLS).single<AgencyMember>();
  if (error || !data || !(await writeScope(db, m.id, access))) return { ok: false, message: "Não foi possível salvar. Tente de novo." };
  return { ok: true, before: { role: m.role, scope: m.scope }, member: data };
}

/** Tira da equipe (ou cancela o convite). O dono não sai; administrador só o dono remove. */
export async function removeMember(db: SupabaseClient, o: { agencyId: string; memberId: string; actorRole: AgencyRole; actorMemberId: string }): Promise<{ ok: true; member: AgencyMember } | { ok: false; message: string }> {
  const m = await memberOf(db, o.agencyId, o.memberId);
  if (!m) return { ok: false, message: "Pessoa não encontrada." };
  if (m.role === "owner") return { ok: false, message: "O dono da agência não pode ser removido." };
  if (m.id === o.actorMemberId) return { ok: false, message: "Você não pode remover a si mesmo. Peça para o dono da agência." };
  if (m.role === "admin" && o.actorRole !== "owner") return { ok: false, message: "Só o dono da agência remove um administrador." };
  const { error } = await db.from("agency_members").update({ removed_at: new Date().toISOString(), invite_token_hash: null }).eq("id", m.id).is("removed_at", null);
  if (error) return { ok: false, message: "Não foi possível remover. Tente de novo." };
  return { ok: true, member: m };
}

/** Último acesso ao painel de cada usuário (registros de acesso). */
export async function lastAccessOf(db: SupabaseClient, userIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await Promise.all(
    userIds.map(async (id) => {
      const { data } = await db.from("access_log").select("created_at").eq("actor_type", "user").eq("actor_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (data?.created_at) out.set(id, data.created_at as string);
    }),
  );
  return out;
}

/** Nome para mostrar: o de exibição, ou o começo do e-mail. Pura. */
export const memberName = (m: Pick<AgencyMember, "display_name" | "email">): string => m.display_name?.trim() || m.email.split("@")[0];
