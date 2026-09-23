"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAgency } from "@/lib/agency";
import { postAgentMessage, release, takeOver } from "@/lib/handoff";
import { answerQuestion } from "@/lib/knowledge";
import { sendMemberLink } from "@/lib/member";
import { appUrl, initials, slugify } from "@/lib/utils";
import { notifyAgencyOwner } from "@/lib/notify";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { assistantName, clientFields, isEmail, text } from "@/lib/validation";
import { addDomainToProject, agencyBaseUrl, checkDomain, parseDomain, removeDomainFromProject } from "@/lib/domain";
import { ONBOARDING_COOKIE } from "@/lib/onboarding";
import { WHATSAPP_BILLING_URL, WhatsAppError, waIdVariants, listWabaPhoneNumbers, startAppSync, exchangeSignupCode, getPhoneNumber, newPin, registerNumber, subscribeApp, unsubscribeApp, whatsappAllowed, whatsappConfigured } from "@/lib/whatsapp";
import { seal, unseal } from "@/lib/secret-box";
import { TOKEN_REJECTED, isAccessError, isPaymentError, markDisconnected, markPaymentIssue } from "@/lib/whatsapp-access";
import { createTemplate, deleteTemplate, formParams, templateName, lines, listSendable, loadTemplateChannel, renderTemplate, sendTemplate, validateTemplate, type TemplateChannel } from "@/lib/whatsapp-templates";
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

/* ------------------------------------------------------------------ whatsapp */

/**
 * Liga um número do WhatsApp (Cloud API) ao chatbot pelo Phone number ID. Confere com a Meta
 * se o token enxerga o número. Por enquanto vale para o número de teste do app (token do .env);
 * o cadastro incorporado vai preencher isso sozinho.
 */
export async function connectWhatsApp(botId: string, formData: FormData): Promise<ActionResult> {
  const { email } = await requireAgency();
  if (!whatsappAllowed(email)) return fail("O WhatsApp ainda não está disponível na sua conta.");
  const supabase = await createClient();
  const { data: bot } = await supabase.from("bots").select("id, is_demo").eq("id", botId).maybeSingle();
  if (!bot) return fail("Chatbot não encontrado.");
  if (bot.is_demo) return fail("Converta a demo em chatbot antes de ligar o WhatsApp.");
  if (!whatsappConfigured()) return fail("O WhatsApp ainda não está configurado no servidor (WHATSAPP_TOKEN).");

  const phoneNumberId = text(formData.get("phone_number_id")).replace(/\D/g, "");
  const wabaId = text(formData.get("waba_id")).replace(/\D/g, "") || null;
  if (phoneNumberId.length < 8) return fail("Cole o Phone number ID (só números), que aparece na configuração da API do app na Meta.");

  let phone: Awaited<ReturnType<typeof getPhoneNumber>>;
  try {
    phone = await getPhoneNumber(phoneNumberId);
    if (wabaId) await subscribeApp(wabaId);
  } catch (e) {
    return fail(`A Meta não reconheceu esse número: ${e instanceof WhatsAppError ? e.message : "erro desconhecido"}. Confira o ID e as permissões do token.`);
  }

  const admin = createAdminClient();
  const { data: taken } = await admin.from("whatsapp_channels").select("bot_id").eq("phone_number_id", phoneNumberId).maybeSingle();
  if (taken && taken.bot_id !== botId) return fail("Este número já está ligado a outro chatbot. Desconecte lá primeiro.");
  await admin.from("whatsapp_channels").delete().eq("bot_id", botId);
  const { error } = await admin.from("whatsapp_channels").insert({ bot_id: botId, phone_number_id: phoneNumberId, waba_id: wabaId, display_phone: phone.display_phone_number ?? null, verified_name: phone.verified_name ?? null });
  if (error) return fail("Não foi possível salvar. Tente de novo.");
  revalidatePath(`/painel/bots/${botId}`);
  return ok(`WhatsApp ${phone.display_phone_number ?? ""} ligado. Mande uma mensagem para ele para testar.`);
}

export interface SignupResult {
  code: string;
  /** Vem vazio na coexistência: a Meta só informa a conta, e o número é buscado nela. */
  phoneNumberId?: string | null;
  wabaId: string;
  businessId?: string | null;
  /** O cliente conectou o WhatsApp Business do celular (o número continua funcionando no app). */
  coexistence?: boolean;
}

/**
 * Fim do cadastro incorporado (Embedded Signup): o cliente escolheu o número na janela da Meta.
 * Troca o código pelo token dele, inscreve o app na conta do WhatsApp e liga o número ao chatbot.
 * Número novo: registra na Cloud API com um PIN. Coexistência (número do app do celular): não
 * registra (já está) e pede a sincronização de contatos e histórico, que a Meta exige em 24 h.
 * Token e PIN ficam cifrados; nada disso volta para o navegador.
 */
export async function completeWhatsAppSignup(botId: string, input: SignupResult): Promise<ActionResult> {
  const { email, agency } = await requireAgency();
  if (!whatsappAllowed(email)) return fail("O WhatsApp ainda não está disponível na sua conta.");
  const supabase = await createClient();
  const { data: bot } = await supabase.from("bots").select("id, is_demo").eq("id", botId).maybeSingle();
  if (!bot) return fail("Chatbot não encontrado.");
  if (bot.is_demo) return fail("Converta a demo em chatbot antes de ligar o WhatsApp.");

  const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
  const coexistence = Boolean(input.coexistence);
  const wabaId = digits(input.wabaId);
  const businessId = digits(input.businessId) || null;
  if (!input.code || wabaId.length < 8) return fail("A Meta não devolveu a conta escolhida. Tente conectar de novo.");

  let token: string;
  let phoneNumberId = digits(input.phoneNumberId);
  try {
    token = await exchangeSignupCode(input.code);
    if (phoneNumberId.length < 8) {
      const numbers = await listWabaPhoneNumbers(wabaId, token);
      if (numbers.length !== 1) return fail(numbers.length ? "Esta conta do WhatsApp tem mais de um número. Por enquanto conecte uma conta com um número só." : "A conta do WhatsApp escolhida não tem número. Tente conectar de novo.");
      phoneNumberId = numbers[0].id;
    }
  } catch (e) {
    console.error("whatsapp: cadastro incorporado falhou", e);
    return fail(`A Meta recusou a conexão: ${e instanceof WhatsAppError ? e.message : "erro desconhecido"}. Tente de novo em instantes.`);
  }

  const admin = createAdminClient();
  const { data: existing } = await admin.from("whatsapp_channels").select("bot_id, pin_enc").eq("phone_number_id", phoneNumberId).maybeSingle();
  if (existing && existing.bot_id !== botId) return fail("Este número já está ligado a outro chatbot. Desconecte lá primeiro.");

  let phone: Awaited<ReturnType<typeof getPhoneNumber>>;
  // reconectar o mesmo número usa o mesmo PIN: um PIN novo seria recusado pela verificação em duas etapas
  const pin = existing?.pin_enc ? unseal(existing.pin_enc) : newPin();
  try {
    await subscribeApp(wabaId, token);
    if (!coexistence) await registerNumber(phoneNumberId, pin, token);
    phone = await getPhoneNumber(phoneNumberId, token);
  } catch (e) {
    console.error("whatsapp: cadastro incorporado falhou", e);
    return fail(`A Meta recusou a conexão: ${e instanceof WhatsAppError ? e.message : "erro desconhecido"}. Tente de novo em instantes.`);
  }

  await admin.from("whatsapp_channels").delete().eq("bot_id", botId);
  const { error } = await admin.from("whatsapp_channels").insert({
    bot_id: botId,
    phone_number_id: phoneNumberId,
    waba_id: wabaId,
    business_id: businessId,
    display_phone: phone.display_phone_number ?? null,
    verified_name: phone.verified_name ?? null,
    access_token_enc: seal(token),
    pin_enc: coexistence ? null : seal(pin),
    coexistence,
  });
  if (error) return fail("O número foi conectado na Meta, mas não deu para salvar aqui. Tente de novo.");

  // coexistência: contatos primeiro, depois o histórico (a Meta desconecta se não pedirmos em 24 h)
  let syncWarning = "";
  if (coexistence) {
    try {
      await startAppSync(phoneNumberId, token, "smb_app_state_sync");
      await startAppSync(phoneNumberId, token, "history");
    } catch (e) {
      console.error("whatsapp: sincronização da coexistência falhou", e);
      syncWarning = " Atenção: a sincronização com o app do celular falhou; conecte de novo em até 24 h para o número não ser desconectado pela Meta.";
    }
  }
  // o cliente paga a Meta direto: o dono da agência recebe o passo a passo para repassar
  await notifyAgencyOwner(admin, agency.id, `WhatsApp conectado: falta o cartão na Meta`, [
    `O número ${phone.display_phone_number ?? phoneNumberId} foi conectado ao Boavoz${coexistence ? " (continua funcionando no app do celular)" : ""}.`,
    "",
    "Último passo, feito pelo cliente: cadastrar um cartão para a Meta.",
    `1. Entrar em ${WHATSAPP_BILLING_URL} com o Facebook usado na conexão.`,
    "2. Abrir Configurações de pagamento e adicionar um cartão de crédito.",
    "",
    "Por que: as mensagens do WhatsApp são cobradas pela Meta direto no cartão do cliente, por mensagem entregue (valores na tabela da Meta para o Brasil). Não passam pela agência nem pelo Boavoz.",
    "Sem cartão, o assistente responde enquanto houver mensagens grátis; depois a Meta recusa e ele para de responder.",
    "",
    `Painel: ${appUrl(`/painel/bots/${botId}?tab=whatsapp`)}`,
  ]).catch(() => false);
  revalidatePath(`/painel/bots/${botId}`);
  return ok(`WhatsApp ${phone.display_phone_number ?? ""} conectado.${coexistence ? " Ele continua funcionando no app do celular." : ""} Último passo: o cliente cadastra um cartão na Meta (as instruções foram para o seu e-mail).${syncWarning}`);
}

export async function disconnectWhatsApp(botId: string): Promise<ActionResult> {
  const { email } = await requireAgency();
  if (!whatsappAllowed(email)) return fail("O WhatsApp ainda não está disponível na sua conta.");
  const supabase = await createClient();
  const { data: bot } = await supabase.from("bots").select("id").eq("id", botId).maybeSingle();
  if (!bot) return fail("Chatbot não encontrado.");
  const admin = createAdminClient();
  const { data: channel } = await admin.from("whatsapp_channels").select("waba_id, access_token_enc").eq("bot_id", botId).maybeSingle();
  // o app deixa de receber os eventos da conta do cliente (o número de teste fica como está)
  if (channel?.waba_id && channel.access_token_enc) await unsubscribeApp(channel.waba_id, unseal(channel.access_token_enc));
  const { error } = await admin.from("whatsapp_channels").delete().eq("bot_id", botId);
  if (error) return fail("Não foi possível desconectar. Tente de novo.");
  revalidatePath(`/painel/bots/${botId}`);
  return ok("WhatsApp desconectado. O assistente parou de responder por ele.");
}

/* ------------------------------------------------------------------ modelos de mensagem (whatsapp) */

/** Número do WhatsApp do chatbot, conferindo e-mail liberado e dono do chatbot. */
async function ownedTemplateChannel(botId: string): Promise<TemplateChannel | { error: string }> {
  const { email } = await requireAgency();
  if (!whatsappAllowed(email)) return { error: "O WhatsApp ainda não está disponível na sua conta." };
  const supabase = await createClient();
  const { data: bot } = await supabase.from("bots").select("id").eq("id", botId).maybeSingle();
  if (!bot) return { error: "Chatbot não encontrado." };
  const ch = await loadTemplateChannel(createAdminClient(), botId);
  return ch ?? { error: "Conecte o WhatsApp (com a conta do WhatsApp Business) para usar modelos. Se ele aparece como desconectado, conecte de novo." };
}

/** "21 99999-9999" vira 5521999999999; quem já digitou o DDI fica como está. */
function whatsappNumber(raw: string): string {
  const d = raw.replace(/\D/g, "");
  return d.length === 10 || d.length === 11 ? `55${d}` : d;
}

/**
 * Manda um modelo aprovado (campos `template` e `param_N` do formulário) e devolve o texto
 * como o contato recebeu, para entrar no histórico da conversa.
 */
async function sendApprovedTemplate(botId: string, ch: TemplateChannel, to: string, formData: FormData): Promise<{ text: string } | { error: string }> {
  let templates;
  try {
    templates = await listSendable(ch);
  } catch (e) {
    return { error: `Não deu para ler os modelos: ${await metaError(botId, e)}` };
  }
  const t = templates.find((x) => x.name === text(formData.get("template")));
  if (!t) return { error: "Escolha um modelo aprovado." };
  const params = formParams(formData, t.vars);
  if (params.some((p) => !p)) return { error: "Preencha todos os campos do modelo." };
  try {
    await sendTemplate(ch, to, t, params);
  } catch (e) {
    return { error: `O WhatsApp não aceitou o envio: ${await metaError(botId, e)}` };
  }
  return { text: renderTemplate(t.body, params) };
}

/** Grava o modelo enviado como resposta da equipe e atualiza a conversa. */
async function recordTemplateMessage(admin: ReturnType<typeof createAdminClient>, conversationId: string, content: string) {
  const { error } = await admin.from("messages").insert({ conversation_id: conversationId, role: "agent", content, author: AGENCY_AUTHOR });
  if (error) await admin.from("messages").insert({ conversation_id: conversationId, role: "agent", content });
  const { count } = await admin.from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", conversationId);
  await admin.from("conversations").update({ last_message_at: new Date().toISOString(), message_count: count ?? 0 }).eq("id", conversationId);
}

/**
 * Texto do erro da Meta para o aviso. Se o erro diz que o acesso ao número acabou (o cliente
 * removeu o app), já marca o número como desconectado e avisa a agência.
 */
async function metaError(botId: string, e: unknown): Promise<string> {
  if (isAccessError(e)) {
    await markDisconnected(createAdminClient(), { column: "bot_id", value: botId }, TOKEN_REJECTED);
    revalidatePath(`/painel/bots/${botId}`);
    return "o cliente removeu o acesso do Boavoz a este WhatsApp. Conecte de novo na aba WhatsApp";
  }
  if (isPaymentError(e)) {
    await markPaymentIssue(createAdminClient(), { column: "bot_id", value: botId });
    revalidatePath(`/painel/bots/${botId}`);
    return "a Meta recusou por falta de forma de pagamento. O cliente precisa cadastrar o cartão no Gerenciador do WhatsApp";
  }
  return e instanceof WhatsAppError ? e.message : "erro desconhecido";
}

export async function createWhatsAppTemplate(botId: string, formData: FormData): Promise<ActionResult> {
  const ch = await ownedTemplateChannel(botId);
  if ("error" in ch) return fail(ch.error);
  const name = templateName(text(formData.get("name")));
  const body = String(formData.get("body") ?? "").trim();
  const examples = lines(String(formData.get("examples") ?? ""));
  const category = formData.get("category") === "MARKETING" ? "MARKETING" : "UTILITY";
  const invalid = validateTemplate({ name, body, examples });
  if (invalid) return fail(invalid);
  try {
    await createTemplate(ch, { name, category, body, examples });
  } catch (e) {
    return fail(`A Meta recusou o modelo: ${await metaError(botId, e)}`);
  }
  revalidatePath(`/painel/bots/${botId}`);
  return ok("Modelo enviado para análise da Meta. Costuma sair em minutos; recarregue para ver o status.");
}

export async function deleteWhatsAppTemplate(botId: string, name: string): Promise<ActionResult> {
  const ch = await ownedTemplateChannel(botId);
  if ("error" in ch) return fail(ch.error);
  try {
    await deleteTemplate(ch, name);
  } catch (e) {
    return fail(`Não foi possível excluir: ${await metaError(botId, e)}`);
  }
  revalidatePath(`/painel/bots/${botId}`);
  return ok("Modelo excluído.");
}

/** Modelo dentro de uma conversa do WhatsApp (o jeito de retomar depois das 24 h). */
export async function sendConversationTemplate(conversationId: string, formData: FormData): Promise<ActionResult> {
  const owned = await ownedConversation(conversationId);
  if (!owned) return fail("Conversa não encontrada.");
  const ch = await ownedTemplateChannel(owned.conv.bot_id);
  if ("error" in ch) return fail(ch.error);
  const { data: conv } = await owned.admin.from("conversations").select("channel, wa_id").eq("id", conversationId).single();
  if (conv?.channel !== "whatsapp" || !conv.wa_id) return fail("Esta conversa não é do WhatsApp.");
  const sent = await sendApprovedTemplate(owned.conv.bot_id, ch, conv.wa_id, formData);
  if ("error" in sent) return fail(sent.error);
  await recordTemplateMessage(owned.admin, conversationId, sent.text);
  revalidatePath(`/painel/bots/${owned.conv.bot_id}/conversas/${conversationId}`);
  return ok("Modelo enviado. Quando o contato responder, a conversa continua aqui.");
}

/**
 * "+ Nova conversa": começa a falar com um número pelo WhatsApp com um modelo aprovado.
 * Se já existe conversa recente com ele, o modelo entra nela em vez de abrir outra.
 */
export async function startWhatsAppConversation(botId: string, formData: FormData): Promise<ActionResult> {
  const ch = await ownedTemplateChannel(botId);
  if ("error" in ch) return fail(ch.error);
  const to = whatsappNumber(text(formData.get("to")));
  if (to.length < 12) return fail("Informe o WhatsApp com DDD, ex.: 21 99999-9999.");
  const sent = await sendApprovedTemplate(botId, ch, to, formData);
  if ("error" in sent) return fail(sent.error);

  const admin = createAdminClient();
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const { data: recent } = await admin.from("conversations").select("id").eq("bot_id", botId).in("wa_id", waIdVariants(to)).gt("last_message_at", since).order("last_message_at", { ascending: false }).limit(1).maybeSingle();
  let conversationId = recent?.id as string | undefined;
  if (!conversationId) {
    const { data: created, error } = await admin.from("conversations").insert({ bot_id: botId, channel: "whatsapp", wa_id: to, visitor_id: null }).select("id").single();
    if (error || !created) return fail("A mensagem foi enviada, mas não deu para abrir a conversa aqui. Ela aparece quando o contato responder.");
    conversationId = created.id as string;
  }
  await recordTemplateMessage(admin, conversationId, sent.text);
  revalidatePath(`/painel/bots/${botId}`);
  redirect(`/painel/bots/${botId}/conversas/${conversationId}`);
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
  const patch = { allow_handoff: formData.get("allow_handoff") === "on", allow_knowledge: formData.get("allow_knowledge") === "on", handoff_notify: formData.get("handoff_notify") === "client" ? "client" : "all" };
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

/* ------------------------------------------------------------------ LGPD */

/** Apaga uma conversa inteira (mensagens e contatos capturados nela). */
export async function deleteConversation(conversationId: string): Promise<ActionResult> {
  const owned = await ownedConversation(conversationId);
  if (!owned) return fail("Conversa não encontrada.");
  await owned.admin.from("leads").delete().eq("conversation_id", conversationId);
  const { error } = await owned.admin.from("conversations").delete().eq("id", conversationId);
  if (error) return fail("Não foi possível excluir. Tente de novo.");
  revalidatePath("/painel", "layout");
  redirect(`/painel/bots/${owned.conv.bot_id}?tab=conversas`);
}

const digitsOf = (v: string) => v.replace(/\D/g, "");

/**
 * Pedido de titular (LGPD): apaga todos os contatos com esse e-mail ou telefone nos chatbots
 * do cliente, e as conversas em que foram capturados.
 */
export async function eraseContactData(clientId: string, formData: FormData): Promise<ActionResult> {
  const contact = text(formData.get("contact")).toLowerCase();
  const digits = digitsOf(contact);
  const byEmail = isEmail(contact);
  if (!byEmail && digits.length < 8) return fail("Informe um e-mail ou um telefone com DDD.");
  const supabase = await createClient();
  const { data: bots } = await supabase.from("bots").select("id").eq("client_id", clientId);
  const ids = (bots ?? []).map((b) => b.id);
  if (!ids.length) return ok("Nenhum dado encontrado para esse contato.");

  const { data: leads } = byEmail
    ? await supabase.from("leads").select("id, conversation_id").in("bot_id", ids).ilike("email", contact)
    : await supabase.from("leads").select("id, conversation_id, phone").in("bot_id", ids).not("phone", "is", null);
  // telefone: compara só os números, pelo final (com ou sem +55 e DDD formatado)
  const tail = digits.slice(-10);
  const matches = (leads ?? []).filter((l) => byEmail || digitsOf(String((l as { phone?: string }).phone ?? "")).endsWith(tail));
  if (!matches.length) return ok("Nenhum dado encontrado para esse contato.");

  const admin = createAdminClient();
  const convIds = [...new Set(matches.map((l) => l.conversation_id).filter((c): c is string => Boolean(c)))];
  await admin.from("leads").delete().in("id", matches.map((l) => l.id));
  if (convIds.length) await admin.from("conversations").delete().in("id", convIds).in("bot_id", ids);
  revalidatePath(`/painel/clientes/${clientId}`);
  return ok(`Apagados ${matches.length} contato${matches.length === 1 ? "" : "s"} e ${convIds.length} conversa${convIds.length === 1 ? "" : "s"}.`);
}

/** Política de privacidade (link no chat) e prazo de guarda dos dados dos visitantes. */
export async function updatePrivacy(formData: FormData): Promise<ActionResult> {
  const { agency } = await requireAgency();
  const url = text(formData.get("privacy_url"));
  if (url && !/^https?:\/\/[^\s]+\.[^\s]+$/i.test(url)) return fail("Use o endereço completo da política, começando com https://");
  if (url.length > 400) return fail("Endereço longo demais.");
  const months = Number(formData.get("retention_months"));
  const retention = [6, 12, 24].includes(months) ? months : null;
  const supabase = await createClient();
  const { error } = await supabase.from("agencies").update({ privacy_url: url || null, retention_months: retention }).eq("id", agency.id);
  if (error) return fail("Não foi possível salvar. Tente de novo.");
  revalidatePath("/painel", "layout");
  return ok(retention ? `Salvo. Conversas e contatos com mais de ${retention} meses serão apagados automaticamente.` : "Salvo.");
}

/** Esconde o card "Primeiros passos" neste navegador (um ano). */
export async function hideOnboarding(): Promise<ActionResult> {
  (await cookies()).set(ONBOARDING_COOKIE, "hidden", { path: "/painel", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true });
  revalidatePath("/painel/clientes");
  return ok("Primeiros passos ocultados.");
}
