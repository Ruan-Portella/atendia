"use server";

import { canLinkWhatsAppById } from "@/lib/platform-admin";
import { revalidatePath } from "next/cache";
import { parseFace } from "@/lib/bot-face";
import { sizeRequiredBlock } from "@/lib/free-account";
import { queueChannelEvent, queueConsentEvent, trackCompliance } from "@/lib/platform-events";
import { resumeConversationAi } from "@/lib/api-pause";
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { agencySlug, requireAgency, type AgencyContext } from "@/lib/agency";
import { canonicalPhone } from "@/lib/phone";
import { attendantOf, can, type Permission } from "@/lib/team";
import { ALREADY_YOURS, postAgentMessage, reactAsAgent, release, requestPhoneAsAgent, takeOver } from "@/lib/handoff";
import { agentUpload } from "@/lib/agent-files";
import { parseTarget, transferConversation } from "@/lib/transfer";
import { isSignatureFormat } from "@/lib/signature";
import { parseTicketForm } from "@/lib/tickets";
import { setTicketStatus } from "@/lib/ticket-follow";
import { ensureTicketTemplate } from "@/lib/ticket-whatsapp";
import { clearBotMemories, saveContactMemory } from "@/lib/contacts";
import { addNote } from "@/lib/conversation-notes";
import { snoozeConversation, snoozeTarget, unsnoozeConversation } from "@/lib/snooze";
import { attendantAuthor, type Attendant } from "@/lib/authors";
import { answerQuestion } from "@/lib/knowledge";
import { PORTAL_ROLE_LABELS, isPortalRole, sendMemberLink, type PortalRole } from "@/lib/member";
import { appUrl, initials, normalizeUrl } from "@/lib/utils";
import { emitErasedContacts, eraseTargets, executeRequest, recordPanelRequest, refuseReasonProblem, refuseRequest } from "@/lib/data-subject";
import { grantSupport, revokeSupport } from "@/lib/support-access";
import { cancelAccountDeletion, requestAccountDeletion } from "@/lib/account-deletion";
import { parseMomentNotice, untilLabel } from "@/lib/moment-notice";
import { parseBotDisplay } from "@/lib/bot-context";
import { hasMfa } from "@/lib/agency-mfa";
import { RECOVERY_CONFIRM_HOURS, RECOVERY_PROBLEM, cancelOnVerified, requestRecovery } from "@/lib/mfa-recovery";
import { purgeAttachments } from "@/lib/attachments";
import { removeBotSourceFiles } from "@/lib/source-files";
import { applySensitiveMode, sensitiveChangeText, sensitiveSavedText } from "@/lib/sensitive-mode";
import { logAccess } from "@/lib/access-log";
import { DEFAULT_AI_NOTICE, DEFAULT_AWAY_MESSAGE, DEFAULT_BACK_NOTICE, DEFAULT_ENTRY_NOTICE, aiNoticeProblem, awayMessageProblem, backNoticeProblem, entryNoticeProblem, parseHoursForm, type BusinessHours, type HumanHandoff } from "@/lib/handoff-hours";
import { isChatLink, type RegulatedChannel } from "@/lib/gate/sales-channel";
import { getAge, resetAge } from "@/lib/gate/age";
import { clearAgePending } from "@/lib/gate/flow";
import { isGateCategory } from "@/lib/gate/exceptions";
import { CATEGORIES } from "@/lib/gate/rules";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { syncSubscriptionSafe } from "@/lib/billing-sync";
import { OVERAGE_PRICE_CENTS, creditBalance } from "@/lib/billing-credit";
import { brlCents, num } from "@/lib/plans";
import { OVERAGE_CAP_MAX_BRL, OVERAGE_CAP_MIN_BRL, overageMax, parseCapBrl } from "@/lib/quota";
import { assistantName, clientFields, isEmail, text } from "@/lib/validation";
import { addDomainToProject, agencyBaseUrl, checkDomain, parseDomain, removeDomainFromProject } from "@/lib/domain";
import { ONBOARDING_COOKIE } from "@/lib/onboarding";
import { WhatsAppError, waIdVariants, getPhoneNumber, hasPaymentMethod, subscribeApp, updateBusinessProfile, whatsappConfigured } from "@/lib/whatsapp";
import { channelBlock } from "@/lib/features";
import { NEEDS_DOMAIN } from "@/lib/entitlements";
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
import { BillingOpError, setOverage } from "@/lib/billing-ops";
import { channelMsgHash } from "@/lib/hash";
import { listDateFields } from "@/lib/contact-date-fields";
import { contactForPanel, findContactIds, importWhatsAppContacts, normalizeTags, setContactCustomDates, setContactDates, setContactTags, typedPhoneHash, whatsappContact } from "@/lib/contacts";
import { DEFAULT_TIMEZONE } from "@/lib/timezone";
import { carryWhatsAppPreferences, consentHistory, consentStateOf, recordConsent, recordImportedConsents, revokeConsents } from "@/lib/marketing-consent";
import { IMPORT_MAX_ROWS, contactDatesFromForm, validateImportRows, type ImportError, type RawImportRow } from "@/lib/contact-import";
import { setCompanyAgesBulk } from "@/lib/gate/age";
import { deleteLeads, findLeadsByContact, leadIdsOfConversations } from "@/lib/leads";
import { markUnansweredResolved } from "@/lib/unanswered";
import { logDeletion } from "@/lib/deletions";
import { saveMessage } from "@/lib/messages";
import { analyzeBot, markAnalysisDue } from "@/lib/bot-analysis";
import { OVERRIDE_FIELDS, applyTemplate, derivedPatch, readySourceCount, setDerivedOverride, unlockedFields, type OverrideField } from "@/lib/bot-template";
import { pauseBotNow, resumeBotNow } from "@/lib/bot-pause";
import { firstExceeded } from "@/lib/rate-limit";
import { ensureResumeTemplate, createTemplate, deleteTemplate, formParams, templateName, lines, listSendable, loadTemplateChannel, renderTemplate, sendTemplate, validateTemplate, type TemplateChannel } from "@/lib/whatsapp-templates";
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

/** A análise do bot precisa de conteúdo: pelo menos 1 fonte pronta e as instruções escritas. Pura; null = pode. */
function analysisContentProblem(readySources: number, instructions: string | null | undefined): string | null {
  if (readySources < 1) return "A análise precisa de pelo menos 1 fonte pronta na base de conhecimento (aba Base de conhecimento).";
  if (!instructions?.trim()) return "A análise precisa das instruções do assistente escritas (aba Personalidade).";
  return null;
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
  const { agency } = await requireAgency();
  const supabase = await createClient();

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
    // fora da coexistência, o telefone precisa ser outro: o número do bot é atendido pelo próprio bot.
    // Pela sessão (RLS): com o id de um chatbot de outra conta, a resposta não diz se o número bate
    const { data: wa } = await (await createClient()).from("whatsapp_channels").select("display_phone, coexistence").eq("bot_id", botId).maybeSingle();
    const botDigits = (wa?.display_phone ?? "").replace(/\D/g, "");
    if (botDigits && !wa?.coexistence && (botDigits.endsWith(digits) || digits.endsWith(botDigits))) {
      return { error: "Esse é o número do WhatsApp do próprio assistente. Informe outro telefone da equipe (ou deixe em branco)." };
    }
  }
  const parsedHours = parseHoursForm(f);
  if ("error" in parsedHours) return parsedHours;
  const hours: BusinessHours = parsedHours.hours ?? {};
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
      // assinatura das mensagens da equipe (Caixa de entrada, parte 5); sem assinatura fica nulo
      signature: isSignatureFormat(f.signature) && f.signature !== "nenhuma" ? f.signature : null,
      signature_smart: f.signature_smart === "on",
      signature_sector: f.signature_sector === "on",
      signature_locked: f.signature_locked === "on",
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
  // chamados com o telefone (parte 7d): o modelo do aviso no WhatsApp é criado depois de salvar
  let ticketWhatsApp = false;
  // memória do contato (leva Memória e avisos, parte 1): desligar apaga as memórias do chatbot
  let memoryOff = false;
  if ("memory_form" in f) {
    patch.contact_memory = f.contact_memory === "on";
    memoryOff = f.contact_memory !== "on";
  }
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
  // o rosto do chatbot (redesenho, etapa 3): olhos e acessório; a cor é a cor principal, acima
  if ("face_eyes" in f) {
    const face = parseFace(f.face_eyes, f.face_acc);
    if (!face) return fail("Escolha os olhos e o acessório entre as opções.");
    patch.face = face;
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
    // chamados no chat do site (Caixa de entrada, parte 7a)
    const ticket = parseTicketForm(f);
    if ("error" in ticket) return fail(ticket.error);
    patch.ticket_form = ticket.value;
    ticketWhatsApp = Boolean(ticket.value?.enabled && ticket.value.phone !== "nao");
  }
  if (!Object.keys(patch).length && !("extra_instructions" in f) && !("welcome" in f)) return fail("Nada para salvar.");

  // chatbot derivado (D', parte 2c): o que o modelo libera e mudou vira valor próprio; o resto vem do modelo
  const { data: kind } = await supabase.from("bots").select("template_id, name, persona, appearance, human_handoff, overrides").eq("id", botId).maybeSingle();
  let toSave: Record<string, unknown> = patch;
  if (kind?.template_id) {
    const { data: t } = await createAdminClient().from("bots").select("template_unlocked").eq("id", kind.template_id).maybeSingle();
    toSave = derivedPatch(patch, f, unlockedFields({ template_unlocked: (t?.template_unlocked as string[] | null) ?? [] }), {
      name: kind.name as string,
      welcome: ((kind.persona as { welcome?: string } | null)?.welcome as string | undefined) ?? null,
      appearance: (kind.appearance as Record<string, unknown> | null) ?? null,
      entryNotice: ((kind.human_handoff as { entry_notice?: string } | null)?.entry_notice as string | undefined) ?? null,
      overrides: (kind.overrides as Record<string, unknown> | null) ?? {},
    });
  }

  const { error, count } = await supabase.from("bots").update(toSave, { count: "exact" }).eq("id", botId);
  if (error) return fail("Não foi possível salvar. Tente de novo.");
  if (!count) return fail("Chatbot não encontrado.");
  // mudar as instruções ou os "Assuntos do negócio" dispara de novo a análise do bot (agrupada, ~10 min)
  if ("persona" in patch || "business_topics" in patch) await markAnalysisDue(createAdminClient(), botId);
  // bot modelo (D', parte 3): a mudança fica no rascunho até publicar; derivado: o modelo de novo, com os valores próprios
  const { data: saved } = await supabase.from("bots").select("is_template").eq("id", botId).maybeSingle();
  if (kind?.template_id) await applyTemplate(createAdminClient(), kind.template_id as string, [botId]);
  revalidatePath("/painel", "layout");
  const forgotten = memoryOff ? await clearBotMemories(createAdminClient(), botId).catch(() => 0) : 0;
  if (forgotten) await auditPanel("bot.memoria_apagada", { type: "bot", id: botId }, { after: { contatos: forgotten } });
  if (saved?.is_template) return ok("Salvo no rascunho do modelo. Os chatbots derivados recebem quando você publicar.");
  // chamado com telefone e WhatsApp conectado: o modelo do aviso da resposta (criado uma vez)
  if (ticketWhatsApp) {
    const status = await ensureTicketTemplate(createAdminClient(), botId).catch(() => "ausente" as const);
    if (status === "em_analise") return ok("Alterações salvas. O modelo do aviso dos chamados no WhatsApp foi para a análise da Meta (costuma sair em minutos).");
    if (status === "recusado" || status === "reclassificado") return ok("Alterações salvas. A Meta recusou o modelo do aviso dos chamados no WhatsApp: a resposta segue só por e-mail.");
  }
  return ok("Alterações salvas.");
}

/**
 * Derivado (D', parte 2c): desliga do modelo. Fica com uma cópia das ações, dos roteiros e da base
 * do modelo e para de receber as mudanças dele (detach_from_template, migração 0122).
 */
export async function detachFromTemplate(botId: string): Promise<ActionResult> {
  if (!(await allowed("config"))) return fail(DENIED);
  const supabase = await createClient();
  const { data: bot } = await supabase.from("bots").select("id, template_id").eq("id", botId).maybeSingle();
  if (!bot?.template_id) return fail("Este chatbot não segue um modelo.");
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("detach_from_template", { p_bot: bot.id });
  if (error || !data) {
    console.error("derivado: desligar do modelo", error?.message);
    return fail("Não foi possível desligar do modelo. Tente de novo.");
  }
  await markAnalysisDue(admin, bot.id as string);
  await auditPanel("modelo.desligar", { type: "bot", id: bot.id as string }, { before: { modelo: bot.template_id } });
  revalidatePath("/painel", "layout");
  return ok("Pronto: o chatbot agora é independente, com uma cópia das ações, dos roteiros e da base do modelo.");
}

/** Derivado (D', parte 2c): o campo volta a seguir o modelo (o valor próprio sai; nas instruções, as extras). */
export async function resetDerivedField(botId: string, field: string): Promise<ActionResult> {
  if (!(await allowed("config"))) return fail(DENIED);
  const supabase = await createClient();
  const { data: bot } = await supabase.from("bots").select("id, template_id, overrides").eq("id", botId).maybeSingle();
  if (!bot?.template_id) return fail("Chatbot não encontrado.");
  const admin = createAdminClient();
  try {
    if (field === "instrucoes") {
      await admin.from("bots").update({ extra_instructions: null }).eq("id", bot.id);
      await applyTemplate(admin, bot.template_id as string, [bot.id as string]);
    } else if ((OVERRIDE_FIELDS as readonly string[]).includes(field)) {
      await setDerivedOverride(admin, { id: bot.id as string, template_id: bot.template_id as string, overrides: (bot.overrides as Record<string, unknown> | null) ?? {} }, field as OverrideField, undefined);
    } else return fail("Campo desconhecido.");
  } catch (e) {
    console.error("derivado: voltar ao modelo", e);
    return fail("Não foi possível voltar ao modelo. Tente de novo.");
  }
  revalidatePath(`/painel/bots/${botId}`);
  return ok("Pronto: este campo voltou a seguir o modelo.");
}

/**
 * Excedente de um chatbot (revisão de preços, partes 3b e 4c): ligado, a cota cheia não para o
 * chatbot; cada atendimento a mais usa R$ 0,35 do crédito pré-pago da conta, até o teto do mês
 * (opcional: vazio = sem teto). O tamanho e o excedente só mudam pela service role (gatilho);
 * a sessão confere o chatbot e o escopo.
 */
export async function setBotOverage(botId: string, formData: FormData): Promise<ActionResult> {
  const ctx = await allowed("billing");
  if (!ctx) return fail(DENIED);
  const enabled = formData.get("enabled") === "on";
  const typed = text(formData.get("cap"));
  const cap = typed ? parseCapBrl(typed) : null;
  if (typed && cap === null) return fail(`O teto do mês vai de ${brlCents(OVERAGE_CAP_MIN_BRL)} a ${brlCents(OVERAGE_CAP_MAX_BRL)}. Deixe vazio para não ter teto.`);
  const supabase = await createClient();
  const { data: bot } = await supabase.from("bots").select("id").eq("id", botId).eq("is_demo", false).maybeSingle();
  if (!bot) return fail("Chatbot não encontrado.");
  // a regra (só chatbot com IA tem excedente), a auditoria e o webhook ficam em billing-ops, como na API
  try {
    await setOverage(createAdminClient(), ctx.agency.id, botId, { enabled, capBrl: cap }, { type: "user", id: ctx.userId, meta: await requestMeta() });
  } catch (e) {
    if (e instanceof BillingOpError) return fail(e.message);
    throw e;
  }
  revalidatePath("/painel", "layout");
  if (!enabled) return ok("Excedente desligado: com a cota cheia, o chatbot entra no modo só humano.");
  const noCredit = (await creditBalance(createAdminClient(), ctx.agency.id)) < OVERAGE_PRICE_CENTS ? " A conta ainda não tem crédito: compre em Cobrança → Crédito." : "";
  return ok(
    cap
      ? `Excedente ligado: até ${num(overageMax(cap))} atendimentos a mais por mês (teto de ${brlCents(cap)}), pagos com o crédito da conta.${noCredit}`
      : `Excedente ligado, sem teto: cada atendimento a mais usa ${brlCents(0.35)} do crédito da conta.${noCredit}`,
  );
}

export async function setBotStatus(botId: string, status: "live" | "draft"): Promise<ActionResult> {
  if (!(await allowed("config"))) return fail(DENIED);
  const supabase = await createClient();
  if (status === "live") {
    // o chatbot da sessão (o escopo da pessoa); no derivado, a base do modelo também conta
    const { data: own } = await supabase.from("bots").select("id, template_id").eq("id", botId).maybeSingle();
    if (!own) return fail("Chatbot não encontrado.");
    if (!(await readySourceCount(createAdminClient(), { id: own.id as string, template_id: (own.template_id as string | null) ?? null }))) return fail("Adicione pelo menos uma fonte pronta antes de publicar.");
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
  let r: Awaited<ReturnType<typeof pauseBotNow>>;
  try {
    // a mesma pausa da API (bot-pause.ts): webhook bot.paused e roteiros em andamento encerrados
    r = await pauseBotNow(supabase, createAdminClient(), botId, { by: "panel", byLabel: `painel (${email})`, reason, notify: formData.get("notify") === "on" });
  } catch {
    return fail("Não foi possível pausar. Tente de novo.");
  }
  if (!r) return fail("Chatbot não encontrado.");
  if (r.already) return fail("Este chatbot já está pausado.");
  await auditPanel("bot.pausar", { type: "bot", id: botId }, { after: { reason, notify: formData.get("notify") === "on" } });
  revalidatePath(`/painel/bots/${botId}`);
  return ok("IA pausada. As próximas mensagens ficam para a sua equipe responder.");
}

export async function resumeBot(botId: string): Promise<ActionResult> {
  if (!(await allowed("config"))) return fail(DENIED);
  const supabase = await createClient();
  try {
    // webhooks: bot.resumed, só se estava pausado
    await resumeBotNow(supabase, createAdminClient(), botId, "panel");
  } catch {
    return fail("Não foi possível retomar. Tente de novo.");
  }
  await auditPanel("bot.retomar", { type: "bot", id: botId });
  revalidatePath(`/painel/bots/${botId}`);
  return ok("IA retomada. O assistente volta a responder a partir da próxima mensagem.");
}

/** Tira a faixa "veio de outra conta" (D', parte 5): quem cuida da configuração conferiu o chatbot. */
export async function markTransferReviewed(botId: string): Promise<ActionResult> {
  if (!(await allowed("config"))) return fail(DENIED);
  const supabase = await createClient();
  const { data, error } = await supabase.from("bots").update({ transfer_review_at: null }).eq("id", botId).not("transfer_review_at", "is", null).select("id");
  if (error) return fail("Não foi possível salvar. Tente de novo.");
  if (data?.length) await auditPanel("bot.transferencia_revisada", { type: "bot", id: botId });
  revalidatePath(`/painel/bots/${botId}`);
  return ok("Pronto: a faixa saiu.");
}

/** Converte uma demo em chatbot de verdade (mantém a base de conhecimento), ligado a um cliente. */
export async function convertDemo(botId: string, formData: FormData): Promise<ActionResult> {
  if (!(await allowed("config"))) return fail(DENIED);
  const { agency } = await requireAgency();
  const supabase = await createClient();
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
  // bot modelo (D'): com derivados, não sai (antes de apagar qualquer arquivo)
  const { count: derived } = await createAdminClient().from("bots").select("id", { count: "exact", head: true }).eq("template_id", botId);
  if (derived) return fail(`Este modelo tem ${derived} chatbot${derived === 1 ? "" : "s"} derivado${derived === 1 ? "" : "s"}. Exclua ${derived === 1 ? "o derivado" : "os derivados"} antes.`);
  // o bot leva junto conversas, mensagens e conexões (cascata); reaplicar apaga o bot de novo
  await logDeletion(createAdminClient(), "bots", [botId]);
  // arquivos no Storage (o Supabase não apaga objeto por SQL): os recebidos e os PDFs das fontes
  await purgeAttachments(createAdminClient(), { botId });
  await removeBotSourceFiles(createAdminClient(), botId);
  const { error, count } = await supabase.from("bots").delete({ count: "exact" }).eq("id", botId);
  if (error) return fail("Não foi possível excluir. Tente de novo.");
  if (!count) return fail("Chatbot não encontrado.");
  await auditPanel("bot.excluir", { type: "bot", id: botId });
  // o tamanho dele sai da próxima fatura (o mês corrente já foi pago)
  await syncSubscriptionSafe(createAdminClient(), (await requireAgency()).agency.id);
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

/**
 * Marca da agência (white-label). Só muda o que veio no formulário (redesenho, etapa 5: cada linha de
 * Marca e domínio tem o próprio modal, com um campo só).
 */
export async function updateAgency(formData: FormData): Promise<ActionResult> {
  if (!(await allowed("brand"))) return fail(DENIED);
  const { agency } = await requireAgency();
  const supabase = await createClient();
  const parsed = z
    .object({ name: z.string().trim().min(2, "Nome muito curto.").max(80).optional(), brand_color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Cor inválida.").optional(), support_whatsapp: z.string().max(30).optional(), logo_url: z.string().max(400).optional() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const d = parsed.data;
  const patch: Record<string, string | null> = {};
  if (d.name !== undefined) Object.assign(patch, { name: d.name, slug: agencySlug(agency.slug, d.name) });
  if (d.brand_color !== undefined) patch.brand_color = d.brand_color;
  if (d.support_whatsapp !== undefined) {
    const digits = d.support_whatsapp.replace(/\D/g, "");
    if (digits && (digits.length < 10 || digits.length > 15)) return fail("Use o WhatsApp com o DDD (ex.: 41 99999-9999).");
    patch.support_whatsapp = digits ? (canonicalPhone(digits, { typed: true }) ?? digits) : null;
  }
  if (d.logo_url !== undefined) patch.logo_url = d.logo_url || null;
  if (!Object.keys(patch).length) return ok("Nada mudou.");
  const { error } = await supabase.from("agencies").update(patch).eq("id", agency.id);
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
  // foto ou PDF junto (até 4 MB) e a citação (Conversa mais natural)
  const up = await agentUpload(formData.get("file"));
  if (!up.ok) return fail(up.message);
  const r = await postAgentMessage(owned.admin, conversationId, text(formData.get("content")), await me(), { replyToId: Number(formData.get("reply_to_id")) || null, upload: up.upload });
  revalidatePath(`/painel/bots/${owned.conv.bot_id}/conversas/${conversationId}`);
  return r;
}

/** O botão para quem conversa pelo nome de usuário compartilhar o número (só no WhatsApp). */
export async function requestContactPhone(conversationId: string): Promise<ActionResult> {
  if (!(await allowed("attend"))) return fail(DENIED);
  const owned = await ownedConversation(conversationId);
  if (!owned) return fail("Conversa não encontrada.");
  const r = await requestPhoneAsAgent(owned.admin, conversationId, await me());
  revalidatePath(`/painel/bots/${owned.conv.bot_id}/conversas/${conversationId}`);
  return r;
}

/** Reação da equipe a uma mensagem do contato (WhatsApp e Instagram); o mesmo emoji tira. */
export async function reactToMessage(conversationId: string, messageId: number, emoji: string | null): Promise<ActionResult> {
  if (!(await allowed("attend"))) return fail(DENIED);
  const owned = await ownedConversation(conversationId);
  if (!owned) return fail("Conversa não encontrada.");
  const r = await reactAsAgent(owned.admin, conversationId, messageId, emoji, await me());
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

/** Faixa "IA pausada pela integração": devolve para a IA antes do prazo (ela responde a pergunta pendente). */
export async function resumeConversationAiFromPanel(conversationId: string): Promise<ActionResult> {
  if (!(await allowed("attend"))) return fail(DENIED);
  const owned = await ownedConversation(conversationId);
  if (!owned) return fail("Conversa não encontrada.");
  const who = await me();
  const resumed = await resumeConversationAi(owned.admin, conversationId, { reason: "agent_resumed", agent: { id: who.id, name: who.name, type: who.type }, background: true });
  if (resumed) await auditPanel("conversa.retomar_ia", { type: "conversation", id: conversationId });
  revalidatePath(`/painel/bots/${owned.conv.bot_id}/conversas/${conversationId}`);
  return ok(resumed ? "A IA voltou a responder esta conversa." : "A pausa da integração já tinha acabado.");
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

const revalidateConversation = (botId: string, conversationId: string) => {
  revalidatePath(`/painel/bots/${botId}/conversas/${conversationId}`);
  revalidatePath("/painel/caixa");
};

/** Transferir (Caixa de entrada, parte 4): para outra pessoa ou para um setor, com nota interna. */
export async function transferConversationAction(conversationId: string, formData: FormData): Promise<ActionResult> {
  if (!(await allowed("attend"))) return fail(DENIED);
  const owned = await ownedConversation(conversationId);
  if (!owned) return fail("Conversa não encontrada.");
  const target = parseTarget(formData.get("para"));
  if (!target) return fail("Escolha para quem transferir.");
  const r = await transferConversation(owned.admin, conversationId, await me(), target, formData.get("nota"));
  if (r.ok) await auditPanel("conversa.transferir", { type: "conversation", id: conversationId }, { after: { para: r.toLabel ?? null } });
  revalidateConversation(owned.conv.bot_id, conversationId);
  return r.ok ? ok(r.message) : fail(r.message);
}

/** Nota interna na conversa: só a equipe vê. */
export async function addConversationNote(conversationId: string, formData: FormData): Promise<ActionResult> {
  if (!(await allowed("attend"))) return fail(DENIED);
  const owned = await ownedConversation(conversationId);
  if (!owned) return fail("Conversa não encontrada.");
  const r = await addNote(owned.admin, conversationId, formData.get("nota"), await me());
  if (r.ok) await auditPanel("conversa.nota", { type: "conversation", id: conversationId });
  revalidateConversation(owned.conv.bot_id, conversationId);
  return r;
}

/** Adiar: a conversa sai das filas até a data (ou até o contato escrever). */
export async function snoozeConversationAction(conversationId: string, formData: FormData): Promise<ActionResult> {
  if (!(await allowed("attend"))) return fail(DENIED);
  const owned = await ownedConversation(conversationId);
  if (!owned) return fail("Conversa não encontrada.");
  const until = snoozeTarget(formData.get("ate"), formData.get("data"));
  if (!(until instanceof Date)) return fail(until.error);
  const r = await snoozeConversation(owned.admin, conversationId, await me(), until);
  if (r.ok) await auditPanel("conversa.adiar", { type: "conversation", id: conversationId }, { after: { ate: until.toISOString() } });
  revalidateConversation(owned.conv.bot_id, conversationId);
  return r;
}

/** O status do chamado do site (Chamados, parte 7c). */
export async function setTicketStatusAction(conversationId: string, formData: FormData): Promise<ActionResult> {
  if (!(await allowed("attend"))) return fail(DENIED);
  const owned = await ownedConversation(conversationId);
  if (!owned) return fail("Conversa não encontrada.");
  const status = String(formData.get("status") ?? "");
  const r = await setTicketStatus(owned.admin, conversationId, status, new Date(), await me());
  if (r.ok && r.before !== undefined) await auditPanel("chamado.status", { type: "conversation", id: conversationId }, { before: { status: r.before }, after: { status } });
  revalidateConversation(owned.conv.bot_id, conversationId);
  return r.ok ? ok(r.message) : fail(r.message);
}

export async function unsnoozeConversationAction(conversationId: string): Promise<ActionResult> {
  if (!(await allowed("attend"))) return fail(DENIED);
  const owned = await ownedConversation(conversationId);
  if (!owned) return fail("Conversa não encontrada.");
  const r = await unsnoozeConversation(owned.admin, conversationId, await me());
  if (r.ok) await auditPanel("conversa.tirar_adiamento", { type: "conversation", id: conversationId });
  revalidateConversation(owned.conv.bot_id, conversationId);
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

/** Regra do preço de post do Instagram (E1, parte 1): citar a data (padrão), limite de dias ou sempre informar. */
export async function setPostPriceRule(botId: string, formData: FormData): Promise<ActionResult> {
  if (!(await allowed("config"))) return fail(DENIED);
  const rule = String(formData.get("post_price_rule") ?? "");
  if (rule !== "citar" && rule !== "limite" && rule !== "sempre") return fail("Escolha uma das opções.");
  const days = Number(formData.get("post_price_max_days") ?? 30);
  if (rule === "limite" && (!Number.isInteger(days) || days < 1 || days > 365)) return fail("Escolha de 1 a 365 dias.");
  const supabase = await createClient();
  const { data, error } = await supabase.from("bots").update({ post_price_rule: rule, ...(rule === "limite" ? { post_price_max_days: days } : {}) }).eq("id", botId).select("id");
  if (error || !data?.length) return fail("Não foi possível salvar. Tente de novo.");
  revalidatePath(`/painel/bots/${botId}`);
  return ok(rule === "citar" ? "Pronto: o assistente cita a data do post e confirma a disponibilidade com a equipe." : rule === "limite" ? `Pronto: o preço de post com mais de ${days} dias não é informado.` : "Pronto: o assistente informa o preço do post, com a data.");
}

/** Pesquisa de satisfação do chatbot (Lançamento, parte 4): liga ou desliga. */
export async function setSatisfactionSurvey(botId: string, formData: FormData): Promise<ActionResult> {
  if (!(await allowed("config"))) return fail(DENIED);
  const on = formData.get("satisfaction_survey") === "on";
  const supabase = await createClient();
  const { data, error } = await supabase.from("bots").update({ satisfaction_survey: on }).eq("id", botId).eq("is_demo", false).select("id");
  if (error) return fail("Não foi possível salvar. Tente de novo.");
  if (!data?.length) return fail("Chatbot não encontrado.");
  await auditPanel("bot.pesquisa", { type: "bot", id: botId }, { after: { satisfaction_survey: on } });
  revalidatePath(`/painel/bots/${botId}`);
  return ok(on ? "Pesquisa ligada: sai no fim do atendimento e depois de 30 minutos de conversa parada com a IA." : "Pesquisa de satisfação desligada.");
}

/** Aviso do momento do chatbot (Lançamento, parte 3): o texto com prazo que a IA usa quando perguntam. */
export async function saveMomentNotice(botId: string, formData: FormData): Promise<ActionResult> {
  if (!(await allowed("config"))) return fail(DENIED);
  const p = parseMomentNotice(formData);
  if (!p.ok) return fail(p.message);
  const supabase = await createClient();
  const { error, count } = await supabase.from("bots").update({ moment_notice: p.value.text, moment_notice_until: p.value.until, moment_notice_by: "agência" }, { count: "exact" }).eq("id", botId);
  if (error || !count) return fail("Não foi possível salvar o aviso. Tente de novo.");
  await auditPanel("bot.aviso_momento", { type: "bot", id: botId }, { after: { ate: p.value.until } });
  revalidatePath(`/painel/bots/${botId}`);
  return ok(`Aviso no ar até ${untilLabel(p.value.until)}.`);
}

/**
 * O que a IA sabe da loja (o display do chatbot, D' parte 4a), na Base de conhecimento (redesenho,
 * etapa 5: saiu da aba Ações, junto do contexto fixo). Quem mexe na base salva; vazio tira.
 */
export async function saveBotDisplay(botId: string, formData: FormData): Promise<ActionResult> {
  if (!(await allowed("config"))) return fail(DENIED);
  const raw = text(formData.get("fixed_display"));
  let parsed: unknown = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return fail('Os dados da loja precisam ser um JSON, como {"nome": "Pizzaria do Zé, Centro"}.');
    }
  }
  const d = parseBotDisplay(parsed);
  if ("error" in d) return fail(d.error);
  const supabase = await createClient();
  const { error, count } = await supabase.from("bots").update({ fixed_display: d.value }, { count: "exact" }).eq("id", botId).eq("is_demo", false);
  if (error || !count) return fail("Não foi possível salvar. Tente de novo.");
  await auditPanel("bot.dados_loja", { type: "bot", id: botId }, { after: { chaves: d.value ? Object.keys(d.value) : [] } });
  revalidatePath(`/painel/bots/${botId}`);
  return ok(d.value ? "Salvo: a IA já usa esses dados nas respostas." : "Dados da loja tirados.");
}

/** Tira o aviso do momento antes do prazo. */
export async function clearMomentNotice(botId: string): Promise<ActionResult> {
  if (!(await allowed("config"))) return fail(DENIED);
  const supabase = await createClient();
  const { error } = await supabase.from("bots").update({ moment_notice: null, moment_notice_until: null, moment_notice_by: null }).eq("id", botId);
  if (error) return fail("Não foi possível tirar o aviso. Tente de novo.");
  await auditPanel("bot.aviso_momento_apagar", { type: "bot", id: botId });
  revalidatePath(`/painel/bots/${botId}`);
  return ok("Aviso tirado.");
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
  // liberação da agência (backoffice) ou a abertura geral do canal
  const locked = await channelBlock(createAdminClient(), agency.id, "whatsapp");
  if (locked) return fail(locked);
  const supabase = await createClient();
  const { data: bot } = await supabase.from("bots").select("id, is_demo, client_id").eq("id", botId).maybeSingle();
  if (!bot) return fail("Chatbot não encontrado.");
  if (bot.is_demo) return fail("Converta a demo em chatbot antes de ligar o WhatsApp.");
  // canal só com tamanho (Atendimento, sem IA, ou com IA)
  const unsized = await sizeRequiredBlock(createAdminClient(), botId);
  if (unsized) return fail(unsized);
  if (!whatsappConfigured()) return fail("O WhatsApp ainda não está configurado no servidor (WHATSAPP_TOKEN).");
  // tela única de aceite: o negócio aceita antes de conectar (e não pode estar bloqueado ou aguardando revisão)
  const blocked = await connectBlockFor(createAdminClient(), { clientId: bot.client_id as string | null, channel: "whatsapp" });
  if (blocked) return fail(blocked);

  const phoneNumberId = text(formData.get("phone_number_id")).replace(/\D/g, "");
  const wabaId = text(formData.get("waba_id")).replace(/\D/g, "") || null;
  if (phoneNumberId.length < 8) return fail("Cole o Phone number ID (só números), que aparece na configuração da API do app na Meta.");
  if (!canLinkWhatsAppById((await requireAgency()).email, phoneNumberId)) return fail("Ligar pelo ID vale só para o número de teste do app da Meta. Conecte pelo botão da Meta.");

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
  await queueChannelEvent(admin, botId, "connected", { type: "whatsapp", phoneNumberId, display: phone.display_phone_number ?? null }, { at: new Date().toISOString() });
  await carryWhatsAppPreferences(admin, botId, wabaId);
  await confirmAcceptance(admin, { clientId: bot.client_id as string, channel: "whatsapp", metaAccount: wabaId ?? phoneNumberId, metaVerifiedName: phone.verified_name ?? null });
  // modelo padrão de retomada (utilidade, pt_BR), quando a conta do WhatsApp veio junto
  if (wabaId) await ensureResumeTemplate({ phone_number_id: phoneNumberId, waba_id: wabaId, access_token_enc: null }, String((await admin.from("bots").select("client_name").eq("id", botId).maybeSingle()).data?.client_name ?? ""));
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
    // webhooks: a primeira resposta de atividades pode pôr o negócio em revisão (compliance.changed)
    status = await trackCompliance(admin, [bot.client_id as string], "atividades", () => recordAcceptance(admin, {
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
    }));
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
  const locked = await channelBlock(createAdminClient(), agency.id, channel);
  if (locked) return { ok: false, message: locked };
  const supabase = await createClient();
  const { data: bot } = await supabase.from("bots").select("id, is_demo").eq("id", botId).maybeSingle();
  if (!bot) return { ok: false, message: "Chatbot não encontrado." };
  // canal só com tamanho (Atendimento, sem IA, ou com IA)
  const unsized = await sizeRequiredBlock(createAdminClient(), botId);
  if (unsized) return { ok: false, message: unsized };
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
  const { data: bot } = await supabase.from("bots").select("id, persona, is_demo, template_id").eq("id", botId).maybeSingle();
  if (!bot || bot.is_demo) return fail("Chatbot não encontrado.");
  const count = await readySourceCount(createAdminClient(), { id: botId, template_id: (bot.template_id as string | null) ?? null });
  const problem = analysisContentProblem(count, (bot.persona as { instructions?: string } | null)?.instructions);
  if (problem) return fail(problem);
  const admin = createAdminClient();
  const exceeded = await firstExceeded(admin, [{ key: `analise:${botId}`, max: 3, windowSeconds: 3600, message: "Muitas análises seguidas. Tente de novo daqui a pouco." }]);
  if (exceeded) return fail(exceeded.message);
  try {
    const r = await analyzeBot(admin, botId);
    revalidatePath(`/painel/bots/${botId}`);
    if (r.status === "aguardando_classificacao") return fail("A base ainda está sendo lida. Tente de novo em alguns minutos.");
    if (r.status === "sem_base") return fail("Adicione pelo menos uma fonte pronta antes de analisar.");
    if (r.status === "ignorado") return fail("A análise roda quando o chatbot tem um tamanho com IA.");
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

/**
 * Perfil do WhatsApp sem contato de suporte (Diagnóstico do número): grava o e-mail e o site
 * direto no perfil da Meta. Fora da coexistência (lá o perfil é editado no app do celular).
 */
export async function saveWhatsAppProfile(botId: string, formData: FormData): Promise<ActionResult> {
  if (!(await allowed("config"))) return fail(DENIED);
  const supabase = await createClient();
  const { data: bot } = await supabase.from("bots").select("id").eq("id", botId).maybeSingle();
  if (!bot) return fail("Chatbot não encontrado.");
  const email = String(formData.get("email") ?? "").trim();
  let site = String(formData.get("site") ?? "").trim();
  if (!email && !site) return fail("Informe um e-mail ou um site de contato.");
  if (email && !isEmail(email)) return fail("E-mail inválido.");
  if (site && !/^https?:\/\//i.test(site)) site = `https://${site}`;
  if (site && !/^https?:\/\/[^\s/]+\.[^\s/]+/i.test(site)) return fail("Site inválido (ex.: https://www.minhaloja.com.br).");
  const admin = createAdminClient();
  const { data: ch } = await admin.from("whatsapp_channels").select("phone_number_id, waba_id, access_token_enc, coexistence").eq("bot_id", botId).maybeSingle();
  if (!ch) return fail("Este chatbot não tem WhatsApp conectado.");
  if (ch.coexistence) return fail("Neste número o perfil é editado no app WhatsApp Business do celular.");
  try {
    await updateBusinessProfile(ch, { ...(email ? { email } : {}), ...(site ? { websites: [site] } : {}) });
  } catch (e) {
    return fail(e instanceof WhatsAppError ? `A Meta recusou: ${e.message}` : "Não consegui gravar na Meta agora. Tente de novo em alguns minutos.");
  }
  await auditPanel("canal.perfil_whatsapp", { type: "bot", id: botId });
  revalidatePath(`/painel/bots/${botId}`);
  return ok("Perfil atualizado na Meta.");
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
  const locked = await channelBlock(createAdminClient(), agency.id, "whatsapp");
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
async function sendApprovedTemplate(botId: string, ch: TemplateChannel, to: string, formData: FormData): Promise<{ text: string; category: string; wamid: string | null } | { error: string }> {
  // regra de estado: ordem da Meta, desligamento geral ou suspensão pela BoaVoz
  const blocked = await sendBlockedReason(createAdminClient(), botId, "whatsapp");
  if (blocked) return { error: `${blocked} O modelo não foi enviado.` };
  let templates;
  try {
    templates = await listSendable(ch, { marketing: true });
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
  // marketing pelo painel (leva B3): só para quem aceitou novidades deste número e não disse que é menor
  if (t.category.toUpperCase() === "MARKETING") {
    const target = { scope: suppressionScope({ wabaId: ch.waba_id, botId }), contact: to };
    if (consentStateOf(await consentHistory(createAdminClient(), target, 1)) !== "granted") return { error: "Este contato não aceitou receber novidades deste número. Modelo de marketing só vai para quem aceitou; use um modelo de utilidade." };
    if ((await getAge(createAdminClient(), { botId, channel: "whatsapp", contact: to })) === "nao") return { error: "Este contato disse que não tem 18 anos: modelo de marketing não vai para ele." };
  }
  let wamid: string | null;
  try {
    wamid = (await sendTemplate(ch, to, t, params)).messages?.[0]?.id ?? null;
  } catch (e) {
    return { error: `O WhatsApp não aceitou o envio: ${await metaError(botId, e)}` };
  }
  return { text: renderTemplate(t.body, params), category: t.category, wamid };
}

/** Grava o modelo enviado como resposta da equipe e atualiza a conversa. */
async function recordTemplateMessage(admin: ReturnType<typeof createAdminClient>, conversationId: string, content: string, category: string, wamid: string | null) {
  // a categoria decide o alcance de um SAIR respondido depois (descadastro da categoria do último modelo)
  try {
    await saveMessage(admin, { conversation_id: conversationId, role: "agent", content, ...attendantAuthor(await me()), template_category: category, channel_msg_id: "enviada", channel_msg_hash: wamid ? channelMsgHash("whatsapp", wamid) : null, channel_msg_ref: wamid }, { touch: "equipe" });
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
  // marketing (leva B3): só sai em campanha para quem aceitou novidades
  const category = text(formData.get("category")) === "MARKETING" ? "MARKETING" : "UTILITY";
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
  await recordTemplateMessage(owned.admin, conversationId, sent.text, sent.category, sent.wamid);
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
  await recordTemplateMessage(admin, conversationId, sent.text, sent.category, sent.wamid);
  revalidatePath(`/painel/bots/${botId}`);
  redirect(`/painel/bots/${botId}/conversas/${conversationId}`);
}

/* ------------------------------------------------------------------ domínio próprio */

/**
 * Mudanças que pedem o segundo fator fora da Segurança (relatório de segurança de 23/10/2026, A3 e
 * A4): o domínio próprio, o modo dados sensíveis e a equipe. A Segurança pede o código ao abrir.
 */
const MFA_FIRST = "Esta mudança pede a verificação em duas etapas: abra Configurações → Segurança e auditoria (ela pede o código do app autenticador) e tente de novo.";

/** Salva (ou remove) o domínio próprio. Trocar de domínio exige verificar de novo. */
export async function saveCustomDomain(formData: FormData): Promise<ActionResult> {
  if (!(await allowed("brand"))) return fail(DENIED);
  const { agency, packs } = await requireAgency();
  if (!packs.includes("dominio")) return fail(NEEDS_DOMAIN);
  if (!(await hasMfa())) return fail(MFA_FIRST);
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
  // o domínio só sai pelo servidor (0174): a sessão não grava custom_domain nem a verificação
  const { error } = await createAdminClient().from("agencies").update({ custom_domain: domain, custom_domain_verified_at: null }).eq("id", agency.id);
  if (error) return fail(error.code === "23505" ? "Este domínio já está cadastrado em outra conta." : "Não foi possível salvar o domínio.");
  if (agency.custom_domain) await removeDomainFromProject(agency.custom_domain);
  revalidatePath("/painel", "layout");
  return ok(domain ? "Domínio salvo. Agora crie o registro DNS abaixo e clique em Verificar." : "Domínio removido. Os links voltam a usar o endereço padrão.");
}

/** Confere se o domínio já responde por nós; se sim, os links passam a usá-lo. */
export async function verifyCustomDomain(): Promise<ActionResult> {
  if (!(await allowed("brand"))) return fail(DENIED);
  const { agency, packs } = await requireAgency();
  if (!packs.includes("dominio")) return fail(NEEDS_DOMAIN);
  if (!agency.custom_domain) return fail("Cadastre um domínio primeiro.");
  if (!(await hasMfa())) return fail(MFA_FIRST);
  const status = await checkDomain(agency.custom_domain);
  if (!status.live) return fail(status.message);
  await createAdminClient().from("agencies").update({ custom_domain_verified_at: new Date().toISOString() }).eq("id", agency.id).eq("custom_domain", agency.custom_domain);
  revalidatePath("/painel", "layout");
  return ok("Domínio verificado! Demos, portal do cliente e código do widget já usam ele.");
}

/* ------------------------------------------------------------------ acesso do cliente final */

/** Liga/desliga o que as pessoas do cliente podem fazer na área do cliente. */
export async function setClientPermissions(clientId: string, formData: FormData): Promise<ActionResult> {
  if (!(await allowed("config"))) return fail(DENIED);
  const supabase = await createClient();
  const patch = { allow_handoff: formData.get("allow_handoff") === "on", allow_knowledge: formData.get("allow_knowledge") === "on", allow_hours: formData.get("allow_hours") === "on", handoff_notify: formData.get("handoff_notify") === "client" ? "client" : "all" };
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
  const role = isPortalRole(formData.get("role")) ? (formData.get("role") as PortalRole) : "manager";
  const { error } = await ctx.supabase.from("client_members").insert({ client_id: clientId, email, role });
  if (error) return fail(error.code === "23505" ? "Esse e-mail já tem acesso." : "Não foi possível adicionar. Tente de novo.");
  await auditPanel("portal.pessoa_adicionar", { type: "client", id: clientId }, { after: { email, papel: PORTAL_ROLE_LABELS[role].toLowerCase() } });
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

/** Papel de uma pessoa do portal: gestor (tudo o que a agência liberou) ou atendente (só conversas). */
/** O papel pelo "…" da linha (redesenho, 23/10/2026): o mesmo do formulário, com o papel já escolhido. */
export async function setClientMemberRoleTo(clientId: string, memberId: string, role: string): Promise<ActionResult> {
  const fd = new FormData();
  fd.set("role", role);
  return setClientMemberRole(clientId, memberId, fd);
}

export async function setClientMemberRole(clientId: string, memberId: string, formData: FormData): Promise<ActionResult> {
  if (!(await allowed("config"))) return fail(DENIED);
  const role = formData.get("role");
  if (!isPortalRole(role)) return fail("Escolha o papel.");
  const supabase = await createClient();
  const { data: before } = await supabase.from("client_members").select("email, role").eq("id", memberId).eq("client_id", clientId).maybeSingle();
  if (!before) return fail("Pessoa não encontrada.");
  if (before.role === role) return ok("Nada mudou.");
  const { error } = await supabase.from("client_members").update({ role }).eq("id", memberId).eq("client_id", clientId);
  if (error) return fail("Não foi possível salvar. Tente de novo.");
  await auditPanel("portal.papel", { type: "client", id: clientId }, { before: { email: before.email, papel: before.role }, after: { papel: role } });
  revalidatePath(`/painel/clientes/${clientId}`);
  return ok(`${before.email} agora é ${PORTAL_ROLE_LABELS[role].toLowerCase()}. Vale na próxima página que a pessoa abrir.`);
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

const ERASE_NOTHING = "Nenhum dado encontrado para esse contato.";

/**
 * O que o pedido de titular apaga para esse e-mail ou telefone, nos chatbots do cliente: as fichas,
 * os leads e as conversas (as das fichas e as dos leads). O telefone vai com o DDD: sem ele, o
 * número de outra cidade entrava junto (relatório de segurança de 23/10/2026, M2).
 */
async function contactErasure(clientId: string, raw: string): Promise<{ ok: false; message: string } | { ok: true; byEmail: boolean; contactIds: string[]; leads: Array<{ id: string; conversation_id: string | null }>; leadConvs: string[]; conversations: number }> {
  const contact = raw.trim().toLowerCase();
  const byEmail = isEmail(contact);
  if (!byEmail && digitsOf(contact).length < 10) return { ok: false, message: "Informe um e-mail ou o telefone com DDD." };
  const supabase = await createClient();
  const { data: bots } = await supabase.from("bots").select("id").eq("client_id", clientId);
  const ids = (bots ?? []).map((b) => b.id);
  if (!ids.length) return { ok: true, byEmail, contactIds: [], leads: [], leadConvs: [], conversations: 0 };
  // telefone: pelo hash do número canônico e comparando o número inteiro com DDD (com ou sem +55)
  const ph = byEmail ? null : typedPhoneHash(contact);
  const leads = await findLeadsByContact(supabase, ids, byEmail ? { email: contact } : { phone: contact, phoneHash: ph });
  const admin = createAdminClient();
  // a ficha do contato (WhatsApp, pelo telefone canônico em hash, ou pelo e-mail): a rotina apaga todas as conversas dela
  const contactIds = byEmail ? await findContactIds(admin, ids, { email: contact }) : ph ? await findContactIds(admin, ids, { phoneHash: ph }) : [];
  const leadConvs = leads.map((l) => l.conversation_id).filter((c): c is string => Boolean(c));
  const convs = new Set(leadConvs);
  if (contactIds.length) {
    const { data } = await admin.from("conversations").select("id").in("contact_id", contactIds);
    for (const c of data ?? []) convs.add(c.id as string);
  }
  return { ok: true, byEmail, contactIds, leads, leadConvs, conversations: convs.size };
}

const eraseCount = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const eraseSummary = (e: { contactIds: string[]; leads: unknown[]; conversations: number }) =>
  `${eraseCount(e.conversations, "conversa", "conversas")}, ${eraseCount(e.leads.length, "lead", "leads")} e ${eraseCount(e.contactIds.length, "ficha de contato", "fichas de contato")}`;
const eraseKey = (e: { contactIds: string[]; leads: unknown[]; conversations: number }) => `${e.contactIds.length}:${e.leads.length}:${e.conversations}`;

/** A prévia do pedido de titular: quanto sai, antes de confirmar (não apaga nada). */
export async function previewContactErasure(clientId: string, contact: string): Promise<{ ok: false; message: string } | { ok: true; summary: string; expected: string; empty: boolean }> {
  if (!(await allowed("security"))) return { ok: false, message: DENIED };
  const e = await contactErasure(clientId, contact);
  if (!e.ok) return e;
  const empty = !e.contactIds.length && !e.leads.length;
  return { ok: true, summary: empty ? ERASE_NOTHING : `Vai apagar ${eraseSummary(e)}.`, expected: eraseKey(e), empty };
}

/**
 * Pedido de titular (LGPD): apaga todos os contatos com esse e-mail ou telefone nos chatbots
 * do cliente, e as conversas em que foram capturados. Só com a prévia conferida: o que vai sair
 * precisa bater com o que a tela mostrou (sem desfazer).
 */
export async function eraseContactData(clientId: string, formData: FormData): Promise<ActionResult> {
  if (!(await allowed("security"))) return fail(DENIED);
  const e = await contactErasure(clientId, text(formData.get("contact")));
  if (!e.ok) return fail(e.message);
  const { byEmail, contactIds, leads: matches, leadConvs } = e;
  if (!matches.length && !contactIds.length) return ok(ERASE_NOTHING);
  if (text(formData.get("expected")) !== eraseKey(e)) return fail(`Confira antes de apagar: agora vai apagar ${eraseSummary(e)}, diferente da prévia. Digite o contato de novo para conferir.`);

  // rotina única do pedido do titular (a mesma do chat): entregas e logs, perguntas, leads, conversas,
  // 18+, supressão e ficha, tudo no registro de exclusões; depois o contact.deleted e o pedido como prova
  const admin = createAdminClient();
  const { agency, userId } = await requireAgency();
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
export async function recordAgencyMfa(reported: boolean, enrolled: boolean): Promise<void> {
  const { agency, userId } = await requireAgency();
  // o navegador só diz que deu certo; vale se a sessão já está no segundo fator (relatório de segurança de 23/10/2026)
  const ok = reported && (await hasMfa());
  const meta = await requestMeta();
  await logAccess(createAdminClient(), { actorType: "user", actorId: userId, event: ok ? "login" : "login_failed", ip: meta.ip, userAgent: meta.userAgent, agencyId: agency.id });
  if (ok && enrolled) await auditPanel("seguranca.mfa_cadastrar", { type: "agency", id: agency.id });
  // quem tem o app não precisa da recuperação: o pedido em aberto cai
  if (ok) await cancelOnVerified(createAdminClient(), userId);
}

/** Perdi o app autenticador: o pedido de recuperação pelo suporte (o link de confirmação vai por e-mail). */
export async function requestAgencyMfaRecovery(fd: FormData): Promise<ActionResult> {
  const { agency, userId, email } = await requireAgency();
  const r = await requestRecovery(createAdminClient(), { userId, email, area: "painel", agencyId: agency.id }, { reason: text(fd.get("reason")), ...(await requestMeta()) });
  if (!r.ok) return fail(RECOVERY_PROBLEM[r.problem]);
  revalidatePath("/painel/verificar/recuperar");
  return ok(`Pronto: o link para confirmar foi para ${email} e vale ${RECOVERY_CONFIRM_HOURS} horas.`);
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

/**
 * Segurança → Excluir a conta: só o dono, com o segundo fator e o nome da conta digitado. A
 * exclusão acontece 7 dias depois (evento grave: e-mail e faixa para quem cuida da Segurança).
 */
export async function requestAccountDeletionAction(formData: FormData): Promise<ActionResult> {
  // só o dono (a permissão da cobrança é só dele)
  const ctx = await allowed("billing");
  if (!ctx) return fail("Só o dono da conta pode excluí-la.");
  if (!(await hasMfa())) return fail(MFA_NEEDED);
  const same = (v: string) => v.replace(/\s+/g, " ").trim().toLowerCase();
  if (same(text(formData.get("confirm_name"))) !== same(ctx.agency.name)) return fail(`Para confirmar, digite o nome da conta: ${ctx.agency.name}.`);
  const r = await requestAccountDeletion(createAdminClient(), { agencyId: ctx.agency.id, userId: ctx.userId });
  if (!r.ok) return fail(r.message);
  await auditPanel("conta.exclusao_pedida", { type: "agency", id: ctx.agency.id }, { after: { data: r.scheduledFor } });
  revalidatePath("/painel", "layout");
  return ok(`Pronto: a conta será excluída em ${dateBR(r.scheduledFor)}. Até lá, dá para desistir aqui.`);
}

/** Segurança → Excluir a conta: o dono desiste (a assinatura volta a renovar). */
export async function cancelAccountDeletionAction(): Promise<ActionResult> {
  const ctx = await allowed("billing");
  if (!ctx) return fail("Só o dono da conta pode desistir da exclusão.");
  if (!(await hasMfa())) return fail(MFA_NEEDED);
  const r = await cancelAccountDeletion(createAdminClient(), { agencyId: ctx.agency.id });
  if (!r.ok) return fail(r.message);
  await auditPanel("conta.exclusao_cancelada", { type: "agency", id: ctx.agency.id });
  revalidatePath("/painel", "layout");
  return ok("A exclusão foi cancelada: a conta continua como estava.");
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

/** Segurança: recusa um pedido do titular com o motivo (nada é apagado; a pessoa recebe o motivo). */
export async function refuseDataSubjectRequest(requestId: string, formData: FormData): Promise<ActionResult> {
  if (!(await allowed("security"))) return fail(DENIED);
  const { userId } = await requireAgency();
  if (!(await hasMfa())) return fail(MFA_NEEDED);
  const reason = text(formData.get("reason"));
  const problem = refuseReasonProblem(reason);
  if (problem) return fail(problem);
  const supabase = await createClient();
  // a RLS limita aos pedidos desta agência
  const { data: req } = await supabase.from("data_subject_requests").select("id, status").eq("id", requestId).maybeSingle();
  if (!req) return fail("Pedido não encontrado.");
  const r = await refuseRequest(createAdminClient(), requestId, userId, reason);
  if (!r) return ok("Este pedido já foi atendido ou recusado.");
  await auditPanel("titular.recusar", { type: "data_subject_request", id: requestId }, { after: { motivo: reason.slice(0, 200) } });
  revalidatePath("/painel/seguranca");
  return ok(r.told ? "Pedido recusado. A pessoa recebeu o motivo pelo canal." : "Pedido recusado. A janela de 24 horas fechou: avise a pessoa por outro meio, com o mesmo motivo.");
}

/** Política de privacidade (link no chat) e prazo de guarda dos dados dos visitantes. */
/** O link da política e o prazo de guarda; cada um só muda quando vem no formulário (são dois modais). */
export async function updatePrivacy(formData: FormData): Promise<ActionResult> {
  if (!(await allowed("security"))) return fail(DENIED);
  const { agency } = await requireAgency();
  if (formData.has("privacy_url")) {
    const url = text(formData.get("privacy_url"));
    if (url && !/^https?:\/\/[^\s]+\.[^\s]+$/i.test(url)) return fail("Use o endereço completo da política, começando com https://");
    if (url.length > 400) return fail("Endereço longo demais.");
    const supabase = await createClient();
    const { error } = await supabase.from("agencies").update({ privacy_url: url || null }).eq("id", agency.id);
    if (error) return fail("Não foi possível salvar. Tente de novo.");
    if (!formData.has("retention_months")) {
      revalidatePath("/painel", "layout");
      return ok(url ? "Link da política salvo." : "Link da política removido.");
    }
  }
  const months = Number(formData.get("retention_months"));
  if (!isRetentionMonths(months)) return fail("Escolha 6, 12 ou 24 meses.");
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

/**
 * Modo dados sensíveis de um chatbot, pela agência (dono e administrador): a mesma regra da área
 * do cliente. O negócio é o controlador: os gestores e o e-mail do relatório recebem o aviso.
 */
export async function setBotSensitiveMode(clientId: string, botId: string, formData: FormData): Promise<ActionResult> {
  if (!(await allowed("security"))) return fail(DENIED);
  if (!(await hasMfa())) return fail(MFA_FIRST);
  const { agency } = await requireAgency();
  const supabase = await createClient();
  // a RLS confere que o cliente e o chatbot são desta agência (e do escopo de quem está logado)
  const [{ data: client }, { data: bot }] = await Promise.all([
    supabase.from("clients").select("id, name, retention_months").eq("id", clientId).maybeSingle(),
    supabase.from("bots").select("id").eq("id", botId).eq("client_id", clientId).eq("is_demo", false).maybeSingle(),
  ]);
  if (!client || !bot) return fail("Chatbot não encontrado.");
  const r = await applySensitiveMode(createAdminClient(), { botId, on: formData.get("sensitive") === "on", days: Number(formData.get("days")), confirmed: formData.get("confirm") === "on", clientMonths: (client.retention_months as number | null) ?? null, agencyMonths: agency.retention_months });
  if (!r.ok) return fail(r.message);
  const c = r.change;
  await auditPanel("bot.modo_sensivel", { type: "bot", id: botId }, { before: c.before, after: { sensitive_mode: c.on, sensitive_retention_days: c.days } });
  if (c.toggled || c.reduced) {
    await notifyClientPeople(createAdminClient(), clientId, `${agency.name} ${c.on ? "ligou" : "desligou"} o modo dados sensíveis`, [
      `${agency.name} ${sensitiveChangeText(c)}.`,
      "",
      `Se não combinou essa mudança, fale com ${agency.name}. Você também pode mudar em Privacidade, na área do cliente.`,
    ]).catch(() => false);
  }
  revalidatePath(`/painel/clientes/${clientId}`);
  revalidatePath(`/painel/bots/${botId}`);
  return ok(sensitiveSavedText(c));
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
  // o widget mora no layout (redesenho, etapa 5): some em todo o painel
  revalidatePath("/painel", "layout");
  return ok("Primeiros passos ocultados. Para ver de novo: menu da sua conta → Primeiros passos.");
}

/** Mostra de novo os primeiros passos (o menu da conta e o Ctrl K): tira o cookie do Ocultar. */
export async function showOnboarding(): Promise<ActionResult> {
  (await cookies()).delete({ name: ONBOARDING_COOKIE, path: "/painel" });
  revalidatePath("/painel", "layout");
  return ok("Primeiros passos de volta.");
}

/* ------------------------------------------------------------------ limites do plano (leva B1', parte 4b) */

/* ------------------------------------------------------------------ novidades no WhatsApp (leva B3) */

/** Liga ou desliga a oferta de novidades do chatbot (WhatsApp, uma vez por contato). */
export async function setMarketingOptIn(botId: string, formData: FormData): Promise<ActionResult> {
  if (!(await allowed("config"))) return fail(DENIED);
  const on = formData.get("offer") === "on";
  const supabase = await createClient();
  // a RLS confere que o chatbot é desta agência (e do escopo de quem está logado)
  const { data, error } = await supabase.from("bots").update({ marketing_optin_offer: on }).eq("id", botId).eq("is_demo", false).select("id");
  if (error) return fail("Não foi possível salvar. Tente de novo.");
  if (!data?.length) return fail("Chatbot não encontrado.");
  await auditPanel("bot.novidades", { type: "bot", id: botId }, { after: { marketing_optin_offer: on } });
  revalidatePath(`/painel/bots/${botId}`);
  return ok(on ? "Pronto: o assistente oferece novidades uma vez a cada contato." : "Oferta de novidades desligada.");
}

/* ------------------------------------------------------------------ contatos do cliente (leva B3) */

/** Contato de um cliente que quem está logado pode ver (a RLS dá os chatbots do cliente). */
async function clientContact(clientId: string, contactId: string) {
  const supabase = await createClient();
  const { data: bots } = await supabase.from("bots").select("id, agency_id").eq("client_id", clientId).eq("is_demo", false);
  const botIds = (bots ?? []).map((b) => b.id as string);
  const contact = await contactForPanel(createAdminClient(), contactId, botIds);
  const bot = contact ? (bots ?? []).find((b) => b.id === contact.bot_id) : null;
  return contact && bot ? { contact, bot: { id: bot.id as string, agency_id: bot.agency_id as string }, botIds } : null;
}

/** Contato do WhatsApp do cliente com o escopo do consentimento (o número da conta, como a supressão). */
async function whatsappConsentTarget(clientId: string, contactId: string) {
  const found = await clientContact(clientId, contactId);
  if (!found) return { error: "Contato não encontrado." } as const;
  const number = found.contact.phone ?? found.contact.bsuid;
  if (found.contact.channel !== "whatsapp" || !number) return { error: "Novidades valem só para contatos do WhatsApp." } as const;
  const { data: wa } = await createAdminClient().from("whatsapp_channels").select("waba_id").eq("bot_id", found.bot.id).maybeSingle();
  const wabaId = (wa?.waba_id as string | null | undefined) ?? null;
  return { ...found, number, wabaId, target: { scope: suppressionScope({ wabaId, botId: found.bot.id }), contact: number } };
}

export async function saveContactTags(clientId: string, contactId: string, formData: FormData): Promise<ActionResult> {
  if (!(await allowed("config"))) return fail(DENIED);
  const found = await clientContact(clientId, contactId);
  if (!found) return fail("Contato não encontrado.");
  const tags = normalizeTags(text(formData.get("tags")));
  await setContactTags(createAdminClient(), contactId, found.botIds, tags);
  await auditPanel("contato.etiquetas", { type: "contact", id: contactId }, { before: { tags: found.contact.tags }, after: { tags } });
  revalidatePath(`/painel/clientes/${clientId}/contatos/${contactId}`);
  return ok("Etiquetas salvas.");
}

/** Apaga a memória do assistente sobre o contato (leva Memória e avisos, parte 1). */
export async function clearContactMemoryAction(clientId: string, contactId: string): Promise<ActionResult> {
  if (!(await allowed("config"))) return fail(DENIED);
  const found = await clientContact(clientId, contactId);
  if (!found) return fail("Contato não encontrado.");
  await saveContactMemory(createAdminClient(), { id: contactId, botId: found.contact.bot_id }, []);
  await auditPanel("contato.memoria_apagada", { type: "contact", id: contactId });
  revalidatePath(`/painel/clientes/${clientId}/contatos/${contactId}`);
  return ok("Memória apagada: o assistente não lembra mais desta pessoa.");
}

/** O fuso do cliente (o horário marcado e as réguas são lidos nele). */
async function clientTimezone(clientId: string): Promise<string> {
  const { data } = await createAdminClient().from("clients").select("timezone").eq("id", clientId).maybeSingle();
  return (data?.timezone as string | null) ?? DEFAULT_TIMEZONE;
}

/**
 * As datas das réguas pela ficha do contato (leva Réguas, parte 1): o aniversário (dia e mês), a
 * última visita e o próximo horário, lido no fuso do cliente. Campo vazio apaga.
 */
export async function saveContactDates(clientId: string, contactId: string, formData: FormData): Promise<ActionResult> {
  if (!(await allowed("config"))) return fail(DENIED);
  const found = await clientContact(clientId, contactId);
  if (!found) return fail("Contato não encontrado.");
  const dates = contactDatesFromForm({ birthday: text(formData.get("birthday")), lastVisit: text(formData.get("last_visit")), appointment: text(formData.get("appointment")) }, await clientTimezone(clientId));
  if ("error" in dates) return fail(dates.error);
  // as datas novas do chatbot do contato (régua personalizada): campo vazio apaga
  const admin = createAdminClient();
  const custom: Record<string, string | null> = {};
  for (const f of await listDateFields(admin, [found.bot.id])) {
    const raw = text(formData.get(`custom_${f.key}`));
    if (raw && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return fail(`${f.label}: data inválida.`);
    custom[f.key] = raw || null;
  }
  await setContactDates(admin, [contactId], found.botIds, dates);
  await setContactCustomDates(admin, [contactId], found.botIds, custom);
  // na auditoria, só quais datas ficaram preenchidas (são dados do contato)
  await auditPanel("contato.datas", { type: "contact", id: contactId }, { after: { preenchidas: [...Object.entries(dates).filter(([, v]) => v).map(([k]) => k), ...Object.entries(custom).filter(([, v]) => v).map(([k]) => k)] } });
  revalidatePath(`/painel/clientes/${clientId}/contatos/${contactId}`);
  return ok("Datas salvas.");
}

/** Versão do registro de aceite feito pelo painel (a prova guarda qual foi). */
const PANEL_CONSENT_VERSION = "painel-1";

/**
 * Aceite de novidades que a empresa coletou fora do chat (cadastro, formulário, balcão), registrado
 * pelo painel com a origem, a data e o texto aceito. Não desfaz um SAIR: só a própria pessoa tira
 * o número do descadastro.
 */
export async function recordContactConsent(clientId: string, contactId: string, formData: FormData): Promise<ActionResult> {
  if (!(await allowed("config"))) return fail(DENIED);
  const origem = text(formData.get("origem")).slice(0, 200);
  const texto = text(formData.get("texto")).slice(0, 600);
  const data = text(formData.get("data"));
  if (origem.length < 5) return fail("Diga onde a pessoa aceitou (ex.: cadastro na loja, formulário do site).");
  if (texto.length < 10) return fail("Cole o texto que a pessoa aceitou.");
  const when = /^\d{4}-\d{2}-\d{2}$/.test(data) ? new Date(`${data}T12:00:00-03:00`) : null;
  if (!when || Number.isNaN(when.getTime()) || when.getTime() > Date.now()) return fail("Informe a data em que a pessoa aceitou (não pode ser no futuro).");
  if (formData.get("confirm") !== "on") return fail("Confirme que a empresa tem como provar este aceite.");
  const t = await whatsappConsentTarget(clientId, contactId);
  if ("error" in t) return fail(t.error ?? "Contato não encontrado.");
  const { email } = await requireAgency();
  await recordConsent(createAdminClient(), { ...t.target, agencyId: t.bot.agency_id, clientId, botId: t.bot.id, wabaId: t.wabaId, contactId, granted: true, source: "panel", text: `Origem: ${origem}. Texto aceito: ${texto}`, textVersion: PANEL_CONSENT_VERSION, collectedBy: email, collectedAt: when.toISOString() });
  await auditPanel("contato.consentimento", { type: "contact", id: contactId }, { after: { origem, data } });
  revalidatePath(`/painel/clientes/${clientId}/contatos/${contactId}`);
  return ok("Aceite registrado.");
}

export async function revokeContactConsent(clientId: string, contactId: string): Promise<ActionResult> {
  if (!(await allowed("config"))) return fail(DENIED);
  const t = await whatsappConsentTarget(clientId, contactId);
  if ("error" in t) return fail(t.error ?? "Contato não encontrado.");
  const { email } = await requireAgency();
  const n = await revokeConsents(createAdminClient(), t.target, `panel:${email}`);
  if (!n) return fail("Este contato não tem um aceite ativo.");
  // webhooks: contact.opted_out pelo painel (revogar o aceite não cria supressão)
  await queueConsentEvent(createAdminClient(), { channel: "whatsapp", ...t.target, type: "marketing", source: "panel", granted: false, key: `panel-revoke:${contactId}:${Date.now()}` });
  await auditPanel("contato.consentimento_revogar", { type: "contact", id: contactId });
  revalidatePath(`/painel/clientes/${clientId}/contatos/${contactId}`);
  return ok("Aceite revogado: o contato não recebe mais promoções.");
}

/* ------------------------------------------------------------------ planilha de contatos (leva B3, parte 2b) */

export type ImportContactsResult =
  | { ok: true; created: number; updated: number; consents: number; consentsSkipped: number; ages: number; agesSkipped: number; errors: ImportError[] }
  | { ok: false; message: string };

/** Versão do registro de aceite vindo da planilha (a prova guarda qual foi). */
const IMPORT_CONSENT_VERSION = "planilha-1";

/**
 * Importa a planilha que o navegador leu: confere tudo de novo, grava os contatos do WhatsApp do
 * chatbot, os aceites (com origem e data) e as idades informadas pela empresa. Linha com problema
 * fica de fora e volta na lista de erros.
 */
export async function importClientContacts(clientId: string, input: { botId: string; rows: RawImportRow[]; consentText: string; consentTerms: boolean; ageTerms: boolean }): Promise<ImportContactsResult> {
  if (!(await allowed("config"))) return { ok: false, message: DENIED };
  if (!Array.isArray(input?.rows) || !input.rows.length) return { ok: false, message: "A planilha está vazia." };
  if (input.rows.length > IMPORT_MAX_ROWS) return { ok: false, message: `Até ${IMPORT_MAX_ROWS} contatos por planilha. Divida em partes.` };
  const supabase = await createClient();
  // a RLS confere que o chatbot é deste cliente e do escopo de quem está logado
  const { data: bot } = await supabase.from("bots").select("id, agency_id").eq("id", String(input.botId)).eq("client_id", clientId).eq("is_demo", false).maybeSingle();
  if (!bot) return { ok: false, message: "Chatbot não encontrado." };
  const db = createAdminClient();
  const { data: wa } = await db.from("whatsapp_channels").select("waba_id").eq("bot_id", bot.id).is("disconnected_at", null).maybeSingle();
  if (!wa) return { ok: false, message: "Conecte o WhatsApp deste chatbot antes de importar: os aceites valem para o número dele." };

  const { valid, errors } = validateImportRows(input.rows.map((r) => ({ ...r, line: Number(r.line) || 0 })), new Date(), await clientTimezone(clientId));
  if (!valid.length) return { ok: true, created: 0, updated: 0, consents: 0, consentsSkipped: 0, ages: 0, agesSkipped: 0, errors };
  const sheetText = text(input.consentText).slice(0, 600);
  const withConsent = valid.filter((r) => r.consent);
  if (withConsent.length && !input.consentTerms) return { ok: false, message: "Confirme o termo do aceite: a empresa coletou os aceites e consegue prová-los." };
  if (withConsent.some((r) => !r.consent!.text) && sheetText.length < 10) return { ok: false, message: "Escreva o texto que as pessoas aceitaram (ou use a coluna aceite_texto)." };
  const withAge = valid.filter((r) => r.age);
  if (withAge.length && !input.ageTerms) return { ok: false, message: "Confirme o termo da idade: a empresa responde pela idade informada." };

  const { email } = await requireAgency();
  const owner = { id: bot.id as string, agency_id: bot.agency_id as string };
  // as datas novas: só as colunas das datas deste chatbot
  const keys = new Set((await listDateFields(db, [owner.id])).map((f) => f.key));
  const onlyKnown = (d: Record<string, string>) => Object.fromEntries(Object.entries(d).filter(([k]) => keys.has(k)));
  const contacts = await importWhatsAppContacts(db, owner, valid.map((r) => ({ phone: r.phone, name: r.name, tags: r.tags, birthday: r.birthday, lastVisitAt: r.lastVisitAt, appointmentAt: r.appointmentAt, customDates: onlyKnown(r.customDates) })));
  const wabaId = (wa.waba_id as string | null) ?? null;
  const scope = suppressionScope({ wabaId, botId: owner.id });
  const consents = await recordImportedConsents(
    db,
    withConsent.map((r) => ({ scope, contact: r.phone, agencyId: owner.agency_id, clientId, botId: owner.id, wabaId, contactId: contacts.ids.get(r.phone) ?? null, text: `Origem: ${r.consent!.origin}. Texto aceito: ${r.consent!.text ?? sheetText}`, collectedAt: r.consent!.date })),
    { textVersion: IMPORT_CONSENT_VERSION, collectedBy: email },
  );
  const ages = withAge.length ? await setCompanyAgesBulk(db, owner.id, withAge.map((r) => ({ contact: r.phone, adult: r.age!.adult, origin: `planilha: ${r.age!.origin}` }))) : { set: 0, skipped: 0 };
  await auditPanel("contato.importar", { type: "bot", id: owner.id }, { after: { linhas: input.rows.length, criados: contacts.created, atualizados: contacts.updated, aceites: consents.recorded, idades: ages.set, erros: errors.length } });
  revalidatePath(`/painel/clientes/${clientId}`);
  return { ok: true, created: contacts.created, updated: contacts.updated, consents: consents.recorded, consentsSkipped: consents.skipped, ages: ages.set, agesSkipped: ages.skipped, errors };
}
