"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAgencyFor } from "@/lib/agency";
import { audit, requestMeta } from "@/lib/audit";
import { fail, type ActionResult } from "@/lib/action-result";
import { acceptInvite, activeMembership, declineInvites } from "@/lib/team";

/*
 * Convite para a equipe de uma agência (leva B1'). Aceitar exige o link (que prova a posse do
 * e-mail) e a sessão com esse mesmo e-mail. Quem prefere a própria agência recusa os convites
 * em aberto: uma agência ativa por usuário.
 */

async function session() {
  const { data } = await (await createClient()).auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  return { userId: claims.sub, email: String(claims.email ?? "").toLowerCase(), meta: (claims.user_metadata ?? {}) as Record<string, unknown> };
}

export async function acceptTeamInvite(token: string): Promise<ActionResult> {
  const me = await session();
  if (!me) return fail("Entre com o e-mail convidado para aceitar.");
  const db = createAdminClient();
  const r = await acceptInvite(db, { token, userId: me.userId, email: me.email });
  if (!r.ok) return fail(r.message);
  const meta = await requestMeta();
  const base = { agencyId: r.member.agency_id, actorType: "user" as const, actorId: me.userId, targetType: "agency_member", targetId: r.member.id, ...meta };
  await audit(db, { ...base, action: "equipe.convite_aceitar", after: { email: r.member.email, papel: r.member.role } });
  // administrador novo é evento grave (e-mail ao dono e faixa no painel)
  if (r.member.role === "admin") await audit(db, { ...base, action: "equipe.admin_novo", after: { email: r.member.email } });
  redirect("/painel/clientes");
}

/** Recusa os convites em aberto e cria a agência da pessoa (teste grátis). */
export async function createOwnAgency(): Promise<ActionResult> {
  const me = await session();
  if (!me) redirect("/login");
  const db = createAdminClient();
  if (await activeMembership(db, me.userId)) redirect("/painel/clientes");
  const declined = await declineInvites(db, me.email);
  const meta = await requestMeta();
  for (const d of declined) await audit(db, { agencyId: d.agency_id, actorType: "user", actorId: me.userId, action: "equipe.convite_recusar", targetType: "agency_member", targetId: d.id, after: { email: me.email }, ...meta });
  await createAgencyFor(me.userId, me.email, me.meta);
  redirect("/painel/clientes");
}
