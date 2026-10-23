"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { agencySlug, requireAgency } from "@/lib/agency";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { audit, requestMeta } from "@/lib/audit";
import { PROFILE_ORDER, businessProfileProblem, parseFirstAccess, type AccountProfile } from "@/lib/first-access";
import { ONBOARDING_COOKIE } from "@/lib/onboarding";
import { requestTeamWhatsApp } from "@/lib/team-whatsapp";

/**
 * Primeiro acesso: o perfil e o nome da conta, o nome de quem entra e, se veio, o WhatsApp dos
 * avisos (o mesmo pedido de Meu perfil, com o aceite ao lado do campo). Depois, o Início.
 */
export async function saveFirstAccess(formData: FormData): Promise<ActionResult> {
  const ctx = await requireAgency();
  if (ctx.role !== "owner") return fail("Só o dono da conta responde o primeiro acesso.");
  const parsed = parseFirstAccess(formData);
  if (!parsed.ok) return fail(parsed.message);
  const { profile, accountName, displayName, phone } = parsed.value;

  const db = createAdminClient();
  const [{ error: agencyError }, { error: memberError }] = await Promise.all([
    db.from("agencies").update({ profile, name: accountName, slug: agencySlug(ctx.agency.slug, accountName) }).eq("id", ctx.agency.id),
    db.from("agency_members").update({ display_name: displayName }).eq("id", ctx.member.id),
  ]);
  if (agencyError || memberError) return fail("Não foi possível salvar. Tente de novo.");
  // os primeiros passos do perfil novo aparecem, mesmo para quem tinha ocultado os do outro
  (await cookies()).delete(ONBOARDING_COOKIE);
  revalidatePath("/painel", "layout");

  if (phone) {
    const r = await requestTeamWhatsApp(db, { member: { ...ctx.member, display_name: displayName }, agency: { id: ctx.agency.id, name: accountName }, rawPhone: phone });
    if (!r.ok) return fail(`${r.message} O resto já foi salvo: corrija o número ou deixe o campo em branco.`);
    await audit(db, { agencyId: ctx.agency.id, actorType: "user", actorId: ctx.userId, action: "perfil.avisos_whatsapp_pedido", targetType: "member", targetId: ctx.member.id, ...(await requestMeta()) });
  }
  redirect("/painel/clientes");
}

/**
 * Mudar só o perfil, num modal (redesenho, etapa 5, a pedido do usuário em 22/10: o "Mudar" de Marca e
 * domínio e o "Mudar o perfil" dos primeiros passos não levam mais para outra tela).
 */
export async function saveAccountProfile(formData: FormData): Promise<ActionResult> {
  const ctx = await requireAgency();
  if (ctx.role !== "owner") return fail("Só o dono da conta muda o perfil.");
  const profile = String(formData.get("profile") ?? "") as AccountProfile;
  if (!PROFILE_ORDER.includes(profile)) return fail("Escolha como você usa a conta.");
  if (profile === ctx.agency.profile) return ok("Nada mudou.");
  const admin = createAdminClient();
  // o perfil do negócio (23/10/2026) vale com nenhum ou um cliente: com mais, a conta segue como agência
  if (profile === "business") {
    const { count } = await admin.from("clients").select("id", { count: "exact", head: true }).eq("agency_id", ctx.agency.id);
    const problem = businessProfileProblem(count ?? 0);
    if (problem) return fail(problem);
  }
  const { error } = await admin.from("agencies").update({ profile }).eq("id", ctx.agency.id);
  if (error) return fail("Não foi possível salvar. Tente de novo.");
  // os primeiros passos do perfil novo aparecem, mesmo para quem tinha ocultado os do outro
  (await cookies()).delete(ONBOARDING_COOKIE);
  revalidatePath("/painel", "layout");
  return ok(profile === "business" ? "Perfil salvo: o menu mostra Chatbots no lugar de Clientes, e os primeiros passos mudaram." : "Perfil salvo: os primeiros passos mudaram.");
}
