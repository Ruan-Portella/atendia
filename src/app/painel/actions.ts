"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAgency } from "@/lib/agency";
import { postAgentMessage, release, takeOver } from "@/lib/handoff";
import { answerQuestion } from "@/lib/knowledge";
import { sendMemberLink } from "@/lib/member";
import { initials, slugify } from "@/lib/utils";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { assistantName, clientFields, isEmail, text } from "@/lib/validation";
import { addDomainToProject, agencyBaseUrl, checkDomain, parseDomain, removeDomainFromProject } from "@/lib/domain";
import { currentPeriodBR, getClientReport, newPortalToken, periodLabel, portalUrl, sendReportEmail, shiftPeriod } from "@/lib/report";

type Db = Awaited<ReturnType<typeof createClient>>;

const list = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6);

/**
 * Resolve o cliente de um formulário com o seletor de cliente: `client_id` de um cliente
 * existente, ou `client_id=new` + campos `new_client_*`, que criam o cliente na hora.
 */
async function resolveClient(supabase: Db, agencyId: string, fd: FormData): Promise<{ id: string; name: string; site: string | null } | { error: string }> {
  const clientId = text(fd.get("client_id"));
  if (clientId && clientId !== "new") {
    const { data } = await supabase.from("clients").select("id, name, site").eq("id", clientId).maybeSingle();
    if (!data) return { error: "Cliente não encontrado. Recarregue a página e tente de novo." };
    return data;
  }
  const f = clientFields(fd, "new_client_");
  if ("error" in f) return f;
  const { data, error } = await supabase.from("clients").insert({ agency_id: agencyId, ...f }).select("id, name, site").single();
  if (error || !data) return { error: "Não foi possível criar o cliente. Tente de novo." };
  return data;
}

async function botLimitReached(supabase: Db, agencyId: string, limit: number) {
  const { count } = await supabase.from("bots").select("id", { count: "exact", head: true }).eq("agency_id", agencyId).eq("is_demo", false);
  return (count ?? 0) >= limit;
}

/* ------------------------------------------------------------------ clientes */

export async function createClientRecord(formData: FormData): Promise<ActionResult> {
  const { agency } = await requireAgency();
  const supabase = await createClient();
  const f = clientFields(formData);
  if ("error" in f) return fail(f.error);
  const { data, error } = await supabase.from("clients").insert({ agency_id: agency.id, ...f }).select("id").single();
  if (error || !data) return fail("Não foi possível criar o cliente. Tente de novo.");
  revalidatePath("/painel", "layout");
  redirect(`/painel/clientes/${data.id}`);
}

export async function updateClientRecord(clientId: string, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const f = clientFields(formData);
  if ("error" in f) return fail(f.error);
  const { error, count } = await supabase.from("clients").update(f, { count: "exact" }).eq("id", clientId);
  if (error) return fail("Não foi possível salvar. Tente de novo.");
  if (!count) return fail("Cliente não encontrado.");
  revalidatePath("/painel", "layout");
  return ok("Cliente atualizado.");
}

/** Só apaga cliente sem chatbots, para ninguém perder base de conhecimento sem querer. */
export async function deleteClientRecord(clientId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { count: bots } = await supabase.from("bots").select("id", { count: "exact", head: true }).eq("client_id", clientId);
  if (bots) return fail(`Este cliente tem ${bots} chatbot${bots > 1 ? "s" : ""}. Exclua ${bots > 1 ? "os chatbots" : "o chatbot"} antes.`);
  const { error, count } = await supabase.from("clients").delete({ count: "exact" }).eq("id", clientId);
  if (error) return fail("Não foi possível excluir. Tente de novo.");
  if (!count) return fail("Cliente não encontrado.");
  revalidatePath("/painel", "layout");
  redirect("/painel/clientes");
}

/* ------------------------------------------------------------------ chatbots */

/** Cria um chatbot (não demo) para um cliente e vai para o editor. */
export async function createBot(formData: FormData): Promise<ActionResult> {
  const { agency, plan } = await requireAgency();
  const supabase = await createClient();
  if (await botLimitReached(supabase, agency.id, plan.bots)) redirect("/painel/cobranca?limite=bots");

  const n = assistantName(formData.get("name"));
  if ("error" in n) return fail(n.error);
  const site = text(formData.get("client_site"));
  if (site.length > 200) return fail("O site pode ter no máximo 200 caracteres.");
  const client = await resolveClient(supabase, agency.id, formData);
  if ("error" in client) return fail(client.error);

  const { data: bot, error } = await supabase
    .from("bots")
    .insert({
      agency_id: agency.id,
      client_id: client.id,
      client_name: client.name,
      name: n.name,
      client_site: site || client.site,
      persona: { tone: "amigável, direto e profissional", welcome: `Olá! Sou ${n.name}, assistente de ${client.name}. Como posso ajudar?` },
      appearance: { color: agency.brand_color, avatar_text: initials(client.name), suggested_questions: ["Quais são os horários?", "Quanto custa?", "Como entro em contato?"] },
    })
    .select("id")
    .single();
  if (error || !bot) return fail("Não foi possível criar o chatbot. Tente de novo.");
  revalidatePath("/painel", "layout");
  redirect(`/painel/bots/${bot.id}`);
}

/** Salva personalidade, aparência, captura de leads e cliente do bot. */
export async function updateBot(botId: string, formData: FormData): Promise<ActionResult> {
  const { agency } = await requireAgency();
  const supabase = await createClient();
  const f = Object.fromEntries(formData) as Record<string, string>;
  const patch: Record<string, unknown> = {};
  if ("name" in f) {
    const n = assistantName(f.name);
    if ("error" in n) return fail(n.error);
    patch.name = n.name;
  }
  if ("client_id" in f) {
    const client = await resolveClient(supabase, agency.id, formData);
    if ("error" in client) return fail(client.error);
    patch.client_id = client.id;
    patch.client_name = client.name;
  }
  if ("client_site" in f) {
    if (f.client_site.trim().length > 200) return fail("O site pode ter no máximo 200 caracteres.");
    patch.client_site = f.client_site.trim() || null;
  }
  if ("tone" in f) {
    if (f.tone.length > 200) return fail("O tom de voz pode ter no máximo 200 caracteres.");
    if ((f.welcome ?? "").length > 300) return fail("A mensagem de boas-vindas pode ter no máximo 300 caracteres.");
    if ((f.instructions ?? "").length > 4000) return fail("As instruções podem ter no máximo 4.000 caracteres.");
    patch.persona = { tone: f.tone, welcome: f.welcome, instructions: f.instructions, language: "português do Brasil" };
  }
  if ("color" in f) {
    if (!/^#[0-9a-fA-F]{6}$/.test(f.color)) return fail("Cor inválida.");
    const offset = Math.min(200, Math.max(0, Math.round(Number(f.offset)) || 20));
    patch.appearance = { color: f.color, avatar_text: (f.avatar_text || "AI").slice(0, 2).toUpperCase(), suggested_questions: list(formData.get("suggested")), position: f.position === "left" ? "left" : "right", offset };
  }
  if ("lead_enabled" in f || "notify_email" in f) {
    const email = f.notify_email?.trim() || null;
    if (email && !isEmail(email)) return fail("E-mail de aviso inválido.");
    patch.lead_capture = { enabled: f.lead_enabled === "on", notify_email: email, notify_whatsapp: f.notify_whatsapp?.trim() || null };
  }
  if (!Object.keys(patch).length) return fail("Nada para salvar.");

  const { error, count } = await supabase.from("bots").update(patch, { count: "exact" }).eq("id", botId);
  if (error) return fail("Não foi possível salvar. Tente de novo.");
  if (!count) return fail("Chatbot não encontrado.");
  revalidatePath("/painel", "layout");
  return ok("Alterações salvas.");
}

export async function setBotStatus(botId: string, status: "live" | "draft"): Promise<ActionResult> {
  const supabase = await createClient();
  if (status === "live") {
    const { count } = await supabase.from("sources").select("id", { count: "exact", head: true }).eq("bot_id", botId).eq("status", "ready");
    if (!count) return fail("Adicione pelo menos uma fonte pronta antes de publicar.");
  }
  const { error } = await supabase.from("bots").update({ status }).eq("id", botId);
  if (error) return fail("Não foi possível mudar o status. Tente de novo.");
  revalidatePath("/painel", "layout");
  return ok(status === "live" ? "Chatbot publicado. Ele já responde no site." : "Chatbot fora do ar. O balão some do site do cliente em até um minuto.");
}

/** Converte uma demo em chatbot de verdade (mantém a base de conhecimento), ligado a um cliente. */
export async function convertDemo(botId: string, formData: FormData): Promise<ActionResult> {
  const { agency, plan } = await requireAgency();
  const supabase = await createClient();
  if (await botLimitReached(supabase, agency.id, plan.bots)) redirect("/painel/cobranca?limite=bots");
  const n = text(formData.get("name")) ? assistantName(formData.get("name")) : null;
  if (n && "error" in n) return fail(n.error);
  const client = await resolveClient(supabase, agency.id, formData);
  if ("error" in client) return fail(client.error);
  const patch: Record<string, unknown> = { is_demo: false, demo_slug: null, status: "live", client_id: client.id, client_name: client.name };
  if (n) patch.name = n.name;
  const { error } = await supabase.from("bots").update(patch).eq("id", botId);
  if (error) return fail("Não foi possível converter a demo. Tente de novo.");
  revalidatePath("/painel", "layout");
  redirect(`/painel/bots/${botId}?tab=instalacao`);
}

/**
 * Apaga o chatbot (fontes, trechos, conversas e leads vão junto por cascade).
 * `redirectTo` quando chamado de dentro do editor; da lista, só revalida.
 */
export async function deleteBot(botId: string, redirectTo?: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error, count } = await supabase.from("bots").delete({ count: "exact" }).eq("id", botId);
  if (error) return fail("Não foi possível excluir. Tente de novo.");
  if (!count) return fail("Chatbot não encontrado.");
  revalidatePath("/painel", "layout");
  if (redirectTo) redirect(redirectTo);
  return ok("Chatbot excluído.");
}

export async function resolveUnanswered(id: string, botId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("unanswered").update({ resolved: true, resolved_by: "agência" }).eq("id", id);
  if (error) return fail("Não foi possível marcar como resolvida.");
  revalidatePath(`/painel/bots/${botId}`);
  return ok("Marcada como resolvida.");
}

export async function deleteLead(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error, count } = await supabase.from("leads").delete({ count: "exact" }).eq("id", id);
  if (error) return fail("Não foi possível excluir o lead.");
  if (!count) return fail("Lead não encontrado.");
  revalidatePath("/painel", "layout");
  return ok("Lead excluído.");
}

/** Marca da agência (white-label). */
export async function updateAgency(formData: FormData): Promise<ActionResult> {
  const { agency } = await requireAgency();
  const supabase = await createClient();
  const parsed = z
    .object({ name: z.string().trim().min(2, "Nome muito curto.").max(80), brand_color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Cor inválida."), support_whatsapp: z.string().max(30).optional(), logo_url: z.string().max(400).optional() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const d = parsed.data;
  const { error } = await supabase
    .from("agencies")
    .update({ name: d.name, slug: agency.slug.startsWith(slugify(d.name)) ? agency.slug : `${slugify(d.name)}-${agency.slug.split("-").pop()}`, brand_color: d.brand_color, support_whatsapp: d.support_whatsapp?.replace(/\D/g, "") || null, logo_url: d.logo_url || null })
    .eq("id", agency.id);
  if (error) return fail("Não foi possível salvar a marca. Tente de novo.");
  revalidatePath("/painel", "layout");
  return ok("Marca atualizada.");
}

/* ------------------------------------------------------------------ portal e relatório */

/** Liga o portal do cliente (ou troca o link, invalidando o antigo). */
export async function enablePortal(clientId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error, count } = await supabase.from("clients").update({ portal_token: newPortalToken() }, { count: "exact" }).eq("id", clientId);
  if (error || !count) return fail("Não foi possível gerar o link. Tente de novo.");
  revalidatePath(`/painel/clientes/${clientId}`);
  return ok("Link do cliente pronto.");
}

export async function disablePortal(clientId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("clients").update({ portal_token: null }).eq("id", clientId);
  if (error) return fail("Não foi possível desligar o link. Tente de novo.");
  revalidatePath(`/painel/clientes/${clientId}`);
  return ok("Link desligado. Quem tinha o endereço não consegue mais abrir.");
}

export async function saveReportEmail(clientId: string, formData: FormData): Promise<ActionResult> {
  const email = text(formData.get("report_email")).toLowerCase();
  if (email && !isEmail(email)) return fail("E-mail inválido.");
  const supabase = await createClient();
  const { error } = await supabase.from("clients").update({ report_email: email || null }).eq("id", clientId);
  if (error) return fail("Não foi possível salvar. Tente de novo.");
  revalidatePath(`/painel/clientes/${clientId}`);
  return ok(email ? "Pronto: o relatório vai todo dia 1º para esse e-mail." : "Envio automático desligado.");
}

/** Manda agora o relatório de um mês (padrão: mês passado) para o e-mail do cliente. */
export async function sendReportNow(clientId: string, period?: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: client } = await supabase.from("clients").select("id, report_email, portal_token").eq("id", clientId).maybeSingle();
  if (!client) return fail("Cliente não encontrado.");
  if (!client.report_email) return fail("Informe o e-mail do cliente antes de enviar.");
  if (!process.env.RESEND_API_KEY) return fail("O envio de e-mail não está configurado neste servidor (RESEND_API_KEY).");
  let token = client.portal_token;
  if (!token) {
    token = newPortalToken();
    await supabase.from("clients").update({ portal_token: token }).eq("id", clientId);
  }
  const p = period ?? shiftPeriod(currentPeriodBR(), -1);
  const report = await getClientReport(supabase, clientId, p);
  if (!report) return fail("Não foi possível montar o relatório.");
  try {
    await sendReportEmail(report, client.report_email, `${portalUrl(token, agencyBaseUrl(report.agency))}?mes=${p}`);
  } catch (e) {
    return fail(`O e-mail não foi enviado: ${(e as Error).message}`);
  }
  // o envio automático do dia 1º não repete um mês já mandado à mão
  if (p === shiftPeriod(currentPeriodBR(), -1)) await supabase.from("clients").update({ report_last_period: p }).eq("id", clientId);
  revalidatePath(`/painel/clientes/${clientId}`);
  return ok(`Relatório de ${periodLabel(p)} enviado para ${client.report_email}.`);
}

/* ------------------------------------------------------------------ atendimento humano */

/** Como as mensagens da agência ficam assinadas (o cliente final assina com o e-mail dele). */
const AGENCY_AUTHOR = "agência";

/**
 * Confere pela RLS que a conversa é da agência logada e devolve a service role para
 * escrever (conversas e mensagens são só leitura para o usuário, de propósito).
 */
async function ownedConversation(conversationId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("conversations").select("id, bot_id").eq("id", conversationId).maybeSingle();
  return data ? { conv: data, admin: createAdminClient() } : null;
}

export async function takeOverConversation(conversationId: string): Promise<ActionResult> {
  const owned = await ownedConversation(conversationId);
  if (!owned) return fail("Conversa não encontrada.");
  const r = await takeOver(owned.admin, conversationId);
  revalidatePath(`/painel/bots/${owned.conv.bot_id}/conversas/${conversationId}`);
  return r;
}

export async function sendAgentMessage(conversationId: string, formData: FormData): Promise<ActionResult> {
  const owned = await ownedConversation(conversationId);
  if (!owned) return fail("Conversa não encontrada.");
  const r = await postAgentMessage(owned.admin, conversationId, text(formData.get("content")), AGENCY_AUTHOR);
  revalidatePath(`/painel/bots/${owned.conv.bot_id}/conversas/${conversationId}`);
  return r;
}

/** Devolve a conversa ao assistente (ele volta a responder, sabendo o que você escreveu). */
export async function releaseConversation(conversationId: string): Promise<ActionResult> {
  const owned = await ownedConversation(conversationId);
  if (!owned) return fail("Conversa não encontrada.");
  const r = await release(owned.admin, conversationId);
  revalidatePath(`/painel/bots/${owned.conv.bot_id}/conversas/${conversationId}`);
  revalidatePath("/painel", "layout");
  return r;
}

/* ------------------------------------------------------------------ base de conhecimento */

/**
 * Responde uma pergunta que o assistente não soube: a resposta entra num FAQ do bot
 * ("Respostas do painel"), é indexada na hora e a pergunta sai da lista.
 */
export async function answerUnanswered(unansweredId: string, botId: string, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: bot } = await supabase.from("bots").select("id").eq("id", botId).maybeSingle();
  if (!bot) return fail("Chatbot não encontrado.");
  const r = await answerQuestion(createAdminClient(), { botId, unansweredId, question: text(formData.get("question")), answer: text(formData.get("answer")), author: AGENCY_AUTHOR });
  revalidatePath(`/painel/bots/${botId}`);
  return r;
}

export async function setAutoRefresh(botId: string, formData: FormData): Promise<ActionResult> {
  const enabled = formData.get("auto_refresh") === "on";
  const supabase = await createClient();
  const { error } = await supabase.from("bots").update({ auto_refresh: enabled }).eq("id", botId);
  if (error) return fail("Não foi possível salvar. Tente de novo.");
  revalidatePath(`/painel/bots/${botId}`);
  return ok(enabled ? "O site será relido toda semana." : "Releitura automática desligada.");
}

/* ------------------------------------------------------------------ domínio próprio */

/** Salva (ou remove) o domínio próprio. Trocar de domínio exige verificar de novo. */
export async function saveCustomDomain(formData: FormData): Promise<ActionResult> {
  const { agency, plan } = await requireAgency();
  if (!plan.customDomain) return fail("Domínio próprio está disponível a partir do plano Agência.");
  const parsed = parseDomain(text(formData.get("custom_domain")));
  if ("error" in parsed) return fail(parsed.error);
  const domain = parsed.domain;
  if (domain === agency.custom_domain) return ok("Nada mudou.");

  if (domain) {
    const admin = createAdminClient();
    const { data: taken } = await admin.from("agencies").select("id").eq("custom_domain", domain).neq("id", agency.id).maybeSingle();
    if (taken) return fail("Este domínio já está cadastrado em outra conta.");
    const added = await addDomainToProject(domain);
    if (!added.ok) return fail(added.message);
  }
  const supabase = await createClient();
  const { error } = await supabase.from("agencies").update({ custom_domain: domain, custom_domain_verified_at: null }).eq("id", agency.id);
  if (error) return fail(error.code === "23505" ? "Este domínio já está cadastrado em outra conta." : "Não foi possível salvar o domínio.");
  if (agency.custom_domain) await removeDomainFromProject(agency.custom_domain);
  revalidatePath("/painel", "layout");
  return ok(domain ? "Domínio salvo. Agora crie o registro DNS abaixo e clique em Verificar." : "Domínio removido. Os links voltam a usar o endereço padrão.");
}

/** Confere se o domínio já responde por nós; se sim, os links passam a usá-lo. */
export async function verifyCustomDomain(): Promise<ActionResult> {
  const { agency } = await requireAgency();
  if (!agency.custom_domain) return fail("Cadastre um domínio primeiro.");
  const status = await checkDomain(agency.custom_domain);
  if (!status.live) return fail(status.message);
  const supabase = await createClient();
  await supabase.from("agencies").update({ custom_domain_verified_at: new Date().toISOString() }).eq("id", agency.id);
  revalidatePath("/painel", "layout");
  return ok("Domínio verificado! Demos, portal do cliente e código do widget já usam ele.");
}

/* ------------------------------------------------------------------ acesso do cliente final */

/** Liga/desliga o que as pessoas do cliente podem fazer na área do cliente. */
export async function setClientPermissions(clientId: string, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const patch = { allow_handoff: formData.get("allow_handoff") === "on", allow_knowledge: formData.get("allow_knowledge") === "on" };
  const { error, count } = await supabase.from("clients").update(patch, { count: "exact" }).eq("id", clientId);
  if (error || !count) return fail("Não foi possível salvar as permissões.");
  revalidatePath(`/painel/clientes/${clientId}`);
  return ok("Permissões salvas. Valem na hora para quem já está logado.");
}

async function inviteContext(clientId: string) {
  const { agency } = await requireAgency();
  const supabase = await createClient();
  const { data: client } = await supabase.from("clients").select("id, name").eq("id", clientId).maybeSingle();
  return client ? { agency, supabase, client } : null;
}

/** Adiciona uma pessoa do cliente e manda o link de acesso por e-mail. */
export async function addClientMember(clientId: string, formData: FormData): Promise<ActionResult> {
  const ctx = await inviteContext(clientId);
  if (!ctx) return fail("Cliente não encontrado.");
  const email = text(formData.get("email")).toLowerCase();
  if (!isEmail(email)) return fail("E-mail inválido.");
  const { count } = await ctx.supabase.from("client_members").select("id", { count: "exact", head: true }).eq("client_id", clientId);
  if ((count ?? 0) >= 20) return fail("Limite de 20 pessoas por cliente.");
  const { error } = await ctx.supabase.from("client_members").insert({ client_id: clientId, email });
  if (error) return fail(error.code === "23505" ? "Esse e-mail já tem acesso." : "Não foi possível adicionar. Tente de novo.");
  revalidatePath(`/painel/clientes/${clientId}`);
  const sent = await sendMemberLink({ email, origin: agencyBaseUrl(ctx.agency), next: `/cliente/${clientId}`, clientName: ctx.client.name, agency: ctx.agency });
  if (!sent.ok) return fail(`Acesso criado, mas o convite não foi enviado: ${sent.message} A pessoa pode entrar pela área do cliente pedindo um link.`);
  return ok(`Convite enviado para ${email}.`);
}

export async function resendClientInvite(clientId: string, memberId: string): Promise<ActionResult> {
  const ctx = await inviteContext(clientId);
  if (!ctx) return fail("Cliente não encontrado.");
  const { data: member } = await ctx.supabase.from("client_members").select("email").eq("id", memberId).eq("client_id", clientId).maybeSingle();
  if (!member) return fail("Pessoa não encontrada.");
  const sent = await sendMemberLink({ email: member.email, origin: agencyBaseUrl(ctx.agency), next: `/cliente/${clientId}`, clientName: ctx.client.name, agency: ctx.agency });
  return sent.ok ? ok(`Link enviado de novo para ${member.email}.`) : fail(sent.message);
}

/** Tira o acesso na hora (a sessão aberta perde acesso na próxima página que abrir). */
export async function removeClientMember(clientId: string, memberId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error, count } = await supabase.from("client_members").delete({ count: "exact" }).eq("id", memberId).eq("client_id", clientId);
  if (error || !count) return fail("Não foi possível remover.");
  revalidatePath(`/painel/clientes/${clientId}`);
  return ok("Acesso removido.");
}
