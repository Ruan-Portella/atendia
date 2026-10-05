"use server";

import { revalidatePath } from "next/cache";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { createAdminClient } from "@/lib/supabase/admin";
import { hostAgency } from "@/lib/domain-server";
import { currentOrigin, EMAIL_LINK_TYPES, memberAttendant, memberForAction, sendMemberLink, type Membership } from "@/lib/member";
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
import { SENSITIVE_DAYS, effectiveRetention, isRetentionMonths, retentionLabel, retentionReduced } from "@/lib/retention";
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
  const ctx = await memberForAction(clientId);
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
  const ctx = await memberForAction(clientId);
  if (!ctx || !ctx.botIds.includes(botId)) return fail("Assistente não encontrado.");
  const on = formData.get("sensitive") === "on";
  const chosen = Number(formData.get("days"));
  const { data: bot } = await ctx.admin.from("bots").select("name, sensitive_mode, sensitive_retention_days").eq("id", botId).maybeSingle();
  if (!bot) return fail("Assistente não encontrado.");
  const daysOut = on ? ((SENSITIVE_DAYS as readonly number[]).includes(chosen) ? chosen : null) : (bot.sensitive_retention_days as number);
  if (daysOut === null) return fail("Escolha o prazo: 7, 15, 30, 60 ou 90 dias.");
  const cur = await memberRetention(ctx, clientId);
  const base = { isDemo: false, clientMonths: cur.clientMonths, agencyMonths: cur.agencyMonths };
  const before = effectiveRetention({ ...base, sensitiveMode: Boolean(bot.sensitive_mode), sensitiveDays: bot.sensitive_retention_days as number }).days;
  const after = effectiveRetention({ ...base, sensitiveMode: on, sensitiveDays: daysOut }).days;
  const reduced = retentionReduced(before, after);
  if (reduced && formData.get("confirm") !== "on") return fail(`Para encurtar o prazo, marque a confirmação: as conversas deste assistente com mais de ${retentionLabel(after)} são apagadas na próxima limpeza diária.`);
  const { error } = await ctx.admin.from("bots").update({ sensitive_mode: on, sensitive_retention_days: daysOut }).eq("id", botId);
  if (error) return fail("Não foi possível salvar. Tente de novo.");
  await audit(ctx.admin, { agencyId: ctx.member.agencyId, actorType: "member", actorId: ctx.email, action: "bot.modo_sensivel", targetType: "bot", targetId: botId, before: { sensitive_mode: bot.sensitive_mode, sensitive_retention_days: bot.sensitive_retention_days }, after: { sensitive_mode: on, sensitive_retention_days: daysOut }, ...(await requestMeta()) });
  if (on !== Boolean(bot.sensitive_mode) || reduced) {
    const what = on
      ? `ligou o modo dados sensíveis do assistente ${bot.name}: as conversas dele passam a ser apagadas depois de ${daysOut} dias`
      : `desligou o modo dados sensíveis do assistente ${bot.name}: as conversas voltam ao prazo do cliente (${retentionLabel(after)})`;
    await notifyAgencyOwner(ctx.admin, ctx.member.agencyId, `${ctx.member.clientName} ${on ? "ligou" : "desligou"} o modo dados sensíveis`, [
      `${ctx.email}, do cliente ${ctx.member.clientName}, ${what}.`,
      "",
      `Painel: ${appUrl(`/painel/clientes/${clientId}?tab=dados`)}`,
    ]).catch(() => false);
  }
  revalidatePath(`/cliente/${clientId}/privacidade`);
  return ok(on ? `Modo dados sensíveis ligado: as conversas de ${bot.name} ficam ${daysOut} dias.` : `Modo dados sensíveis desligado: vale o prazo de ${retentionLabel(after)}.`);
}

export async function memberDisconnectChannel(clientId: string, botId: string, channel: "whatsapp" | "instagram"): Promise<ActionResult> {
  const ctx = await memberForAction(clientId);
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
