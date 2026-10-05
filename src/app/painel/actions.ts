"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAgency, type AgencyContext } from "@/lib/agency";
import { attendantOf, can, type Permission } from "@/lib/team";
import { ALREADY_YOURS, postAgentMessage, release, takeOver } from "@/lib/handoff";
import { attendantAuthor, type Attendant } from "@/lib/authors";
import { answerQuestion } from "@/lib/knowledge";
import { sendMemberLink } from "@/lib/member";
import { appUrl, initials, normalizeUrl, slugify } from "@/lib/utils";
import { emitErasedContacts, eraseTargets, executeRequest, recordPanelRequest } from "@/lib/data-subject";
import { grantSupport, revokeSupport } from "@/lib/support-access";
import { hasMfa } from "@/lib/agency-mfa";
import { purgeAttachments } from "@/lib/attachments";
import { removeBotSourceFiles } from "@/lib/source-files";
import { logAccess } from "@/lib/access-log";
import { DEFAULT_AI_NOTICE, DEFAULT_AWAY_MESSAGE, DEFAULT_BACK_NOTICE, DEFAULT_ENTRY_NOTICE, WEEKDAYS, aiNoticeProblem, awayMessageProblem, backNoticeProblem, entryNoticeProblem, type BusinessHours, type HumanHandoff } from "@/lib/handoff-hours";
import { isChatLink, type RegulatedChannel } from "@/lib/gate/sales-channel";
import { resetAge } from "@/lib/gate/age";
import { clearAgePending } from "@/lib/gate/flow";
import { isGateCategory } from "@/lib/gate/exceptions";
import { CATEGORIES } from "@/lib/gate/rules";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { assistantName, clientFields, isEmail, text } from "@/lib/validation";
import { addDomainToProject, agencyBaseUrl, checkDomain, parseDomain, removeDomainFromProject } from "@/lib/domain";
import { ONBOARDING_COOKIE } from "@/lib/onboarding";
import { WhatsAppError, waIdVariants, getPhoneNumber, hasPaymentMethod, subscribeApp, whatsappConfigured } from "@/lib/whatsapp";
import { channelBlock, trialContentProblem } from "@/lib/features";
import { connectFromSignup, type SignupResult } from "@/lib/whatsapp-signup";
import { createConnectLink } from "@/lib/whatsapp-connect-link";
import { disconnectInstagramChannel, disconnectWhatsAppChannel } from "@/lib/channel-disconnect";
import { TOKEN_REJECTED, isAccessError, isPaymentError, markDisconnected, markPaymentIssue } from "@/lib/whatsapp-access";
import { activeSuppressions, blocks, suppressionScope } from "@/lib/suppression";
import { sendBlockedReason } from "@/lib/conversation-mode";
import { confirmAcceptance, connectBlockFor, dayLabel, getCompliance, parseAnswers, recordAcceptance, type AcceptanceChannel } from "@/lib/acceptance";
import { notifyAgencyOwner, notifyClientPeople, notifyPlatform } from "@/lib/notify";
import { dateBR, isRetentionMonths, planAgencyRetention, retentionLabel, retentionReduced } from "@/lib/retention";
import { audit, requestMeta } from "@/lib/audit";
import { channelMsgHash } from "@/lib/hash";
import { findContactIds, typedPhoneHash, whatsappContact } from "@/lib/contacts";
import { deleteLeads, findLeadsByContact, leadIdsOfConversations } from "@/lib/leads";
import { markUnansweredResolved } from "@/lib/unanswered";
import { logDeletion } from "@/lib/deletions";
import { saveMessage } from "@/lib/messages";
import { analyzeBot, markAnalysisDue } from "@/lib/bot-analysis";
import { firstExceeded } from "@/lib/rate-limit";
import { createTemplate, deleteTemplate, formParams, templateName, lines, listSendable, loadTemplateChannel, renderTemplate, sendTemplate, validateTemplate, type TemplateChannel } from "@/lib/whatsapp-templates";
import { currentPeriodBR, getClientReport, newPortalToken, periodLabel, reportLink, sendReportEmail, shiftPeriod } from "@/lib/report";

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
/** Auditoria das ações do painel: quem fez é a pessoa logada da equipe. */
async function auditPanel(action: string, target: { type: string; id: string }, change: { before?: Record<string, unknown>; after?: Record<string, unknown> } = {}) {
  const { agency, userId } = await requireAgency();
  await audit(createAdminClient(), { agencyId: agency.id, actorType: "user", actorId: userId, action, targetType: target.type, targetId: target.id, ...change, ...(await requestMeta()) });
}

/** Cliente novo fica fora do escopo de quem vê só alguns clientes: só cria quem vê todos. */
const NEW_CLIENT_SCOPE = "Criar cliente é para quem vê todos os clientes da agência. Peça para um administrador.";

const DENIED = "O seu papel na equipe não permite esta ação. Fale com o dono ou com um administrador da agência.";

/**
 * Papel de quem está logado (equipe, leva B1'). O escopo de clientes e chatbots vem da RLS nas
 * leituras pela sessão; aqui fica o que cada papel pode gravar, inclusive com a service role.
 */
async function allowed(perm: Permission): Promise<AgencyContext | null> {
  const ctx = await requireAgency();
  return can(ctx.role, perm) ? ctx : null;
}

async function resolveClient(supabase: Db, agencyId: string, fd: FormData): Promise<{ id: string; name: string; site: string | null } | { error: string }> {
  const clientId = text(fd.get("client_id"));
  if (clientId && clientId !== "new") {
    const { data } = await supabase.from("clients").select("id, name, site").eq("id", clientId).maybeSingle();
    if (!data) return { error: "Cliente não encontrado. Recarregue a página e tente de novo." };
    return data;
  }
  if ((await requireAgency()).member.scope !== "all") return { error: NEW_CLIENT_SCOPE };
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
  if (!(await allowed("config"))) return fail(DENIED);
  const { agency, member } = await requireAgency();
  if (member.scope !== "all") return fail(NEW_CLIENT_SCOPE);
  const supabase = await createClient();
  const f = clientFields(formData);
  if ("error" in f) return fail(f.error);
  const { data, error } = await supabase.from("clients").insert({ agency_id: agency.id, ...f }).select("id").single();
  if (error || !data) return fail("Não foi possível criar o cliente. Tente de novo.");
  revalidatePath("/painel", "layout");
  redirect(`/painel/clientes/${data.id}`);
}

export async function updateClientRecord(clientId: string, formData: FormData): Promise<ActionResult> {
  if (!(await allowed("config"))) return fail(DENIED);
  const supabase = await createClient();
  const f = clientFields(formData);
  if ("error" in f) return fail(f.error);
  const { error, count } = await supabase.from("clients").update(f, { count: "exact" }).eq("id", clientId);
  if (error) return fail("Não foi possível salvar. Tente de novo.");
  if (!count) return fail("Cliente não encontrado.");
  revalidatePath("/painel", "layout");
  return ok("Cliente atualizado.");
}

/**
 * Sublimite de atendimentos do cliente no mês (Cobrança → Uso e custo); vazio = sem sublimite.
 * Passando dele, só os chatbots deste cliente entram no modo só humano.
 */
export async function setClientQuotaCap(clientId: string, formData: FormData): Promise<ActionResult> {
  if (!(await allowed("billing"))) return fail(DENIED);
  const raw = text(formData.get("cap")).replace(/\D/g, "");
  const cap = raw ? Number(raw) : null;
  if (cap !== null && (!Number.isSafeInteger(cap) || cap > 10_000_000)) return fail("Limite inválido. Use um número inteiro de atendimentos por mês.");
  const supabase = await createClient();
  const { data: before } = await supabase.from("clients").select("monthly_quota_cap").eq("id", clientId).maybeSingle();
  if (!before) return fail("Cliente não encontrado.");
  const { error } = await supabase.from("clients").update({ monthly_quota_cap: cap }).eq("id", clientId);
  if (error) return fail("Não foi possível salvar. Tente de novo.");
  await auditPanel("cliente.sublimite", { type: "client", id: clientId }, { before: { monthly_quota_cap: before.monthly_quota_cap }, after: { monthly_quota_cap: cap } });
  revalidatePath("/painel/cobranca/uso");
  return ok(cap === null ? "Sem limite para este cliente: ele usa a cota da agência." : `Limite salvo: ${cap.toLocaleString("pt-BR")} atendimentos por mês.`);
}

/** Só apaga cliente sem chatbots, para ninguém perder base de conhecimento sem querer. */
export async function deleteClientRecord(clientId: string): Promise<ActionResult> {
  if (!(await allowed("config"))) return fail(DENIED);
  const supabase = await createClient();
  const { count: bots } = await supabase.from("bots").select("id", { count: "exact", head: true }).eq("client_id", clientId);
  if (bots) return fail(`Este cliente tem ${bots} chatbot${bots > 1 ? "s" : ""}. Exclua ${bots > 1 ? "os chatbots" : "o chatbot"} antes.`);
  const { data: own } = await supabase.from("clients").select("id").eq("id", clientId).maybeSingle();
  if (!own) return fail("Cliente não encontrado.");
  // registro de exclusões antes de apagar: um backup restaurado não traz o cliente de volta
  await logDeletion(createAdminClient(), "clients", [clientId]);
  const { error, count } = await supabase.from("clients").delete({ count: "exact" }).eq("id", clientId);
  if (error) return fail("Não foi possível excluir. Tente de novo.");
  if (!count) return fail("Cliente não encontrado.");
  await auditPanel("cliente.excluir", { type: "client", id: clientId });
  revalidatePath("/painel", "layout");
  redirect("/painel/clientes");
}

/* ------------------------------------------------------------------ chatbots */

/** Cria um chatbot (não demo) para um cliente e vai para o editor. */
export async function createBot(formData: FormData): Promise<ActionResult> {
  if (!(await allowed("config"))) return fail(DENIED);
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
      // bots novos já vêm com o botão "Falar com uma pessoa" no chat do site
      human_handoff: { widget_button: true },
    })
    .select("id")
    .single();
  if (error || !bot) return fail("Não foi possível criar o chatbot. Tente de novo.");
  revalidatePath("/painel", "layout");
  redirect(`/painel/bots/${bot.id}`);
}

/** Salva personalidade, aparência, captura de leads e cliente do bot. */
/**
 * Caminho para humano (aba Atendimento humano): outros contatos e horário, todos opcionais.
 * O pedido de atendente no chat fica sempre ligado; isto só complementa.
 */
async function parseHumanHandoff(supabase: Awaited<ReturnType<typeof createClient>>, botId: string, f: Record<string, string>): Promise<{ value: HumanHandoff } | { error: string }> {
  const email = f.handoff_email?.trim() || null;
  if (email && !isEmail(email)) return { error: "E-mail de atendimento inválido." };
  const url = (raw: string | undefined, label: string): string | null | { error: string } => {
    const v = raw?.trim();
    if (!v) return null;
    const u = normalizeUrl(v);
    return u ?? { error: `${label} inválido. Ex.: clinicasorriso.com.br/contato` };
  };
  const site = url(f.handoff_site, "Site");
  if (site && typeof site === "object") return site;
  const form = url(f.handoff_form_url, "Link do formulário");
  if (form && typeof form === "object") return form;
  const phone = f.handoff_phone?.trim() || null;
  if (phone) {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) return { error: "Telefone de atendimento inválido. Use DDD, ex.: (21) 3333-4444." };
    // fora da coexistência, o telefone precisa ser outro: o número do bot é atendido pelo próprio bot
    const { data: wa } = await createAdminClient().from("whatsapp_channels").select("display_phone, coexistence").eq("bot_id", botId).maybeSingle();
    const botDigits = (wa?.display_phone ?? "").replace(/\D/g, "");
    if (botDigits && !wa?.coexistence && (botDigits.endsWith(digits) || digits.endsWith(botDigits))) {
      return { error: "Esse é o número do WhatsApp do próprio assistente. Informe outro telefone da equipe (ou deixe em branco)." };
    }
  }
  const hours: BusinessHours = {};
  for (let d = 0; d < 7; d++) {
    const open = f[`hours_open_${d}`]?.trim();
    const close = f[`hours_close_${d}`]?.trim();
    if (!open && !close) continue;
    if (!/^\d{2}:\d{2}$/.test(open ?? "") || !/^\d{2}:\d{2}$/.test(close ?? "") || open! >= close!) {
      return { error: `Horário de ${WEEKDAYS[d]} inválido: a abertura precisa vir antes do fechamento.` };
    }
    hours[String(d) as keyof BusinessHours] = [open!, close!];
  }
  const address = f.handoff_address?.trim().slice(0, 200) || null;
  // textos editáveis: vazio ou igual ao padrão fica nulo (o padrão pode melhorar depois)
  const aiNotice = f.ai_notice?.trim() ?? "";
  const aiProblem = aiNoticeProblem(aiNotice);
  if (aiProblem) return { error: aiProblem };
  const away = f.away_message?.trim() ?? "";
  const awayProblem = awayMessageProblem(away, Object.keys(hours).length > 0);
  if (awayProblem) return { error: awayProblem };
  // anúncios do atendimento (B1'): o de entrada tem o nome de quem assumiu; o de volta diz "assistente virtual"
  const entry = f.entry_notice?.trim() ?? "";
  const entryProblem = entryNoticeProblem(entry);
  if (entryProblem) return { error: entryProblem };
  const back = f.back_notice?.trim() ?? "";
  const backProblem = backNoticeProblem(back);
  if (backProblem) return { error: backProblem };
  return {
    value: {
      email,
      phone,
      site: site as string | null,
      form_url: form as string | null,
      address,
      hours: Object.keys(hours).length ? hours : null,
      ai_notice: aiNotice && aiNotice !== DEFAULT_AI_NOTICE ? aiNotice : null,
      away_message: away && away !== DEFAULT_AWAY_MESSAGE ? away : null,
      entry_notice: entry && entry !== DEFAULT_ENTRY_NOTICE ? entry : null,
      back_notice: back && back !== DEFAULT_BACK_NOTICE ? back : null,
      widget_button: f.widget_button === "on",
    },
  };
}

/**
 * Onde o contato finaliza a compra de bebida alcoólica ou remédio (aba Atendimento humano): no
 * WhatsApp e no Instagram a venda desses itens nunca fecha no chat. Link de WhatsApp ou de DM não
 * serve (a venda voltaria para o chat). Tudo vazio: o assistente usa o que estiver na base.
 */
function parseRegulatedChannel(f: Record<string, string>): { value: RegulatedChannel | null } | { error: string } {
  const link = (raw: string | undefined, label: string): string | null | { error: string } => {
    const v = raw?.trim();
    if (!v) return null;
    const u = normalizeUrl(v);
    if (!u) return { error: `${label} inválido. Ex.: bardoze.com.br/cardapio` };
    if (isChatLink(u)) return { error: `${label}: link de WhatsApp ou de mensagem direta não serve. A compra desses itens precisa terminar fora do chat (site, app de delivery, telefone ou retirada).` };
    return u;
  };
  const site = link(f.regulated_site, "Link do site");
  if (site && typeof site === "object") return site;
  const app = link(f.regulated_app, "Link do app de delivery");
  if (app && typeof app === "object") return app;
  const phone = f.regulated_phone?.trim().slice(0, 30) || null;
  if (phone && phone.replace(/\D/g, "").length < 10) return { error: "Telefone para pedidos inválido. Use DDD, ex.: (21) 3333-4444." };
  const pickup = f.regulated_pickup === "on";
  if (pickup && !f.handoff_address?.trim()) return { error: "Para retirada no local, preencha o endereço em Atendimento presencial." };
  if (!site && !app && !phone && !pickup) return { value: null };
  return { value: { site: site as string | null, app: app as string | null, phone, pickup } };
}

export async function updateBot(botId: string, formData: FormData): Promise<ActionResult> {
  if (!(await allowed("config"))) return fail(DENIED);
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
  if ("business_topics" in f) {
    if (f.business_topics.length > 1000) return fail("Os assuntos do negócio podem ter no máximo 1.000 caracteres.");
    patch.business_topics = f.business_topics.trim() || null;
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
  if ("handoff" in f) {
    const handoff = await parseHumanHandoff(supabase, botId, f);
    if ("error" in handoff) return fail(handoff.error);
    patch.human_handoff = handoff.value;
    const regulated = parseRegulatedChannel(f);
    if ("error" in regulated) return fail(regulated.error);
    patch.regulated_channel = regulated.value;
  }
  if (!Object.keys(patch).length) return fail("Nada para salvar.");

  const { error, count } = await supabase.from("bots").update(patch, { count: "exact" }).eq("id", botId);
  if (error) return fail("Não foi possível salvar. Tente de novo.");
  if (!count) return fail("Chatbot não encontrado.");
  // mudar as instruções ou os "Assuntos do negócio" dispara de novo a análise do bot (agrupada, ~10 min)
  if ("persona" in patch || "business_topics" in patch) await markAnalysisDue(createAdminClient(), botId);
  revalidatePath("/painel", "layout");
  return ok("Alterações salvas.");
}

export async function setBotStatus(botId: string, status: "live" | "draft"): Promise<ActionResult> {
  if (!(await allowed("config"))) return fail(DENIED);
  const supabase = await createClient();
  if (status === "live") {
    const { count } = await supabase.from("sources").select("id", { count: "exact", head: true }).eq("bot_id", botId).eq("status", "ready");
    if (!count) return fail("Adicione pelo menos uma fonte pronta antes de publicar.");
  }
  const { error } = await supabase.from("bots").update({ status }).eq("id", botId);
  if (error) return fail("Não foi possível mudar o status. Tente de novo.");
  await auditPanel(status === "live" ? "bot.publicar" : "bot.tirar_do_ar", { type: "bot", id: botId });
  revalidatePath("/painel", "layout");
  return ok(status === "live" ? "Chatbot publicado. Ele já responde no site." : "Chatbot fora do ar. O balão some do site do cliente em até um minuto.");
}

/**
 * Botão de emergência: a IA deste chatbot para em todos os canais (regra de estado, degrau 4).
 * As mensagens do WhatsApp e do Instagram ficam no painel como pedido de atendente; no site,
 * aparece o formulário de contato. Com "avisar", o contato recebe o texto fixo uma vez por conversa.
 */
export async function pauseBot(botId: string, formData: FormData): Promise<ActionResult> {
  if (!(await allowed("config"))) return fail(DENIED);
  const { email } = await requireAgency();
  const supabase = await createClient();
  const reason = text(formData.get("reason")).slice(0, 200) || null;
  const { data, error } = await supabase
    .from("bots")
    .update({ paused_at: new Date().toISOString(), paused_by: `painel (${email})`, pause_reason: reason, pause_notify: formData.get("notify") === "on" })
    .eq("id", botId)
    .is("paused_at", null)
    .select("id");
  if (error) return fail("Não foi possível pausar. Tente de novo.");
  if (!data?.length) return fail("Este chatbot já está pausado.");
  await auditPanel("bot.pausar", { type: "bot", id: botId }, { after: { reason, notify: formData.get("notify") === "on" } });
  revalidatePath(`/painel/bots/${botId}`);
  return ok("IA pausada. As próximas mensagens ficam para a sua equipe responder.");
}

export async function resumeBot(botId: string): Promise<ActionResult> {
  if (!(await allowed("config"))) return fail(DENIED);
  const supabase = await createClient();
  const { error } = await supabase.from("bots").update({ paused_at: null, paused_by: null, pause_reason: null, pause_notify: false }).eq("id", botId);
  if (error) return fail("Não foi possível retomar. Tente de novo.");
  await auditPanel("bot.retomar", { type: "bot", id: botId });
  revalidatePath(`/painel/bots/${botId}`);
  return ok("IA retomada. O assistente volta a responder a partir da próxima mensagem.");
}

/** Converte uma demo em chatbot de verdade (mantém a base de conhecimento), ligado a um cliente. */
export async function convertDemo(botId: string, formData: FormData): Promise<ActionResult> {
  if (!(await allowed("config"))) return fail(DENIED);
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
  if (!(await allowed("config"))) return fail(DENIED);
  const supabase = await createClient();
  const { data: own } = await supabase.from("bots").select("id").eq("id", botId).maybeSingle();
  if (!own) return fail("Chatbot não encontrado.");
  // o bot leva junto conversas, mensagens e conexões (cascata); reaplicar apaga o bot de novo
  await logDeletion(createAdminClient(), "bots", [botId]);
  // arquivos no Storage (o Supabase não apaga objeto por SQL): os recebidos e os PDFs das fontes
  await purgeAttachments(createAdminClient(), { botId });
  await removeBotSourceFiles(createAdminClient(), botId);
  const { error, count } = await supabase.from("bots").delete({ count: "exact" }).eq("id", botId);
  if (error) return fail("Não foi possível excluir. Tente de novo.");
  if (!count) return fail("Chatbot não encontrado.");
  await auditPanel("bot.excluir", { type: "bot", id: botId });
  revalidatePath("/painel", "layout");
  if (redirectTo) redirect(redirectTo);
  return ok("Chatbot excluído.");
}

export async function resolveUnanswered(id: string, botId: string): Promise<ActionResult> {
  if (!(await allowed("config"))) return fail(DENIED);
  const supabase = await createClient();
  if (!(await markUnansweredResolved(supabase, id, "agência"))) return fail("Não foi possível marcar como resolvida.");
  revalidatePath(`/painel/bots/${botId}`);
  return ok("Marcada como resolvida.");
}

export async function deleteLead(id: string): Promise<ActionResult> {
  if (!(await allowed("config"))) return fail(DENIED);
  const supabase = await createClient();
  const count = await deleteLeads(supabase, [id]);
  if (count === null) return fail("Não foi possível excluir o lead.");
  if (!count) return fail("Lead não encontrado.");
  revalidatePath("/painel", "layout");
  return ok("Lead excluído.");
}

/** Marca da agência (white-label). */
export async function updateAgency(formData: FormData): Promise<ActionResult> {
  if (!(await allowed("brand"))) return fail(DENIED);
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
  if (!(await allowed("config"))) return fail(DENIED);
  const supabase = await createClient();
  const { error, count } = await supabase.from("clients").update({ portal_token: newPortalToken() }, { count: "exact" }).eq("id", clientId);
  if (error || !count) return fail("Não foi possível gerar o link. Tente de novo.");
  await auditPanel("portal.link_ligar", { type: "client", id: clientId });
  revalidatePath(`/painel/clientes/${clientId}`);
  return ok("Link do cliente pronto.");
}

export async function disablePortal(clientId: string): Promise<ActionResult> {
  if (!(await allowed("config"))) return fail(DENIED);
  const supabase = await createClient();
  const { error } = await supabase.from("clients").update({ portal_token: null }).eq("id", clientId);
  if (error) return fail("Não foi possível desligar o link. Tente de novo.");
  await auditPanel("portal.link_desligar", { type: "client", id: clientId });
  revalidatePath(`/painel/clientes/${clientId}`);
  return ok("Link desligado. Quem tinha o endereço não consegue mais abrir.");
}

export async function saveReportEmail(clientId: string, formData: FormData): Promise<ActionResult> {
  if (!(await allowed("config"))) return fail(DENIED);
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
  if (!(await allowed("config"))) return fail(DENIED);
  const supabase = await createClient();
  const { data: client } = await supabase.from("clients").select("id, report_email, portal_token").eq("id", clientId).maybeSingle();
  if (!client) return fail("Cliente não encontrado.");
  if (!client.report_email) return fail("Informe o e-mail do cliente antes de enviar.");
  if (!process.env.RESEND_API_KEY) return fail("O envio de e-mail não está configurado neste servidor (RESEND_API_KEY).");
  const p = period ?? shiftPeriod(currentPeriodBR(), -1);
  const report = await getClientReport(supabase, clientId, p);
  if (!report) return fail("Não foi possível montar o relatório.");
  try {
    await sendReportEmail(report, client.report_email, reportLink(clientId, client.portal_token, agencyBaseUrl(report.agency), p));
  } catch (e) {
    return fail(`O e-mail não foi enviado: ${(e as Error).message}`);
  }
  // o envio automático do dia 1º não repete um mês já mandado à mão
  if (p === shiftPeriod(currentPeriodBR(), -1)) await supabase.from("clients").update({ report_last_period: p }).eq("id", clientId);
  revalidatePath(`/painel/clientes/${clientId}`);
  return ok(`Relatório de ${periodLabel(p)} enviado para ${client.report_email}.`);
}

/* ------------------------------------------------------------------ atendimento humano */

/** Como as mensagens da agência ficam assinadas no texto antigo (author): o nome vem de quem logou. */
const AGENCY_AUTHOR = "agência";

/** Quem está logado, como atendente (nome de exibição de Meu perfil, ou o primeiro nome). */
async function me(): Promise<Attendant> {
  return attendantOf((await requireAgency()).member);
}

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
  if (!(await allowed("attend"))) return fail(DENIED);
  const owned = await ownedConversation(conversationId);
  if (!owned) return fail("Conversa não encontrada.");
  const r = await takeOver(owned.admin, conversationId, await me());
  // só quem vence grava na auditoria (quem perde vê quem já está atendendo)
  if (r.ok && r.message !== ALREADY_YOURS) await auditPanel("conversa.assumir", { type: "conversation", id: conversationId });
  revalidatePath(`/painel/bots/${owned.conv.bot_id}/conversas/${conversationId}`);
  return r;
}

/** "Assumir no lugar": troca quem estava atendendo (com confirmação na tela e auditoria). */
export async function forceTakeOverConversation(conversationId: string): Promise<ActionResult> {
  if (!(await allowed("attend"))) return fail(DENIED);
  const owned = await ownedConversation(conversationId);
  if (!owned) return fail("Conversa não encontrada.");
  const r = await takeOver(owned.admin, conversationId, await me(), { force: true });
  if (r.ok && r.message !== ALREADY_YOURS) await auditPanel("conversa.assumir_no_lugar", { type: "conversation", id: conversationId }, { before: { atendente: r.previous ?? null } });
  revalidatePath(`/painel/bots/${owned.conv.bot_id}/conversas/${conversationId}`);
  return r;
}

export async function sendAgentMessage(conversationId: string, formData: FormData): Promise<ActionResult> {
  if (!(await allowed("attend"))) return fail(DENIED);
  const owned = await ownedConversation(conversationId);
  if (!owned) return fail("Conversa não encontrada.");
  const r = await postAgentMessage(owned.admin, conversationId, text(formData.get("content")), await me());
  revalidatePath(`/painel/bots/${owned.conv.bot_id}/conversas/${conversationId}`);
  return r;
}

/** Zera a resposta de 18+ do contato neste bot: na próxima vez que pedir o item, ele é perguntado de novo. */
export async function resetConversationAge(conversationId: string): Promise<ActionResult> {
  if (!(await allowed("attend"))) return fail(DENIED);
  const owned = await ownedConversation(conversationId);
  if (!owned) return fail("Conversa não encontrada.");
  const { data: conv } = await owned.admin.from("conversations").select("channel, wa_id, ig_id").eq("id", conversationId).maybeSingle();
  const contact = conv?.channel === "whatsapp" ? conv.wa_id : conv?.channel === "instagram" ? conv.ig_id : null;
  if (!conv || !contact) return fail("Só conversas do WhatsApp e do Instagram têm confirmação de 18+.");
  await resetAge(owned.admin, { botId: owned.conv.bot_id, channel: conv.channel, contact });
  await clearAgePending(owned.admin, conversationId);
  await auditPanel("idade.zerar", { type: "conversation", id: conversationId }, { after: { channel: conv.channel } });
  revalidatePath(`/painel/bots/${owned.conv.bot_id}/conversas/${conversationId}`);
  return ok("Confirmação de 18+ zerada. Se o contato pedir bebida ou remédio, ele é perguntado de novo.");
}

/** Devolve a conversa ao assistente (ele volta a responder, sabendo o que você escreveu). */
export async function releaseConversation(conversationId: string): Promise<ActionResult> {
  if (!(await allowed("attend"))) return fail(DENIED);
  const owned = await ownedConversation(conversationId);
  if (!owned) return fail("Conversa não encontrada.");
  const r = await release(owned.admin, conversationId, await me());
  if (r.ok) await auditPanel("conversa.devolver", { type: "conversation", id: conversationId });
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
  if (!(await allowed("config"))) return fail(DENIED);
  const supabase = await createClient();
  const { data: bot } = await supabase.from("bots").select("id").eq("id", botId).maybeSingle();
  if (!bot) return fail("Chatbot não encontrado.");
  const r = await answerQuestion(createAdminClient(), { botId, unansweredId, question: text(formData.get("question")), answer: text(formData.get("answer")), author: AGENCY_AUTHOR });
  revalidatePath(`/painel/bots/${botId}`);
  return r;
}

export async function setAutoRefresh(botId: string, formData: FormData): Promise<ActionResult> {
  if (!(await allowed("config"))) return fail(DENIED);
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
  if (!(await allowed("config"))) return fail(DENIED);
  const { agency } = await requireAgency();
  // liberação da agência (backoffice) e, no teste grátis, o conteúdo mínimo do chatbot
  const locked = await channelBlock(createAdminClient(), agency.id, "whatsapp", botId);
  if (locked) return fail(locked);
  const supabase = await createClient();
  const { data: bot } = await supabase.from("bots").select("id, is_demo, client_id").eq("id", botId).maybeSingle();
  if (!bot) return fail("Chatbot não encontrado.");
  if (bot.is_demo) return fail("Converta a demo em chatbot antes de ligar o WhatsApp.");
  if (!whatsappConfigured()) return fail("O WhatsApp ainda não está configurado no servidor (WHATSAPP_TOKEN).");
  // tela única de aceite: o negócio aceita antes de conectar (e não pode estar bloqueado ou aguardando revisão)
  const blocked = await connectBlockFor(createAdminClient(), { clientId: bot.client_id as string | null, channel: "whatsapp" });
  if (blocked) return fail(blocked);

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
  await confirmAcceptance(admin, { clientId: bot.client_id as string, channel: "whatsapp", metaAccount: wabaId ?? phoneNumberId, metaVerifiedName: phone.verified_name ?? null });
  await auditPanel("canal.conectar", { type: "bot", id: botId }, { after: { channel: "whatsapp", via: "id", phone: phone.display_phone_number ?? null, waba_id: wabaId } });
  revalidatePath(`/painel/bots/${botId}`);
  await markAnalysisDue(createAdminClient(), botId);
  return ok(`WhatsApp ${phone.display_phone_number ?? ""} ligado. Mande uma mensagem para ele para testar.`);
}

/**
 * Fim do cadastro incorporado pelo painel (a agência, com o cliente do lado ou com acesso ao
 * Facebook dele). O trabalho de verdade está em lib/whatsapp-signup.ts, junto com o link de conexão.
 */
export async function completeWhatsAppSignup(botId: string, input: SignupResult): Promise<ActionResult> {
  if (!(await allowed("config"))) return fail(DENIED);
  const { agency } = await requireAgency();
  const supabase = await createClient();
  const { data: bot } = await supabase.from("bots").select("id, is_demo, client_name, client_id").eq("id", botId).maybeSingle();
  if (!bot) return fail("Chatbot não encontrado.");
  if (bot.is_demo) return fail("Converta a demo em chatbot antes de ligar o WhatsApp.");
  const admin = createAdminClient();
  const blocked = await connectBlockFor(admin, { clientId: bot.client_id as string | null, channel: "whatsapp" });
  if (blocked) return fail(blocked);
  const r = await connectFromSignup(admin, { botId, agencyId: agency.id, clientName: bot.client_name, input, via: "painel" });
  if (r.ok) {
    const { data: ch } = await admin.from("whatsapp_channels").select("waba_id, business_id, verified_name").eq("bot_id", botId).maybeSingle();
    await confirmAcceptance(admin, { clientId: bot.client_id as string, channel: "whatsapp", metaAccount: (ch?.waba_id as string | null) ?? null, metaBusinessId: (ch?.business_id as string | null) ?? null, metaVerifiedName: (ch?.verified_name as string | null) ?? null });
    await auditPanel("canal.conectar", { type: "bot", id: botId }, { after: { channel: "whatsapp", via: "painel", waba_id: ch?.waba_id ?? null, coexistence: Boolean(input.coexistence) } });
  }
  revalidatePath(`/painel/bots/${botId}`);
  return r;
}

/**
 * Tela única de aceite pelo painel: quem é da agência aceita os termos do canal e a Política de Uso
 * Aceitável em nome do negócio (declarando ter poderes) e, na primeira vez, responde as atividades.
 */
export async function acceptChannelTerms(botId: string, channel: AcceptanceChannel, fd: FormData): Promise<ActionResult> {
  if (!(await allowed("config"))) return fail(DENIED);
  const { email, agency, userId } = await requireAgency();
  const supabase = await createClient();
  const { data: bot } = await supabase.from("bots").select("id, is_demo, client_id, client_name").eq("id", botId).maybeSingle();
  if (!bot) return fail("Chatbot não encontrado.");
  if (bot.is_demo) return fail("Converta a demo em chatbot antes de conectar.");
  if (!bot.client_id) return fail("Ligue este chatbot a um cliente (aba Personalidade) antes de conectar.");
  if (fd.get("aceite") !== "on" || fd.get("poderes") !== "on") return fail("Marque as duas caixas para continuar.");
  const admin = createAdminClient();
  const answered = await getCompliance(admin, bot.client_id as string);
  const answers = answered ? null : parseAnswers(fd);
  if (!answered && !answers) return fail("Responda todas as atividades (Não, Sim ou Não sei).");
  const h = await headers();
  let status;
  try {
    status = await recordAcceptance(admin, {
      agencyId: agency.id,
      clientId: bot.client_id as string,
      botId,
      channel,
      via: "painel",
      userId,
      email,
      declaresAuthority: true,
      ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: h.get("user-agent"),
      answers,
    });
  } catch (e) {
    console.error("aceite: falhou", e);
    return fail("Não foi possível registrar o aceite. Tente de novo.");
  }
  if (answers && status !== "ativo") await notifyReview(bot.client_name as string, agency.name, status);
  await auditPanel("aceite.registrar", { type: "client", id: bot.client_id as string }, { after: { channel, status, answered_now: Boolean(answers) } });
  revalidatePath(`/painel/bots/${botId}`);
  revalidatePath(`/painel/clientes/${bot.client_id}`);
  const due = (await getCompliance(admin, bot.client_id as string))?.reviewDueAt;
  if (status === "aguardando_revisao" && channel === "whatsapp") return ok(`Aceite registrado. O WhatsApp só ativa depois da revisão da BoaVoz${due ? `, até ${dayLabel(due)}` : ""}.`);
  if (status === "em_revisao") return ok(`Aceite registrado. O negócio entrou em revisão${due ? ` (resposta até ${dayLabel(due)})` : ""}; pode conectar normalmente.`);
  return ok("Aceite registrado. Pode conectar.");
}

/** Revisão aberta pela resposta de atividades: a BoaVoz fica sabendo na hora. */
async function notifyReview(clientName: string, agencyName: string, status: string) {
  await notifyPlatform(`Negócio em revisão: ${clientName}`, [`${clientName} (agência ${agencyName}) respondeu a pergunta de atividades e ficou "${status}".`, "Veja em /admin/conformidade."]).catch(() => false);
}

/** Link para o cliente conectar o próprio WhatsApp ou Instagram (vale 7 dias, uma conexão). */
export async function createWhatsAppConnectLink(botId: string, channel: "whatsapp" | "instagram" = "whatsapp"): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  if (!(await allowed("config"))) return { ok: false, message: DENIED };
  const { agency } = await requireAgency();
  // WhatsApp no teste grátis: o conteúdo mínimo já vale para gerar o link
  const locked = await channelBlock(createAdminClient(), agency.id, channel, channel === "whatsapp" ? botId : undefined);
  if (locked) return { ok: false, message: locked };
  const supabase = await createClient();
  const { data: bot } = await supabase.from("bots").select("id, is_demo").eq("id", botId).maybeSingle();
  if (!bot) return { ok: false, message: "Chatbot não encontrado." };
  if (bot.is_demo) return { ok: false, message: "Converta a demo em chatbot antes de ligar o WhatsApp." };
  try {
    const { url } = await createConnectLink(createAdminClient(), botId, channel);
    await auditPanel("canal.link_gerar", { type: "bot", id: botId }, { after: { channel } });
    return { ok: true, url };
  } catch {
    return { ok: false, message: "Não foi possível criar o link. Tente de novo." };
  }
}

/**
 * "Isto não é {categoria}": a agência pede ao BoaVoz para o portão deixar de tratar a categoria
 * neste chatbot. Só o BoaVoz aprova (backoffice, Conformidade); a exceção vale só para o chatbot.
 */
export async function requestGateReview(conversationId: string, category: string, formData: FormData): Promise<ActionResult> {
  if (!(await allowed("attend"))) return fail(DENIED);
  if (!isGateCategory(category)) return fail("Categoria inválida.");
  const { agency, email } = await requireAgency();
  const supabase = await createClient();
  const { data: conv } = await supabase.from("conversations").select("id, bot_id, bots(name, client_name)").eq("id", conversationId).maybeSingle();
  if (!conv) return fail("Conversa não encontrada.");
  const note = text(formData.get("note")).slice(0, 500) || null;
  const { error } = await createAdminClient().from("gate_review_requests").insert({ agency_id: agency.id, bot_id: conv.bot_id, conversation_id: conversationId, category, note, requested_by: email });
  if (error) return fail(/duplicate|unique/i.test(error.message) ? "Já existe um pedido de revisão aberto para este item neste chatbot." : "Não foi possível pedir a revisão. Tente de novo.");
  await auditPanel("portao.pedir_revisao", { type: "bot", id: conv.bot_id as string }, { after: { category, conversationId } });
  const bot = (Array.isArray(conv.bots) ? conv.bots[0] : conv.bots) as { name: string; client_name: string } | null;
  await notifyPlatform(`Pedido de revisão do portão: ${CATEGORIES[category].label}`, [
    `${agency.name} pediu revisão: "isto não é ${CATEGORIES[category].label}" no chatbot ${bot?.name ?? ""} (${bot?.client_name ?? ""}).`,
    ...(note ? ["", `Explicação: ${note}`] : []),
    "",
    "Decida em /admin/conformidade.",
  ]).catch(() => false);
  revalidatePath(`/painel/bots/${conv.bot_id}/conversas/${conversationId}`);
  return ok("Pedido enviado. A equipe BoaVoz revisa e avisa por e-mail.");
}

/**
 * Teste grátis: roda a análise do bot na hora (sem esperar a rotina), para o WhatsApp liberar.
 * Pede o conteúdo mínimo antes (1 fonte pronta e as instruções) e tem limite de tentativas.
 */
export async function analyzeBotNow(botId: string): Promise<ActionResult> {
  if (!(await allowed("config"))) return fail(DENIED);
  const supabase = await createClient();
  const { data: bot } = await supabase.from("bots").select("id, persona, is_demo").eq("id", botId).maybeSingle();
  if (!bot || bot.is_demo) return fail("Chatbot não encontrado.");
  const { count } = await supabase.from("sources").select("id", { count: "exact", head: true }).eq("bot_id", botId).eq("status", "ready");
  const problem = trialContentProblem(count ?? 0, (bot.persona as { instructions?: string } | null)?.instructions);
  if (problem) return fail(problem);
  const admin = createAdminClient();
  const exceeded = await firstExceeded(admin, [{ key: `analise:${botId}`, max: 3, windowSeconds: 3600, message: "Muitas análises seguidas. Tente de novo daqui a pouco." }]);
  if (exceeded) return fail(exceeded.message);
  try {
    const r = await analyzeBot(admin, botId);
    revalidatePath(`/painel/bots/${botId}`);
    if (r.status === "aguardando_classificacao") return fail("A base ainda está sendo lida. Tente de novo em alguns minutos.");
    if (r.status === "sem_base") return fail("Adicione pelo menos uma fonte pronta antes de analisar.");
    return r.pending ? ok("Análise feita: ficou para revisão da equipe BoaVoz (até 2 dias úteis).") : ok("Análise feita. O WhatsApp está liberado para este assistente.");
  } catch {
    return fail("Não foi possível analisar agora. Tente de novo em alguns minutos.");
  }
}

/** Coexistência: "já desliguei a saudação e a ausência do app" (registro, sem bloquear nada). */
export async function markAutoRepliesOff(botId: string): Promise<ActionResult> {
  if (!(await allowed("config"))) return fail(DENIED);
  const supabase = await createClient();
  const { data: bot } = await supabase.from("bots").select("id").eq("id", botId).maybeSingle();
  if (!bot) return fail("Chatbot não encontrado.");
  const { error } = await createAdminClient().from("whatsapp_channels").update({ auto_replies_off_at: new Date().toISOString() }).eq("bot_id", botId).eq("coexistence", true);
  if (error) return fail("Não foi possível registrar. Tente de novo.");
  await auditPanel("canal.respostas_automaticas_desligadas", { type: "bot", id: botId });
  revalidatePath(`/painel/bots/${botId}`);
  return ok("Registrado. Assim o cliente recebe só a resposta do assistente.");
}

/** "Já cadastrei o cartão": confere na Meta agora; com cartão, o alerta de pagamento sai. */
export async function recheckWhatsAppPayment(botId: string): Promise<ActionResult> {
  if (!(await allowed("config"))) return fail(DENIED);
  const supabase = await createClient();
  const { data: bot } = await supabase.from("bots").select("id").eq("id", botId).maybeSingle();
  if (!bot) return fail("Chatbot não encontrado.");
  const admin = createAdminClient();
  const { data: ch } = await admin.from("whatsapp_channels").select("phone_number_id, waba_id, access_token_enc").eq("bot_id", botId).maybeSingle();
  if (!ch?.waba_id) return fail("Este número não tem conta do WhatsApp Business ligada.");
  let funded: boolean;
  try {
    funded = await hasPaymentMethod({ ...ch, waba_id: ch.waba_id });
  } catch {
    return fail("Não consegui consultar a Meta agora. Tente de novo em alguns minutos.");
  }
  if (!funded) return fail("A Meta ainda não mostra cartão nesta conta. Confira no Gerenciador do WhatsApp, em Configurações de pagamento (pode levar alguns minutos para aparecer).");
  await admin.from("whatsapp_channels").update({ payment_issue_at: null }).eq("bot_id", botId);
  revalidatePath(`/painel/bots/${botId}`);
  return ok("Cartão encontrado na Meta. O número volta a responder normalmente.");
}

export async function disconnectWhatsApp(botId: string): Promise<ActionResult> {
  if (!(await allowed("config"))) return fail(DENIED);
  const supabase = await createClient();
  const { data: bot } = await supabase.from("bots").select("id").eq("id", botId).maybeSingle();
  if (!bot) return fail("Chatbot não encontrado.");
  // o app deixa de receber os eventos da conta do cliente (o número de teste fica como está)
  const r = await disconnectWhatsAppChannel(createAdminClient(), botId);
  if (!r.ok) return fail("Não foi possível desconectar. Tente de novo.");
  await auditPanel("canal.desconectar", { type: "bot", id: botId }, { before: { channel: "whatsapp", waba_id: r.wabaId } });
  revalidatePath(`/painel/bots/${botId}`);
  return ok("WhatsApp desconectado. O assistente parou de responder por ele.");
}

/* ------------------------------------------------------------------ instagram */

/** Desliga a conta do Instagram do chatbot: o app sai das mensagens dela e o token é apagado. */
export async function disconnectInstagram(botId: string): Promise<ActionResult> {
  if (!(await allowed("config"))) return fail(DENIED);
  const supabase = await createClient();
  const { data: bot } = await supabase.from("bots").select("id").eq("id", botId).maybeSingle();
  if (!bot) return fail("Chatbot não encontrado.");
  const r = await disconnectInstagramChannel(createAdminClient(), botId);
  if (!r.ok) return fail("Não foi possível desconectar. Tente de novo.");
  await auditPanel("canal.desconectar", { type: "bot", id: botId }, { before: { channel: "instagram" } });
  revalidatePath(`/painel/bots/${botId}`);
  return ok("Instagram desconectado. O assistente parou de responder as mensagens diretas.");
}

/* ------------------------------------------------------------------ modelos de mensagem (whatsapp) */

/** Número do WhatsApp do chatbot, conferindo a liberação da agência e o dono do chatbot. */
async function ownedTemplateChannel(botId: string): Promise<TemplateChannel | { error: string }> {
  const { agency } = await requireAgency();
  const locked = await channelBlock(createAdminClient(), agency.id, "whatsapp", undefined, { botId });
  if (locked) return { error: locked };
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
async function sendApprovedTemplate(botId: string, ch: TemplateChannel, to: string, formData: FormData): Promise<{ text: string; category: string; msgHash: string | null } | { error: string }> {
  // regra de estado: ordem da Meta, desligamento geral ou suspensão pela BoaVoz
  const blocked = await sendBlockedReason(createAdminClient(), botId, "whatsapp");
  if (blocked) return { error: `${blocked} O modelo não foi enviado.` };
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
  // envio iniciado pela empresa: quem pediu para sair não recebe
  const kinds = (await activeSuppressions(createAdminClient(), { channel: "whatsapp", scope: suppressionScope({ wabaId: ch.waba_id, botId }), contact: to })).map((s) => s.kind);
  if (blocks(kinds, t.category)) return { error: "Este contato pediu para não receber esse tipo de mensagem (respondeu SAIR, PARAR ou STOP). O modelo não foi enviado. Se ele escrever, a conversa continua normal." };
  let wamid: string | null;
  try {
    wamid = (await sendTemplate(ch, to, t, params)).messages?.[0]?.id ?? null;
  } catch (e) {
    return { error: `O WhatsApp não aceitou o envio: ${await metaError(botId, e)}` };
  }
  return { text: renderTemplate(t.body, params), category: t.category, msgHash: wamid ? channelMsgHash("whatsapp", wamid) : null };
}

/** Grava o modelo enviado como resposta da equipe e atualiza a conversa. */
async function recordTemplateMessage(admin: ReturnType<typeof createAdminClient>, conversationId: string, content: string, category: string, msgHash: string | null) {
  // a categoria decide o alcance de um SAIR respondido depois (descadastro da categoria do último modelo)
  try {
    await saveMessage(admin, { conversation_id: conversationId, role: "agent", content, ...attendantAuthor(await me()), template_category: category, channel_msg_id: "enviada", channel_msg_hash: msgHash }, { touch: "equipe" });
  } catch (e) {
    console.error("modelo enviado, mas não gravado na conversa", (e as Error).message);
  }
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
  if (!(await allowed("config"))) return fail(DENIED);
  const ch = await ownedTemplateChannel(botId);
  if ("error" in ch) return fail(ch.error);
  const name = templateName(text(formData.get("name")));
  const body = String(formData.get("body") ?? "").trim();
  const examples = lines(String(formData.get("examples") ?? ""));
  // marketing só volta na B3, com o consentimento registrado
  const category = "UTILITY";
  const invalid = validateTemplate({ name, body, examples });
  if (invalid) return fail(invalid);
  try {
    await createTemplate(ch, { name, category, body, examples });
  } catch (e) {
    return fail(`A Meta recusou o modelo: ${await metaError(botId, e)}`);
  }
  await markAnalysisDue(createAdminClient(), botId);
  revalidatePath(`/painel/bots/${botId}`);
  return ok("Modelo enviado para análise da Meta. Costuma sair em minutos; recarregue para ver o status.");
}

export async function deleteWhatsAppTemplate(botId: string, name: string): Promise<ActionResult> {
  if (!(await allowed("config"))) return fail(DENIED);
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
  if (!(await allowed("attend"))) return fail(DENIED);
  const owned = await ownedConversation(conversationId);
  if (!owned) return fail("Conversa não encontrada.");
  const ch = await ownedTemplateChannel(owned.conv.bot_id);
  if ("error" in ch) return fail(ch.error);
  const { data: conv } = await owned.admin.from("conversations").select("channel, wa_id").eq("id", conversationId).single();
  if (conv?.channel !== "whatsapp" || !conv.wa_id) return fail("Esta conversa não é do WhatsApp.");
  const sent = await sendApprovedTemplate(owned.conv.bot_id, ch, conv.wa_id, formData);
  if ("error" in sent) return fail(sent.error);
  await recordTemplateMessage(owned.admin, conversationId, sent.text, sent.category, sent.msgHash);
  revalidatePath(`/painel/bots/${owned.conv.bot_id}/conversas/${conversationId}`);
  return ok("Modelo enviado. Quando o contato responder, a conversa continua aqui.");
}

/**
 * "+ Nova conversa": começa a falar com um número pelo WhatsApp com um modelo aprovado.
 * Se já existe conversa recente com ele, o modelo entra nela em vez de abrir outra.
 */
export async function startWhatsAppConversation(botId: string, formData: FormData): Promise<ActionResult> {
  if (!(await allowed("attend"))) return fail(DENIED);
  const ch = await ownedTemplateChannel(botId);
  if ("error" in ch) return fail(ch.error);
  const to = whatsappNumber(text(formData.get("to")));
  if (to.length < 12) return fail("Informe o WhatsApp com DDD, ex.: 21 99999-9999.");
  const sent = await sendApprovedTemplate(botId, ch, to, formData);
  if ("error" in sent) return fail(sent.error);

  const admin = createAdminClient();
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const { agency } = await requireAgency();
  const contact = await whatsappContact(admin, { id: botId, agency_id: agency.id }, { phone: to });
  const recentBy = admin.from("conversations").select("id").eq("bot_id", botId).gt("last_message_at", since).order("last_message_at", { ascending: false }).limit(1);
  const { data: recent } = await (contact ? recentBy.eq("contact_id", contact.id) : recentBy.in("wa_id", waIdVariants(to))).maybeSingle();
  let conversationId = recent?.id as string | undefined;
  if (!conversationId) {
    const { data: created, error } = await admin.from("conversations").insert({ bot_id: botId, channel: "whatsapp", wa_id: to, contact_id: contact?.id ?? null, visitor_id: null }).select("id").single();
    if (error || !created) return fail("A mensagem foi enviada, mas não deu para abrir a conversa aqui. Ela aparece quando o contato responder.");
    conversationId = created.id as string;
  }
  await recordTemplateMessage(admin, conversationId, sent.text, sent.category, sent.msgHash);
  revalidatePath(`/painel/bots/${botId}`);
  redirect(`/painel/bots/${botId}/conversas/${conversationId}`);
}

/* ------------------------------------------------------------------ domínio próprio */

/** Salva (ou remove) o domínio próprio. Trocar de domínio exige verificar de novo. */
export async function saveCustomDomain(formData: FormData): Promise<ActionResult> {
  if (!(await allowed("brand"))) return fail(DENIED);
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
  if (!(await allowed("brand"))) return fail(DENIED);
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
  if (!(await allowed("config"))) return fail(DENIED);
  const supabase = await createClient();
  const patch = { allow_handoff: formData.get("allow_handoff") === "on", allow_knowledge: formData.get("allow_knowledge") === "on", handoff_notify: formData.get("handoff_notify") === "client" ? "client" : "all" };
  const { error, count } = await supabase.from("clients").update(patch, { count: "exact" }).eq("id", clientId);
  if (error || !count) return fail("Não foi possível salvar as permissões.");
  await auditPanel("portal.permissoes", { type: "client", id: clientId }, { after: patch });
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
  if (!(await allowed("config"))) return fail(DENIED);
  const ctx = await inviteContext(clientId);
  if (!ctx) return fail("Cliente não encontrado.");
  const email = text(formData.get("email")).toLowerCase();
  if (!isEmail(email)) return fail("E-mail inválido.");
  const { count } = await ctx.supabase.from("client_members").select("id", { count: "exact", head: true }).eq("client_id", clientId);
  if ((count ?? 0) >= 20) return fail("Limite de 20 pessoas por cliente.");
  const { error } = await ctx.supabase.from("client_members").insert({ client_id: clientId, email });
  if (error) return fail(error.code === "23505" ? "Esse e-mail já tem acesso." : "Não foi possível adicionar. Tente de novo.");
  await auditPanel("portal.pessoa_adicionar", { type: "client", id: clientId }, { after: { email } });
  revalidatePath(`/painel/clientes/${clientId}`);
  const sent = await sendMemberLink({ email, origin: agencyBaseUrl(ctx.agency), next: `/cliente/${clientId}`, clientName: ctx.client.name, agency: ctx.agency });
  if (!sent.ok) return fail(`Acesso criado, mas o convite não foi enviado: ${sent.message} A pessoa pode entrar pela área do cliente pedindo um link.`);
  return ok(`Convite enviado para ${email}.`);
}

export async function resendClientInvite(clientId: string, memberId: string): Promise<ActionResult> {
  if (!(await allowed("config"))) return fail(DENIED);
  const ctx = await inviteContext(clientId);
  if (!ctx) return fail("Cliente não encontrado.");
  const { data: member } = await ctx.supabase.from("client_members").select("email").eq("id", memberId).eq("client_id", clientId).maybeSingle();
  if (!member) return fail("Pessoa não encontrada.");
  const sent = await sendMemberLink({ email: member.email, origin: agencyBaseUrl(ctx.agency), next: `/cliente/${clientId}`, clientName: ctx.client.name, agency: ctx.agency });
  return sent.ok ? ok(`Link enviado de novo para ${member.email}.`) : fail(sent.message);
}

/** Tira o acesso na hora (a sessão aberta perde acesso na próxima página que abrir). */
export async function removeClientMember(clientId: string, memberId: string): Promise<ActionResult> {
  if (!(await allowed("config"))) return fail(DENIED);
  const supabase = await createClient();
  const { error, count } = await supabase.from("client_members").delete({ count: "exact" }).eq("id", memberId).eq("client_id", clientId);
  if (error || !count) return fail("Não foi possível remover.");
  await auditPanel("portal.pessoa_remover", { type: "client", id: clientId }, { before: { member_id: memberId } });
  revalidatePath(`/painel/clientes/${clientId}`);
  return ok("Acesso removido.");
}

/* ------------------------------------------------------------------ LGPD */

/** Apaga uma conversa inteira (mensagens e contatos capturados nela). */
export async function deleteConversation(conversationId: string): Promise<ActionResult> {
  if (!(await allowed("config"))) return fail(DENIED);
  const owned = await ownedConversation(conversationId);
  if (!owned) return fail("Conversa não encontrada.");
  const leadIds = await leadIdsOfConversations(owned.admin, [conversationId]);
  await logDeletion(owned.admin, "leads", leadIds);
  await logDeletion(owned.admin, "conversations", [conversationId]);
  await deleteLeads(owned.admin, leadIds);
  // arquivos recebidos: o objeto sai do Storage antes da conversa
  await purgeAttachments(owned.admin, { conversationIds: [conversationId] });
  const { error } = await owned.admin.from("conversations").delete().eq("id", conversationId);
  if (error) return fail("Não foi possível excluir. Tente de novo.");
  await auditPanel("conversa.excluir", { type: "conversation", id: conversationId }, { before: { leads: leadIds.length } });
  revalidatePath("/painel", "layout");
  redirect(`/painel/bots/${owned.conv.bot_id}?tab=conversas`);
}

const digitsOf = (v: string) => v.replace(/\D/g, "");

/**
 * Pedido de titular (LGPD): apaga todos os contatos com esse e-mail ou telefone nos chatbots
 * do cliente, e as conversas em que foram capturados.
 */
export async function eraseContactData(clientId: string, formData: FormData): Promise<ActionResult> {
  if (!(await allowed("security"))) return fail(DENIED);
  const contact = text(formData.get("contact")).toLowerCase();
  const digits = digitsOf(contact);
  const byEmail = isEmail(contact);
  if (!byEmail && digits.length < 8) return fail("Informe um e-mail ou um telefone com DDD.");
  const supabase = await createClient();
  const { data: bots } = await supabase.from("bots").select("id").eq("client_id", clientId);
  const ids = (bots ?? []).map((b) => b.id);
  if (!ids.length) return ok("Nenhum dado encontrado para esse contato.");

  // telefone: pelo hash do número canônico e comparando só os números pelo final (com ou sem +55 e DDD formatado)
  const ph = byEmail ? null : typedPhoneHash(contact);
  const matches = await findLeadsByContact(supabase, ids, byEmail ? { email: contact } : { phone: contact, phoneHash: ph });

  const admin = createAdminClient();
  // a ficha do contato (WhatsApp, pelo telefone canônico em hash, ou pelo e-mail): a rotina apaga todas as conversas dela
  const contactIds = byEmail ? await findContactIds(admin, ids, { email: contact }) : ph ? await findContactIds(admin, ids, { phoneHash: ph }) : [];
  if (!matches.length && !contactIds.length) return ok("Nenhum dado encontrado para esse contato.");

  // rotina única do pedido do titular (a mesma do chat): entregas e logs, perguntas, leads, conversas,
  // 18+, supressão e ficha, tudo no registro de exclusões; depois o contact.deleted e o pedido como prova
  const { agency, userId } = await requireAgency();
  const leadConvs = matches.map((l) => l.conversation_id).filter((c): c is string => Boolean(c));
  const { erased, ...summary } = await eraseTargets(admin, { contactIds, conversationIds: leadConvs, leadIds: matches.map((l) => l.id) }, { code: `painel:${clientId}`, source: "painel" });
  const requestId = await recordPanelRequest(admin, { agencyId: agency.id, clientId, by: userId, summary });
  await emitErasedContacts(admin, erased, requestId ?? `painel:${clientId}`);
  await auditPanel("contato.apagar_dados", { type: "client", id: clientId }, { after: { ...summary, por: byEmail ? "email" : "telefone" } });
  revalidatePath(`/painel/clientes/${clientId}`);
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  return ok(`Apagados: ${n(summary.conversas, "conversa", "conversas")}, ${n(summary.leads, "lead", "leads")} e ${n(summary.contatos, "ficha de contato", "fichas de contato")}.${erased.some((c) => c.channel !== "widget") ? " O número entrou na lista de quem não recebe mensagens da empresa." : ""}`);
}

/** Ações da Segurança: exigem o segundo fator nesta sessão. */
const MFA_NEEDED = "Faça a verificação em duas etapas (código do app autenticador) e tente de novo.";

/** Segundo fator da agência: entrada ou falha no registro de acesso e, no primeiro código, o cadastro na auditoria. */
export async function recordAgencyMfa(ok: boolean, enrolled: boolean): Promise<void> {
  const { agency, userId } = await requireAgency();
  const meta = await requestMeta();
  await logAccess(createAdminClient(), { actorType: "user", actorId: userId, event: ok ? "login" : "login_failed", ip: meta.ip, userAgent: meta.userAgent, agencyId: agency.id });
  if (ok && enrolled) await auditPanel("seguranca.mfa_cadastrar", { type: "agency", id: agency.id });
}

/** O app autenticador foi removido (trocar de aparelho): evento grave, com e-mail e faixa. */
export async function recordMfaRemoved(): Promise<void> {
  const { agency } = await requireAgency();
  await auditPanel("seguranca.mfa_remover", { type: "agency", id: agency.id });
}

/** Segurança: sai do painel em todos os outros aparelhos (esta sessão continua). */
export async function endOtherSessions(): Promise<ActionResult> {
  await requireAgency();
  if (!(await hasMfa())) return fail(MFA_NEEDED);
  const { error } = await (await createClient()).auth.signOut({ scope: "others" });
  if (error) return fail("Não foi possível encerrar as outras sessões. Tente de novo.");
  const { agency } = await requireAgency();
  await auditPanel("seguranca.encerrar_sessoes", { type: "agency", id: agency.id });
  return ok("Pronto: as outras sessões foram encerradas.");
}

/** Segurança: libera o suporte do BoaVoz por 24 horas, com motivo (evento grave: e-mail e faixa). */
export async function grantSupportAccess(formData: FormData): Promise<ActionResult> {
  if (!(await allowed("security"))) return fail(DENIED);
  const { agency, userId } = await requireAgency();
  if (!(await hasMfa())) return fail(MFA_NEEDED);
  const reason = text(formData.get("reason")).replace(/\s+/g, " ").trim();
  if (reason.length < 10) return fail("Escreva o motivo (o que o suporte vai ver), com pelo menos 10 letras.");
  if (reason.length > 300) return fail("Motivo longo demais.");
  const g = await grantSupport(createAdminClient(), { agencyId: agency.id, by: userId, reason, meta: await requestMeta() });
  revalidatePath("/painel", "layout");
  return ok(`Suporte liberado até ${new Date(g.expires_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}.`);
}

/** Segurança: encerra agora o acesso do suporte. */
export async function revokeSupportAccess(): Promise<ActionResult> {
  if (!(await allowed("security"))) return fail(DENIED);
  const { agency, userId } = await requireAgency();
  if (!(await hasMfa())) return fail(MFA_NEEDED);
  const done = await revokeSupport(createAdminClient(), { agencyId: agency.id, by: userId, meta: await requestMeta() });
  revalidatePath("/painel/seguranca");
  return ok(done ? "Acesso do suporte encerrado." : "O suporte já não tinha acesso.");
}

/** Faixa de alertas de segurança: marca os de agora como vistos. */
export async function markSecurityAlertsSeen(): Promise<ActionResult> {
  if (!(await allowed("security"))) return fail(DENIED);
  const { agency } = await requireAgency();
  await createAdminClient().from("agencies").update({ security_alerts_seen_at: new Date().toISOString() }).eq("id", agency.id);
  revalidatePath("/painel", "layout");
  return ok("Alertas marcados como vistos.");
}

/** Segurança: confirma um pedido do titular feito pelo chat e roda a rotina de exclusão. */
export async function confirmDataSubjectRequest(requestId: string): Promise<ActionResult> {
  if (!(await allowed("security"))) return fail(DENIED);
  const { userId } = await requireAgency();
  if (!(await hasMfa())) return fail(MFA_NEEDED);
  const supabase = await createClient();
  // a RLS limita aos pedidos desta agência
  const { data: req } = await supabase.from("data_subject_requests").select("id, status").eq("id", requestId).maybeSingle();
  if (!req) return fail("Pedido não encontrado.");
  if (req.status !== "aguardando") return ok("Este pedido já foi atendido.");
  const summary = await executeRequest(createAdminClient(), requestId, userId);
  if (!summary) return ok("Este pedido já foi atendido.");
  await auditPanel("titular.confirmar", { type: "data_subject_request", id: requestId }, { after: { ...summary } });
  revalidatePath("/painel/seguranca");
  return ok(`Pedido atendido: ${summary.conversas} conversa(s), ${summary.leads} lead(s) e ${summary.contatos} ficha(s) de contato apagadas.`);
}

/** Política de privacidade (link no chat) e prazo de guarda dos dados dos visitantes. */
export async function updatePrivacy(formData: FormData): Promise<ActionResult> {
  if (!(await allowed("security"))) return fail(DENIED);
  const { agency } = await requireAgency();
  const url = text(formData.get("privacy_url"));
  if (url && !/^https?:\/\/[^\s]+\.[^\s]+$/i.test(url)) return fail("Use o endereço completo da política, começando com https://");
  if (url.length > 400) return fail("Endereço longo demais.");
  const months = Number(formData.get("retention_months"));
  if (!isRetentionMonths(months)) return fail("Escolha 6, 12 ou 24 meses.");
  const supabase = await createClient();
  const { error } = await supabase.from("agencies").update({ privacy_url: url || null }).eq("id", agency.id);
  if (error) return fail("Não foi possível salvar. Tente de novo.");
  // prazo: só pelo servidor (redução espera 30 dias, com aviso e desfazer; aumento vale na hora)
  const before = { months: agency.retention_months, pendingMonths: agency.retention_pending_months, effectiveAt: agency.retention_effective_at };
  const plan = planAgencyRetention(before, months);
  if (plan.kind !== "sem_mudanca") {
    const admin = createAdminClient();
    const { error: e2 } = await admin.from("agencies").update(plan.patch).eq("id", agency.id);
    if (e2) return fail("Não foi possível salvar o prazo. Tente de novo.");
    await auditPanel(`retencao.${plan.kind}`, { type: "agency", id: agency.id }, { before, after: plan.patch });
    if (plan.kind === "reducao") {
      await notifyAgencyOwner(admin, agency.id, `O prazo de guarda vai mudar para ${months} meses em ${dateBR(plan.patch.retention_effective_at)}`, [
        `Você mudou o prazo de guarda das conversas e contatos para ${months} meses.`,
        "",
        `A mudança vale a partir de ${dateBR(plan.patch.retention_effective_at)}: daí em diante, conversas paradas há mais de ${months} meses, com as mensagens, leads, perguntas sem resposta e fichas de contato sem conversa são apagados todo dia. Os relatórios continuam com os números.`,
        "",
        `Até lá dá para desfazer em Marca e domínio → Privacidade e LGPD: ${appUrl("/painel/marca")}`,
        `Se precisar guardar algo, exporte os leads antes: ${appUrl("/api/leads/export")}`,
      ]).catch(() => false);
    }
  }
  revalidatePath("/painel", "layout");
  if (plan.kind === "reducao") return ok(`Salvo. A partir de ${dateBR(plan.patch.retention_effective_at)}, o que tiver mais de ${months} meses passa a ser apagado. Até lá, dá para desfazer.`);
  if (plan.kind === "aumento") return ok(`Salvo. O prazo passou para ${months} meses agora.`);
  if (plan.kind === "desfazer") return ok(`Mudança desfeita: o prazo continua ${months} meses.`);
  return ok("Salvo.");
}

/** Prazo próprio do cliente (vazio = o da agência). Diminuir pede confirmação, vai para a auditoria e avisa o cliente. */
export async function setClientRetention(clientId: string, formData: FormData): Promise<ActionResult> {
  if (!(await allowed("security"))) return fail(DENIED);
  const { agency } = await requireAgency();
  const raw = text(formData.get("retention_months"));
  const months = raw ? Number(raw) : null;
  if (months !== null && !isRetentionMonths(months)) return fail("Escolha 6, 12 ou 24 meses, ou o prazo da agência.");
  const supabase = await createClient();
  const { data: client } = await supabase.from("clients").select("id, retention_months").eq("id", clientId).maybeSingle();
  if (!client) return fail("Cliente não encontrado.");
  const days = (m: number | null) => (m ? m * 30 : null);
  const before = days((client.retention_months as number | null) ?? agency.retention_months);
  const after = days(months ?? agency.retention_months);
  const reduced = retentionReduced(before, after);
  if (reduced && formData.get("confirm") !== "on") return fail(`Para diminuir o prazo, marque a confirmação: o que tiver mais de ${retentionLabel(after)} é apagado na próxima limpeza diária.`);
  const { error } = await supabase.from("clients").update({ retention_months: months }).eq("id", clientId);
  if (error) return fail("Não foi possível salvar. Tente de novo.");
  await auditPanel("cliente.retencao", { type: "client", id: clientId }, { before: { retention_months: client.retention_months }, after: { retention_months: months } });
  if (reduced) {
    await notifyClientPeople(createAdminClient(), clientId, `${agency.name} mudou o prazo de guarda das conversas`, [
      `${agency.name} mudou o prazo de guarda das conversas e contatos dos seus assistentes para ${retentionLabel(after)}.`,
      "",
      "Conversas paradas há mais tempo que isso, com as mensagens, leads e fichas de contato sem conversa, passam a ser apagados na limpeza diária. Os relatórios continuam com os números.",
      "",
      `Se não combinou essa mudança, fale com ${agency.name}.`,
    ]).catch(() => false);
  }
  revalidatePath(`/painel/clientes/${clientId}`);
  return ok(months ? `Prazo do cliente: ${months} meses.` : `O cliente segue o prazo da agência (${retentionLabel(days(agency.retention_months))}).`);
}

/** Desfaz a redução de prazo pendente (o "Não apagar" não volta: aí é escolher um prazo). */
export async function undoAgencyRetention(): Promise<ActionResult> {
  if (!(await allowed("security"))) return fail(DENIED);
  const { agency } = await requireAgency();
  if (agency.retention_pending_months === null) return ok("Nada pendente.");
  if (agency.retention_months === null) return fail("O “Não apagar” deixou de existir: escolha 6, 12 ou 24 meses.");
  const { error } = await createAdminClient().from("agencies").update({ retention_pending_months: null, retention_effective_at: null }).eq("id", agency.id);
  if (error) return fail("Não foi possível desfazer. Tente de novo.");
  await auditPanel("retencao.desfazer", { type: "agency", id: agency.id }, { before: { retention_pending_months: agency.retention_pending_months, retention_effective_at: agency.retention_effective_at }, after: { retention_months: agency.retention_months } });
  revalidatePath("/painel", "layout");
  return ok(`Mudança desfeita: o prazo continua ${agency.retention_months} meses.`);
}

/** Esconde o card "Primeiros passos" neste navegador (um ano). */
export async function hideOnboarding(): Promise<ActionResult> {
  (await cookies()).set(ONBOARDING_COOKIE, "hidden", { path: "/painel", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true });
  revalidatePath("/painel/clientes");
  return ok("Primeiros passos ocultados.");
}
