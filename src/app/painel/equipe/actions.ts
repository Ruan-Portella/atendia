"use server";

import { revalidatePath } from "next/cache";
import { requireAgency } from "@/lib/agency";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit, requestMeta } from "@/lib/audit";
import { sendAsAgency } from "@/lib/notify";
import { appUrl } from "@/lib/utils";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { INVITE_DAYS, ROLE_LABELS, can, inviteMember, isInvitableRole, memberName, memberOf, removeMember, scopeFromForm, scopesOf, updateMemberAccess, type ScopeInput } from "@/lib/team";

/*
 * Equipe (leva B1'): convidar, mudar papel e escopo, remover. Só dono e administrador; dar ou
 * tirar o papel de administrador é só do dono. Tudo vai para a auditoria; administrador novo é
 * evento grave (e-mail ao dono e faixa no topo do painel).
 */

const DENIED = "Só o dono ou um administrador da agência mexe na equipe.";

async function teamContext() {
  const ctx = await requireAgency();
  return can(ctx.role, "team") ? ctx : null;
}

async function auditTeam(ctx: { agency: { id: string }; userId: string }, action: string, memberId: string, change: { before?: Record<string, unknown>; after?: Record<string, unknown> } = {}) {
  await audit(createAdminClient(), { agencyId: ctx.agency.id, actorType: "user", actorId: ctx.userId, action, targetType: "agency_member", targetId: memberId, ...change, ...(await requestMeta()) });
}

const scopeText = (s: ScopeInput) => (s.scope === "all" ? "todos os clientes" : `${s.clientIds.length} cliente(s) e ${s.botIds.length} chatbot(s)`);

export type InviteResult = ActionResult & { link?: string };

/** Convida por e-mail; o link também aparece na tela, para copiar (sem e-mail configurado, é o único jeito). */
export async function inviteTeamMember(formData: FormData): Promise<InviteResult> {
  const ctx = await teamContext();
  if (!ctx) return fail(DENIED);
  const role = formData.get("role");
  if (!isInvitableRole(role)) return fail("Escolha o papel.");
  if (role === "admin" && ctx.role !== "owner") return fail("Só o dono da agência convida um administrador.");
  const access = scopeFromForm(formData);
  const db = createAdminClient();
  const r = await inviteMember(db, { agencyId: ctx.agency.id, planId: ctx.agency.plan, by: ctx.userId, email: String(formData.get("email") ?? ""), role, access });
  if (!r.ok) return fail(r.message);
  const email = String(formData.get("email")).trim().toLowerCase();
  await auditTeam(ctx, "equipe.convidar", r.memberId, { after: { email, papel: role, escopo: scopeText(access) } });

  const link = appUrl(`/convite/${r.token}`);
  const sent = await sendAsAgency(ctx.agency.name, email, `Convite para a equipe de ${ctx.agency.name} no BoaVoz`, [
    `${ctx.agency.name} convidou você para a equipe no BoaVoz, como ${ROLE_LABELS[role].toLowerCase()}.`,
    "",
    `Para aceitar, abra o link e entre (ou crie a sua conta) com este e-mail, ${email}:`,
    link,
    "",
    `O convite vale por ${INVITE_DAYS} dias. Se você não esperava este convite, ignore este e-mail.`,
  ]).catch(() => false);
  revalidatePath("/painel/equipe");
  return { ...ok(sent ? `Convite enviado para ${email}.` : `Convite criado. O e-mail não saiu deste servidor: copie o link e mande para ${email}.`), link };
}

export async function updateTeamMember(memberId: string, formData: FormData): Promise<ActionResult> {
  const ctx = await teamContext();
  if (!ctx) return fail(DENIED);
  const role = formData.get("role");
  if (!isInvitableRole(role)) return fail("Escolha o papel.");
  const access = scopeFromForm(formData);
  const db = createAdminClient();
  const r = await updateMemberAccess(db, { agencyId: ctx.agency.id, memberId, actorRole: ctx.role, role, access });
  if (!r.ok) return fail(r.message);
  await auditTeam(ctx, "equipe.papel", memberId, { before: { papel: r.before.role, escopo: r.before.scope }, after: { papel: role, escopo: scopeText(access) } });
  // administrador novo (já aceito) é evento grave; o convite pendente avisa quando for aceito
  if (role === "admin" && r.before.role !== "admin" && r.member.accepted_at) await auditTeam(ctx, "equipe.admin_novo", memberId, { after: { email: r.member.email } });
  revalidatePath("/painel/equipe");
  return ok(`${memberName(r.member)} agora é ${ROLE_LABELS[role].toLowerCase()}.`);
}

export async function removeTeamMember(memberId: string): Promise<ActionResult> {
  const ctx = await teamContext();
  if (!ctx) return fail(DENIED);
  const r = await removeMember(createAdminClient(), { agencyId: ctx.agency.id, memberId, actorRole: ctx.role, actorMemberId: ctx.member.id });
  if (!r.ok) return fail(r.message);
  await auditTeam(ctx, "equipe.remover", memberId, { before: { email: r.member.email, papel: r.member.role, aceito: Boolean(r.member.accepted_at) } });
  revalidatePath("/painel/equipe");
  return ok(r.member.accepted_at ? `${memberName(r.member)} saiu da equipe. O acesso acaba na próxima página que a pessoa abrir.` : "Convite cancelado. O link deixou de valer.");
}

/** Convida de novo (convite pendente ou vencido), com o mesmo papel e escopo e um link novo. */
export async function reinviteTeamMember(memberId: string): Promise<InviteResult> {
  const ctx = await teamContext();
  if (!ctx) return fail(DENIED);
  const db = createAdminClient();
  const m = await memberOf(db, ctx.agency.id, memberId);
  if (!m || m.accepted_at) return fail("Convite não encontrado.");
  if (m.role === "admin" && ctx.role !== "owner") return fail("Só o dono da agência convida um administrador.");
  const scope = (await scopesOf(db, [m.id])).get(m.id) ?? { clientIds: [], botIds: [] };
  const fd = new FormData();
  fd.set("email", m.email);
  fd.set("role", m.role);
  fd.set("scope", m.scope);
  for (const id of scope.clientIds) fd.append("scope_item", `client:${id}`);
  for (const id of scope.botIds) fd.append("scope_item", `bot:${id}`);
  return inviteTeamMember(fd);
}
