"use server";

import { revalidatePath } from "next/cache";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { createAdminClient } from "@/lib/supabase/admin";
import { hostAgency } from "@/lib/domain-server";
import { currentOrigin, memberForAction, sendMemberLink, type Membership } from "@/lib/member";
import { clientIp, firstExceeded, hashId } from "@/lib/rate-limit";
import { isEmail, text } from "@/lib/validation";
import { postAgentMessage, release, takeOver } from "@/lib/handoff";
import { answerQuestion, deleteTextSource, dismissQuestion, saveTextSource } from "@/lib/knowledge";
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
  const r = await takeOver(ctx.admin, conversationId);
  revalidatePath(convPath(clientId, conversationId));
  return r;
}

export async function memberSend(clientId: string, conversationId: string, formData: FormData): Promise<ActionResult> {
  const ctx = await ownConversation(clientId, conversationId);
  if (!ctx) return fail("Você não tem permissão para atender esta conversa.");
  const r = await postAgentMessage(ctx.admin, conversationId, text(formData.get("content")), ctx.email);
  revalidatePath(convPath(clientId, conversationId));
  return r;
}

export async function memberRelease(clientId: string, conversationId: string): Promise<ActionResult> {
  const ctx = await ownConversation(clientId, conversationId);
  if (!ctx) return fail("Você não tem permissão para atender esta conversa.");
  const r = await release(ctx.admin, conversationId);
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
