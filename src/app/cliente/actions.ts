"use server";

import { revalidatePath } from "next/cache";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { createAdminClient } from "@/lib/supabase/admin";
import { hostAgency } from "@/lib/domain-server";
import { currentOrigin, EMAIL_LINK_TYPES, memberAttendant, memberForAction, memberHasMfa, sendMemberLink, type Membership } from "@/lib/member";
import { profileProblem } from "@/lib/attendants";
import { awayMessageProblem, parseHoursForm, type HumanHandoff } from "@/lib/handoff-hours";
import { executeRequest } from "@/lib/data-subject";
import { applySensitiveMode, sensitiveChangeText, sensitiveSavedText } from "@/lib/sensitive-mode";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { clientIp, firstExceeded, hashId } from "@/lib/rate-limit";
import { isEmail, text } from "@/lib/validation";
import { ALREADY_YOURS, postAgentMessage, release, takeOver } from "@/lib/handoff";
import { answerQuestion, deleteTextSource, dismissQuestion, saveTextSource } from "@/lib/knowledge";
import { logAccess } from "@/lib/access-log";
import { audit, requestMeta } from "@/lib/audit";
import { disconnectInstagramChannel, disconnectWhatsAppChannel } from "@/lib/channel-disconnect";
import { notifyAgencyOwner } from "@/lib/notify";
import { appUrl } from "@/lib/utils";
import { isRetentionMonths, retentionLabel, retentionReduced } from "@/lib/retention";
import { headers } from "next/headers";

const GENERIC = "Se esse e-mail tiver acesso, enviamos um link para entrar. Confira a caixa de entrada (e o spam).";

/**
 * Pede o link de acesso. Nunca diz se o e-mail existe (evita descobrir quem é cliente de
 * quem); limitado por IP e por e-mail para ninguém lotar a caixa de entrada de outra pessoa.
 */
export async function requestAccessLink(formData: FormData): Promise<ActionResult> {
  const email = text(formData.get("email")).toLowerCase();
  const nextRaw = text(formData.get("next"));
  const next = /^\/cliente(\/[\w-]*)*$/.test(nextRaw) ? nextRaw : "/cliente";
  if (!isEmail(email)) return fail("Digite um e-mail válido.");

  const admin = createAdminClient();
  const ip = hashId(clientIp(new Request("http://x", { headers: await headers() })));
  const exceeded = await firstExceeded(admin, [
    { key: `member-link:ip:${ip}`, max: 8, windowSeconds: 3600, message: "Muitas tentativas. Espere alguns minutos e tente de novo." },
    { key: `member-link:email:${hashId(email)}`, max: 4, windowSeconds: 3600, message: GENERIC },
  ]);
  if (exceeded) return exceeded.message === GENERIC ? ok(GENERIC) : fail(exceeded.message);

  const { data: rows } = await admin
    .from("client_members")
    .select("client_id, clients!inner(name, agency_id, agencies!inner(name, logo_url, brand_color, support_whatsapp, custom_domain, custom_domain_verified_at))")
    .eq("email", email);
  // no domínio de uma agência, só vale o acesso aos clientes dela
  const host = await hostAgency();
  const found = (rows ?? []).map((r) => {
    const c = (Array.isArray(r.clients) ? r.clients[0] : r.clients) as Record<string, unknown>;
    return { clientId: String(r.client_id), clientName: String(c.name), agencyId: String(c.agency_id), agency: (Array.isArray(c.agencies) ? c.agencies[0] : c.agencies) as Membership["agency"] };
  }).filter((m) => host === undefined || m.agencyId === host?.id);
  if (!found.length) return ok(GENERIC);

  const first = found[0];
  const sent = await sendMemberLink({ email, origin: await currentOrigin(), next: found.length === 1 && next === "/cliente" ? `/cliente/${first.clientId}` : next, clientName: found.length === 1 ? first.clientName : "seus assistentes", agency: first.agency });
  if (!sent.ok) console.error("link de acesso não enviado:", sent.message);
  return ok(GENERIC);
}

/* ------------------------------------------------------------------ atendimento */

async function ownConversation(clientId: string, conversationId: string) {
  const ctx = await memberForAction(clientId, "handoff");
  if (!ctx) return null;
  const { data } = await ctx.admin.from("conversations").select("id").eq("id", conversationId).in("bot_id", ctx.botIds.length ? ctx.botIds : ["00000000-0000-0000-0000-000000000000"]).maybeSingle();
  return data ? ctx : null;
}

const convPath = (clientId: string, conversationId: string) => `/cliente/${clientId}/conversas/${conversationId}`;

export async function memberTakeOver(clientId: string, conversationId: string): Promise<ActionResult> {
  const ctx = await ownConversation(clientId, conversationId);
  if (!ctx) return fail("Você não tem permissão para atender esta conversa.");
  const r = await takeOver(ctx.admin, conversationId, memberAttendant(ctx.member, ctx.email));
  // só quem vence grava na auditoria (quem perde vê quem já está atendendo)
  if (r.ok && r.message !== ALREADY_YOURS) await audit(ctx.admin, { agencyId: ctx.member.agencyId, actorType: "member", actorId: ctx.email, action: "conversa.assumir", targetType: "conversation", targetId: conversationId, ...(await requestMeta()) });
  revalidatePath(convPath(clientId, conversationId));
  return r;
}

/** "Assumir no lugar": troca quem estava atendendo (com confirmação na tela e auditoria). */
export async function memberForceTakeOver(clientId: string, conversationId: string): Promise<ActionResult> {
  const ctx = await ownConversation(clientId, conversationId);
  if (!ctx) return fail("Você não tem permissão para atender esta conversa.");
  const r = await takeOver(ctx.admin, conversationId, memberAttendant(ctx.member, ctx.email), { force: true });
  if (r.ok && r.message !== ALREADY_YOURS) await audit(ctx.admin, { agencyId: ctx.member.agencyId, actorType: "member", actorId: ctx.email, action: "conversa.assumir_no_lugar", targetType: "conversation", targetId: conversationId, before: { atendente: r.previous ?? null }, ...(await requestMeta()) });
  revalidatePath(convPath(clientId, conversationId));
  return r;
}

export async function memberSend(clientId: string, conversationId: string, formData: FormData): Promise<ActionResult> {
  const ctx = await ownConversation(clientId, conversationId);
  if (!ctx) return fail("Você não tem permissão para atender esta conversa.");
  const r = await postAgentMessage(ctx.admin, conversationId, text(formData.get("content")), memberAttendant(ctx.member, ctx.email));
  revalidatePath(convPath(clientId, conversationId));
  return r;
}

export async function memberRelease(clientId: string, conversationId: string): Promise<ActionResult> {
  const ctx = await ownConversation(clientId, conversationId);
  if (!ctx) return fail("Você não tem permissão para atender esta conversa.");
  const r = await release(ctx.admin, conversationId, memberAttendant(ctx.member, ctx.email));
  if (r.ok) await audit(ctx.admin, { agencyId: ctx.member.agencyId, actorType: "member", actorId: ctx.email, action: "conversa.devolver", targetType: "conversation", targetId: conversationId, ...(await requestMeta()) });
  revalidatePath(convPath(clientId, conversationId));
  return r;
}

/* ------------------------------------------------------------------ ensinar o assistente */

async function ownBot(clientId: string, botId: string) {
  const ctx = await memberForAction(clientId, "knowledge");
  return ctx && ctx.botIds.includes(botId) ? ctx : null;
}

const NO_KNOWLEDGE = "Você não tem permissão para editar o que o assistente sabe.";

export async function memberAnswer(clientId: string, botId: string, unansweredId: string, formData: FormData): Promise<ActionResult> {
  const ctx = await ownBot(clientId, botId);
  if (!ctx) return fail(NO_KNOWLEDGE);
  const r = await answerQuestion(ctx.admin, { botId, unansweredId, question: text(formData.get("question")), answer: text(formData.get("answer")), author: ctx.email });
  revalidatePath(`/cliente/${clientId}/aprender`);
  return r;
}

export async function memberDismiss(clientId: string, botId: string, unansweredId: string): Promise<ActionResult> {
  const ctx = await ownBot(clientId, botId);
  if (!ctx) return fail(NO_KNOWLEDGE);
  const r = await dismissQuestion(ctx.admin, botId, unansweredId, ctx.email);
  revalidatePath(`/cliente/${clientId}/aprender`);
  return r;
}

export async function memberSaveText(clientId: string, botId: string, sourceId: string | null, formData: FormData): Promise<ActionResult> {
  const ctx = await ownBot(clientId, botId);
  if (!ctx) return fail(NO_KNOWLEDGE);
  const r = await saveTextSource(ctx.admin, { botId, sourceId: sourceId ?? undefined, kind: text(formData.get("kind")), title: text(formData.get("title")), content: String(formData.get("content") ?? ""), author: ctx.email });
  revalidatePath(`/cliente/${clientId}/aprender`);
  return r;
}

export async function memberDeleteText(clientId: string, botId: string, sourceId: string): Promise<ActionResult> {
  const ctx = await ownBot(clientId, botId);
  if (!ctx) return fail(NO_KNOWLEDGE);
  const r = await deleteTextSource(ctx.admin, botId, sourceId);
  revalidatePath(`/cliente/${clientId}/aprender`);
  return r;
}

/**
 * Clique em "Entrar" na tela do link mágico: só aqui o token é usado. Abrir o link não gasta
 * nada, então os robôs de segurança de e-mail (que abrem os links antes da pessoa) não
 * invalidam o acesso.
 */
export async function confirmAccess(tokenHash: string, type: string, nextRaw: string): Promise<ActionResult> {
  const next = /^\/cliente(\/[\w-]*)*$/.test(nextRaw) ? nextRaw : "/cliente";
  const otpType = (EMAIL_LINK_TYPES as readonly string[]).includes(type) ? (type as (typeof EMAIL_LINK_TYPES)[number]) : "magiclink";
  const supabase = await createClient();
  const { data, error } = tokenHash ? await supabase.auth.verifyOtp({ type: otpType, token_hash: tokenHash }) : { data: null, error: new Error("sem token") };
  if (error || !data?.user?.email) {
    console.warn("link da área do cliente recusado:", error?.message);
    redirect(`/cliente/entrar?erro=link&next=${encodeURIComponent(next)}`);
  }
  await createAdminClient().from("client_members").update({ last_login_at: new Date().toISOString() }).eq("email", data.user.email.toLowerCase());
  // registro de acesso (Marco Civil): entrada pelo link do e-mail
  const meta = await requestMeta();
  await logAccess(createAdminClient(), { actorType: "member", actorId: data.user.id, email: data.user.email, event: "magic_link", ip: meta.ip, userAgent: meta.userAgent });
  redirect(next);
}

/* ------------------------------------------------------------------ canais */

/**
 * O negócio desconecta o WhatsApp ou o Instagram de um assistente dele (área do cliente). Nada é
 * apagado na Meta (o número e a conta continuam dele); a agência é avisada e fica na auditoria.
 */
/* ------------------------------------------------------------------ privacidade (leva S) */

/** Prazos que valem para o cliente: o dele e o da agência. */
async function memberRetention(ctx: NonNullable<Awaited<ReturnType<typeof memberForAction>>>, clientId: string) {
  const { data } = await ctx.admin.from("clients").select("retention_months, agencies(retention_months)").eq("id", clientId).maybeSingle();
  const agency = (Array.isArray(data?.agencies) ? data.agencies[0] : data?.agencies) as { retention_months: number | null } | null | undefined;
  return { clientMonths: (data?.retention_months as number | null) ?? null, agencyMonths: agency?.retention_months ?? null };
}

const monthsToDays = (m: number | null) => (m ? m * 30 : null);

/** O cliente escolhe o prazo de guarda (vazio = o da agência). Diminuir pede confirmação e avisa a agência. */
export async function memberSetRetention(clientId: string, formData: FormData): Promise<ActionResult> {
  const ctx = await memberForAction(clientId, "manager");
  if (!ctx) return fail("Sua sessão expirou. Entre de novo.");
  const raw = text(formData.get("retention_months"));
  const months = raw ? Number(raw) : null;
  if (months !== null && !isRetentionMonths(months)) return fail("Escolha 6, 12 ou 24 meses, ou o prazo da agência.");
  const cur = await memberRetention(ctx, clientId);
  const before = monthsToDays(cur.clientMonths ?? cur.agencyMonths);
  const after = monthsToDays(months ?? cur.agencyMonths);
  const reduced = retentionReduced(before, after);
  if (reduced && formData.get("confirm") !== "on") return fail(`Para diminuir o prazo, marque a confirmação: o que tiver mais de ${retentionLabel(after)} é apagado na próxima limpeza diária.`);
  const { error } = await ctx.admin.from("clients").update({ retention_months: months }).eq("id", clientId);
  if (error) return fail("Não foi possível salvar. Tente de novo.");
  await audit(ctx.admin, { agencyId: ctx.member.agencyId, actorType: "member", actorId: ctx.email, action: "cliente.retencao", targetType: "client", targetId: clientId, before: { retention_months: cur.clientMonths }, after: { retention_months: months }, ...(await requestMeta()) });
  if (reduced) {
    await notifyAgencyOwner(ctx.admin, ctx.member.agencyId, `${ctx.member.clientName} diminuiu o prazo de guarda das conversas`, [
      `${ctx.email}, do cliente ${ctx.member.clientName}, mudou o prazo de guarda das conversas e contatos para ${retentionLabel(after)} pela área do cliente.`,
      "",
      "Conversas paradas há mais tempo que isso, com as mensagens, leads e fichas de contato sem conversa, passam a ser apagados na limpeza diária. Os relatórios continuam com os números.",
      "",
      `Painel: ${appUrl(`/painel/clientes/${clientId}?tab=dados`)}`,
    ]).catch(() => false);
  }
  revalidatePath(`/cliente/${clientId}/privacidade`);
  return ok(months ? `Prazo salvo: ${months} meses.` : `Vale o prazo da agência (${retentionLabel(monthsToDays(cur.agencyMonths))}).`);
}

/** Modo dados sensíveis de um assistente: as conversas dele saem no prazo curto escolhido (7 a 90 dias). */
export async function memberSetSensitive(clientId: string, botId: string, formData: FormData): Promise<ActionResult> {
  const ctx = await memberForAction(clientId, "manager");
  if (!ctx || !ctx.botIds.includes(botId)) return fail("Assistente não encontrado.");
  const cur = await memberRetention(ctx, clientId);
  const r = await applySensitiveMode(ctx.admin, { botId, on: formData.get("sensitive") === "on", days: Number(formData.get("days")), confirmed: formData.get("confirm") === "on", clientMonths: cur.clientMonths, agencyMonths: cur.agencyMonths });
  if (!r.ok) return fail(r.message);
  const c = r.change;
  await audit(ctx.admin, { agencyId: ctx.member.agencyId, actorType: "member", actorId: ctx.email, action: "bot.modo_sensivel", targetType: "bot", targetId: botId, before: c.before, after: { sensitive_mode: c.on, sensitive_retention_days: c.days }, ...(await requestMeta()) });
  // a agência fica sabendo quando o cliente liga, desliga ou encurta
  if (c.toggled || c.reduced) {
    await notifyAgencyOwner(ctx.admin, ctx.member.agencyId, `${ctx.member.clientName} ${c.on ? "ligou" : "desligou"} o modo dados sensíveis`, [
      `${ctx.email}, do cliente ${ctx.member.clientName}, ${sensitiveChangeText(c)}.`,
      "",
      `Painel: ${appUrl(`/painel/clientes/${clientId}?tab=dados`)}`,
    ]).catch(() => false);
  }
  revalidatePath(`/cliente/${clientId}/privacidade`);
  return ok(sensitiveSavedText(c));
}

export async function memberDisconnectChannel(clientId: string, botId: string, channel: "whatsapp" | "instagram"): Promise<ActionResult> {
  const ctx = await memberForAction(clientId, "manager");
  if (!ctx || !ctx.botIds.includes(botId)) return fail("Assistente não encontrado.");
  const r = channel === "whatsapp" ? await disconnectWhatsAppChannel(ctx.admin, botId) : await disconnectInstagramChannel(ctx.admin, botId);
  if (!r.ok) return fail("Não foi possível desconectar. Tente de novo.");
  await audit(ctx.admin, { agencyId: ctx.member.agencyId, actorType: "member", actorId: ctx.email, action: "canal.desconectar", targetType: "bot", targetId: botId, before: { channel }, ...(await requestMeta()) });
  const { data: bot } = await ctx.admin.from("bots").select("name").eq("id", botId).maybeSingle();
  const name = channel === "whatsapp" ? "WhatsApp" : "Instagram";
  await notifyAgencyOwner(ctx.admin, ctx.member.agencyId, `${ctx.member.clientName} desconectou o ${name}`, [
    `${ctx.email}, do cliente ${ctx.member.clientName}, desconectou o ${name} do assistente ${bot?.name ?? ""} pela área do cliente.`,
    "",
    "O assistente parou de responder por esse canal. Para conectar de novo, mande um link de conexão pelo painel.",
    "",
    `Painel: ${appUrl(`/painel/bots/${botId}?tab=${channel}`)}`,
  ]).catch(() => false);
  revalidatePath(`/cliente/${clientId}/canais`);
  return ok(`${name} desconectado. O assistente parou de responder por ele.`);
}

/* ------------------------------------------------------------------ papéis do portal (leva B1') */

/** Meu perfil no portal: nome de exibição e foto (o contato vê quando a pessoa atende). */
export async function memberUpdateProfile(clientId: string, formData: FormData): Promise<ActionResult> {
  const ctx = await memberForAction(clientId);
  if (!ctx) return fail("Sua sessão expirou. Entre de novo.");
  const name = text(formData.get("display_name")).replace(/\s+/g, " ").trim();
  const avatar = text(formData.get("avatar_url")) || null;
  const problem = profileProblem(name, avatar, ctx.member.memberId);
  if (problem) return fail(problem);
  // o mesmo e-mail pode estar em mais de um cliente: o perfil vale para todos eles
  const { error } = await ctx.admin.from("client_members").update({ display_name: name, avatar_url: avatar }).eq("email", ctx.email);
  if (error) return fail("Não foi possível salvar. Tente de novo.");
  revalidatePath(`/cliente/${clientId}`, "layout");
  return ok("Perfil salvo. As próximas mensagens já saem com este nome.");
}

const ONLY_MANAGER = "Só o gestor mexe na equipe do portal.";

/** Gestor convida um atendente (o gestor novo vem da agência). */
export async function memberInvite(clientId: string, formData: FormData): Promise<ActionResult> {
  const ctx = await memberForAction(clientId, "manager");
  if (!ctx) return fail(ONLY_MANAGER);
  const email = text(formData.get("email")).toLowerCase();
  if (!isEmail(email)) return fail("E-mail inválido.");
  const { count } = await ctx.admin.from("client_members").select("id", { count: "exact", head: true }).eq("client_id", clientId);
  if ((count ?? 0) >= 20) return fail("Limite de 20 pessoas por cliente.");
  const { error } = await ctx.admin.from("client_members").insert({ client_id: clientId, email, role: "agent" });
  if (error) return fail(error.code === "23505" ? "Esse e-mail já tem acesso." : "Não foi possível adicionar. Tente de novo.");
  await audit(ctx.admin, { agencyId: ctx.member.agencyId, actorType: "member", actorId: ctx.email, action: "portal.pessoa_adicionar", targetType: "client", targetId: clientId, after: { email, papel: "atendente" }, ...(await requestMeta()) });
  revalidatePath(`/cliente/${clientId}/equipe`);
  const sent = await sendMemberLink({ email, origin: await currentOrigin(), next: `/cliente/${clientId}`, clientName: ctx.member.clientName, agency: ctx.member.agency });
  if (!sent.ok) return fail(`Acesso criado, mas o convite não foi enviado: ${sent.message} A pessoa pode entrar pela área do cliente pedindo um link.`);
  return ok(`Convite enviado para ${email}.`);
}

/** Atendente desta loja (o gestor só mexe em atendentes; gestores são da agência). */
async function agentOf(ctx: NonNullable<Awaited<ReturnType<typeof memberForAction>>>, clientId: string, memberId: string) {
  const { data } = await ctx.admin.from("client_members").select("id, email, role").eq("id", memberId).eq("client_id", clientId).maybeSingle();
  return data && data.role === "agent" && data.id !== ctx.member.memberId ? (data as { id: string; email: string; role: string }) : null;
}

export async function memberResendLink(clientId: string, memberId: string): Promise<ActionResult> {
  const ctx = await memberForAction(clientId, "manager");
  if (!ctx) return fail(ONLY_MANAGER);
  const agent = await agentOf(ctx, clientId, memberId);
  if (!agent) return fail("Pessoa não encontrada.");
  const sent = await sendMemberLink({ email: agent.email, origin: await currentOrigin(), next: `/cliente/${clientId}`, clientName: ctx.member.clientName, agency: ctx.member.agency });
  return sent.ok ? ok(`Link enviado de novo para ${agent.email}.`) : fail(sent.message);
}

export async function memberRemove(clientId: string, memberId: string): Promise<ActionResult> {
  const ctx = await memberForAction(clientId, "manager");
  if (!ctx) return fail(ONLY_MANAGER);
  const agent = await agentOf(ctx, clientId, memberId);
  if (!agent) return fail("Só dá para remover atendentes. Para tirar um gestor, fale com a agência.");
  const { error } = await ctx.admin.from("client_members").delete().eq("id", agent.id);
  if (error) return fail("Não foi possível remover. Tente de novo.");
  await audit(ctx.admin, { agencyId: ctx.member.agencyId, actorType: "member", actorId: ctx.email, action: "portal.pessoa_remover", targetType: "client", targetId: clientId, before: { email: agent.email, papel: "atendente" }, ...(await requestMeta()) });
  revalidatePath(`/cliente/${clientId}/equipe`);
  return ok("Acesso removido. A pessoa perde o acesso na próxima página que abrir.");
}

/** Horário de atendimento de um assistente (gestor, quando a agência libera). */
export async function memberSetHours(clientId: string, botId: string, formData: FormData): Promise<ActionResult> {
  const ctx = await memberForAction(clientId, "hours");
  if (!ctx || !ctx.botIds.includes(botId)) return fail("Assistente não encontrado.");
  const parsed = parseHoursForm(Object.fromEntries(formData) as Record<string, string>);
  if ("error" in parsed) return fail(parsed.error);
  const { data: bot } = await ctx.admin.from("bots").select("human_handoff").eq("id", botId).maybeSingle();
  const handoff = ((bot?.human_handoff ?? {}) as HumanHandoff) ?? {};
  // com horário, a mensagem de fora do horário precisa dizer quando a equipe volta
  if (parsed.hours && awayMessageProblem(handoff.away_message ?? "", true)) return fail(`A mensagem de fora do horário deste assistente não diz quando a equipe volta. Peça para ${ctx.member.agency.name} ajustar antes de pôr horário.`);
  const { error } = await ctx.admin.from("bots").update({ human_handoff: { ...handoff, hours: parsed.hours } }).eq("id", botId);
  if (error) return fail("Não foi possível salvar. Tente de novo.");
  await audit(ctx.admin, { agencyId: ctx.member.agencyId, actorType: "member", actorId: ctx.email, action: "portal.horario", targetType: "bot", targetId: botId, before: { hours: handoff.hours ?? null }, after: { hours: parsed.hours }, ...(await requestMeta()) });
  revalidatePath(`/cliente/${clientId}/horario`);
  return ok(parsed.hours ? "Horário salvo. Fora dele, o assistente diz quando a equipe volta." : "Sem horário: o assistente diz que a equipe responde assim que possível.");
}

/** Gestor confirma um pedido do titular feito pelo chat (o negócio é o controlador). */
export async function memberConfirmRequest(clientId: string, requestId: string): Promise<ActionResult> {
  const ctx = await memberForAction(clientId, "manager");
  if (!ctx) return fail("Só o gestor confirma pedidos de exclusão.");
  if (!(await memberHasMfa())) return fail("Faça a verificação em duas etapas (código do app autenticador) e tente de novo.");
  const { data: req } = await ctx.admin.from("data_subject_requests").select("id, status").eq("id", requestId).eq("client_id", clientId).maybeSingle();
  if (!req) return fail("Pedido não encontrado.");
  if (req.status !== "aguardando") return ok("Este pedido já foi atendido.");
  const summary = await executeRequest(ctx.admin, requestId, ctx.email);
  if (!summary) return ok("Este pedido já foi atendido.");
  await audit(ctx.admin, { agencyId: ctx.member.agencyId, actorType: "member", actorId: ctx.email, action: "titular.confirmar", targetType: "data_subject_request", targetId: requestId, after: { ...summary }, ...(await requestMeta()) });
  revalidatePath(`/cliente/${clientId}/privacidade`);
  return ok("Pedido atendido: os dados da pessoa foram apagados.");
}

/** Segundo fator no portal: entrada ou falha no registro de acesso e, no primeiro código, o cadastro na auditoria. */
export async function recordMemberMfa(clientId: string, success: boolean, enrolled: boolean): Promise<void> {
  const ctx = await memberForAction(clientId);
  if (!ctx) return;
  const { data } = await (await createClient()).auth.getClaims();
  const meta = await requestMeta();
  if (data?.claims?.sub) await logAccess(ctx.admin, { actorType: "member", actorId: String(data.claims.sub), email: ctx.email, event: success ? "login" : "login_failed", ip: meta.ip, userAgent: meta.userAgent, agencyId: ctx.member.agencyId });
  if (success && enrolled) await audit(ctx.admin, { agencyId: ctx.member.agencyId, actorType: "member", actorId: ctx.email, action: "seguranca.mfa_cadastrar", targetType: "client", targetId: clientId, ...meta });
}

/** O app autenticador da pessoa do portal foi removido (evento grave para a agência). */
export async function recordMemberMfaRemoved(clientId: string): Promise<void> {
  const ctx = await memberForAction(clientId);
  if (!ctx) return;
  await audit(ctx.admin, { agencyId: ctx.member.agencyId, actorType: "member", actorId: ctx.email, action: "seguranca.mfa_remover", targetType: "client", targetId: clientId, ...(await requestMeta()) });
}
