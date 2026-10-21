"use server";

import { revalidatePath } from "next/cache";
import { requireAgency } from "@/lib/agency";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { profileProblem } from "@/lib/attendants";
import { audit, requestMeta } from "@/lib/audit";
import { dismissNoticeCard, forgetTeamWhatsApp, loadTeamWhatsApp, requestTeamWhatsApp, saveNoticePrefs } from "@/lib/team-whatsapp";
import { kindsForRole } from "@/lib/team-notices";
import { setAvailable } from "@/lib/availability";
import { isSignatureFormat } from "@/lib/signature";
import { firstExceeded } from "@/lib/rate-limit";
import { agencyPushKinds, deviceLabel, parseSubscription, pushConfigured, pushTo, removePushDevice, removePushEndpoint, savePushPrefs, savePushSubscription } from "@/lib/push";
import { headers } from "next/headers";

const safeJson = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

/** Meu perfil: nome de exibição e foto de quem está logado (qualquer papel). */
export async function updateMyProfile(formData: FormData): Promise<ActionResult> {
  const { member } = await requireAgency();
  const name = String(formData.get("display_name") ?? "").replace(/\s+/g, " ").trim();
  const avatar = String(formData.get("avatar_url") ?? "").trim() || null;
  const problem = profileProblem(name, avatar, member.id);
  if (problem) return fail(problem);
  const { error } = await createAdminClient().from("agency_members").update({ display_name: name, avatar_url: avatar }).eq("id", member.id);
  if (error) return fail("Não foi possível salvar. Tente de novo.");
  revalidatePath("/painel", "layout");
  return ok("Perfil salvo. As próximas mensagens já saem com este nome.");
}

/** Disponível ou Ausente para o rodízio dos setores (Caixa de entrada, parte 2). */
export async function setMyAvailability(available: boolean): Promise<ActionResult> {
  const { member } = await requireAgency();
  if (!(await setAvailable(createAdminClient(), { type: "agency_member", id: member.id }, available))) return fail("Não foi possível salvar. Tente de novo.");
  revalidatePath("/painel", "layout");
  return ok(available ? "Você está disponível: o rodízio dos seus setores manda conversas para você." : "Você está ausente: o rodízio pula você até voltar.");
}

/** Minha assinatura (Caixa de entrada, parte 5): "chatbot" volta para o formato do chatbot. */
export async function setMySignature(formData: FormData): Promise<ActionResult> {
  const { member } = await requireAgency();
  const v = String(formData.get("signature") ?? "");
  const signature = isSignatureFormat(v) ? v : null;
  const { error } = await createAdminClient().from("agency_members").update({ signature }).eq("id", member.id);
  if (error) return fail("Não foi possível salvar. Tente de novo.");
  revalidatePath("/painel/perfil");
  return ok(signature ? "Assinatura salva. Nos chatbots que travam o formato, vale o deles." : "Pronto: vale o formato de cada chatbot.");
}

/* ------------------------------------------------------------------ avisos no WhatsApp */

const auditNotice = async (ctx: { agency: { id: string }; userId: string; member: { id: string } }, action: string) =>
  audit(createAdminClient(), { agencyId: ctx.agency.id, actorType: "user", actorId: ctx.userId, action, targetType: "member", targetId: ctx.member.id, ...(await requestMeta()) });

/**
 * "Receber no WhatsApp": o número da pessoa e o aceite (o texto mostrado ao lado do botão). O
 * assistente da BoaVoz manda o modelo com "Confirmar" e "Não fui eu"; só o Confirmar liga os avisos.
 */
export async function requestNoticeWhatsApp(formData: FormData): Promise<ActionResult> {
  const ctx = await requireAgency();
  const r = await requestTeamWhatsApp(createAdminClient(), { member: ctx.member, agency: ctx.agency, rawPhone: String(formData.get("phone") ?? "") });
  if (!r.ok) return fail(r.message);
  await auditNotice(ctx, "perfil.avisos_whatsapp_pedido");
  revalidatePath("/painel", "layout");
  return ok(`Mandamos a mensagem para ${r.masked}. Abra o WhatsApp e toque em Confirmar.`);
}

/** Manda o modelo de novo, para o mesmo número (o pedido em aberto ganha um botão novo). */
export async function resendNoticeWhatsApp(): Promise<ActionResult> {
  const ctx = await requireAgency();
  const db = createAdminClient();
  const row = await loadTeamWhatsApp(db, ctx.member.id);
  if (!row?.phone) return fail("Ponha o seu número primeiro.");
  const r = await requestTeamWhatsApp(db, { member: ctx.member, agency: ctx.agency, rawPhone: row.phone });
  if (!r.ok) return fail(r.message);
  await auditNotice(ctx, "perfil.avisos_whatsapp_pedido");
  revalidatePath("/painel", "layout");
  return ok(`Mandamos de novo para ${r.masked}.`);
}

/** "Parar avisos": o número sai (para voltar, a pessoa pede de novo). */
export async function stopNoticeWhatsApp(): Promise<ActionResult> {
  const ctx = await requireAgency();
  const db = createAdminClient();
  // quem acabou de parar não vê o convite voltar no topo; o campo continua em Meu perfil
  await Promise.all([forgetTeamWhatsApp(db, ctx.member.id), dismissNoticeCard(db, ctx.member.id)]);
  await auditNotice(ctx, "perfil.avisos_whatsapp_parar");
  revalidatePath("/painel", "layout");
  return ok("Pronto: os avisos pararam e o número saiu do BoaVoz.");
}

/** "Agora não" no cartão do topo do painel (o campo continua em Meu perfil). */
export async function dismissNoticeWhatsAppCard(): Promise<ActionResult> {
  const { member } = await requireAgency();
  await dismissNoticeCard(createAdminClient(), member.id);
  revalidatePath("/painel", "layout");
  return ok("Tudo bem. Quando quiser, está em Meu perfil.");
}

/** Quais avisos chegam no WhatsApp (só os que o papel recebe; os outros nem aparecem). */
export async function saveMyNoticePrefs(formData: FormData): Promise<ActionResult> {
  const { member, role } = await requireAgency();
  const prefs = Object.fromEntries(kindsForRole(role).map((k) => [k, formData.get(`aviso_${k}`) === "on"]));
  if (!(await saveNoticePrefs(createAdminClient(), member.id, prefs))) return fail("Confirme o número primeiro.");
  revalidatePath("/painel/perfil");
  return ok("Avisos salvos.");
}


/* ------------------------------------------------------------------ avisos no celular (Memória e avisos, parte 2) */

const meOnDevice = (id: string) => ({ type: "agency_member" as const, id });

/** "Ativar neste aparelho": o endereço que o navegador criou, com o nome do aparelho. */
export async function subscribeMyPush(json: string): Promise<ActionResult> {
  const { member } = await requireAgency();
  if (!pushConfigured()) return fail("Os avisos no celular ainda não estão ligados na plataforma.");
  const sub = parseSubscription(safeJson(json));
  if (!sub) return fail("O navegador não mandou um endereço válido. Tente de novo.");
  const label = deviceLabel((await headers()).get("user-agent"));
  if (!(await savePushSubscription(createAdminClient(), meOnDevice(member.id), sub, label))) return fail("Não foi possível salvar. Tente de novo.");
  revalidatePath("/painel/perfil");
  return ok(`Avisos ativados: ${label}.`);
}

export async function unsubscribeMyPush(endpoint: string): Promise<ActionResult> {
  const { member } = await requireAgency();
  await removePushEndpoint(createAdminClient(), meOnDevice(member.id), String(endpoint));
  revalidatePath("/painel/perfil");
  return ok();
}

export async function removeMyPushDevice(formData: FormData): Promise<ActionResult> {
  const { member } = await requireAgency();
  if (!(await removePushDevice(createAdminClient(), meOnDevice(member.id), String(formData.get("device") ?? "")))) return fail("Não foi possível remover. Tente de novo.");
  revalidatePath("/painel/perfil");
  return ok("Aparelho removido.");
}

/** Quais avisos chegam nos aparelhos (só os que o papel recebe, mais a transferência). */
export async function saveMyPushPrefs(formData: FormData): Promise<ActionResult> {
  const { member, role } = await requireAgency();
  const on = new Set([...formData.keys()].filter((k) => k.startsWith("push_")).map((k) => k.slice(5)));
  if (!(await savePushPrefs(createAdminClient(), meOnDevice(member.id), agencyPushKinds(role), on))) return fail("Não foi possível salvar. Tente de novo.");
  revalidatePath("/painel/perfil");
  return ok("Avisos salvos.");
}

/** "Enviar um teste" para todos os aparelhos da pessoa (no máximo 5 a cada 10 minutos). */
export async function testMyPush(): Promise<ActionResult> {
  const { member } = await requireAgency();
  const db = createAdminClient();
  const limited = await firstExceeded(db, [{ key: `push:teste:${member.id}`, max: 5, windowSeconds: 600, message: "Muitos testes seguidos. Espere alguns minutos." }]);
  if (limited) return fail(limited.message);
  const n = await pushTo(db, [meOnDevice(member.id)], { kind: "teste", title: "Teste dos avisos", body: "Se você está vendo isto, os avisos do painel chegam neste aparelho.", url: "/painel/caixa", ref: String(Date.now()) });
  revalidatePath("/painel/perfil");
  return n ? ok(n === 1 ? "Mandamos o teste para 1 aparelho." : `Mandamos o teste para ${n} aparelhos.`) : fail("Nenhum aparelho recebeu. Ative os avisos neste aparelho primeiro.");
}
