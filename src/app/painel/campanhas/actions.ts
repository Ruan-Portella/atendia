"use server";

import { revalidatePath } from "next/cache";
import { requireAgency } from "@/lib/agency";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit, requestMeta } from "@/lib/audit";
import { can } from "@/lib/team";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { campaignsInPlan } from "@/lib/plan-limits";
import { clientContactTags, normalizeTags } from "@/lib/contacts";
import { listTemplates, loadTemplateChannel, renderTemplate, templateBody, templateVariables, type Template } from "@/lib/whatsapp-templates";
import { WhatsAppError } from "@/lib/whatsapp";
import { botGateExemptions } from "@/lib/gate/exceptions";
import { costText, createCampaign, estimateFor, setCampaignStatus, templateProblem } from "@/lib/campaigns";
import { EXCLUSION_LABEL, REMINDER_EXCLUSION_LABEL, buildMarketingAudience, buildReminderAudience, renderVariables, templateGate, variablesProblem, type ExclusionReason, type ReminderExclusion, type VariableSpec } from "@/lib/campaign-audience";
import { DEFAULT_TIMEZONE, formatInZone, isClientTimezone, isQuietHour, localHour, localInputToIso, nextEightAm } from "@/lib/timezone";
import { REMINDER_MAX_ROWS, busiestDay, validateReminderRows, type RawReminderRow, type ReminderError } from "@/lib/reminder-sheet";
import { text } from "@/lib/validation";

/*
 * Campanhas pelo painel (leva B3, parte 4a): dono, administrador e editor, nos chatbots do escopo
 * (RLS) e só nos planos pagos. A prévia e a criação montam o público de novo no servidor (nunca
 * confiam no navegador); o motor confere tudo outra vez em cada envio.
 */

const DENIED = "O seu papel na equipe não permite mexer em campanhas. Fale com o dono ou com um administrador da agência.";
const NOT_IN_PLAN = "Campanhas fazem parte dos planos pagos (Freelancer, Agência e Escala). No teste grátis, dá para preparar os contatos e os modelos.";
/** Telefones colados numa lista, no máximo. */
const LIST_MAX = 10_000;

async function campaignContext() {
  const ctx = await requireAgency();
  if (!can(ctx.role, "config")) return { error: DENIED };
  if (!campaignsInPlan(ctx.plan.id)) return { error: NOT_IN_PLAN };
  return { ctx };
}

/** Chatbot do escopo de quem está logado (RLS), com o WhatsApp ligado, o fuso do cliente e as exceções do portão. */
async function campaignBot(botId: string) {
  const supabase = await createClient();
  const { data: bot } = await supabase.from("bots").select("id, agency_id, client_id, name, client_name").eq("id", String(botId)).eq("is_demo", false).maybeSingle();
  if (!bot) return null;
  const admin = createAdminClient();
  const ch = await loadTemplateChannel(admin, bot.id as string);
  if (!ch) return null;
  const [{ data: client }, exempt] = await Promise.all([
    bot.client_id ? admin.from("clients").select("timezone, utility_consent_at").eq("id", bot.client_id).maybeSingle() : Promise.resolve({ data: null }),
    botGateExemptions(admin, bot.id as string),
  ]);
  // declaração de consentimento para lembretes do cliente (parte 5)
  return { bot, ch, admin, tz: (client?.timezone as string | null) ?? DEFAULT_TIMEZONE, exempt, declared: Boolean(client?.utility_consent_at) };
}

const metaMessage = (e: unknown) => (e instanceof WhatsAppError ? e.message : "erro desconhecido");

export interface CampaignTemplateOption {
  name: string;
  language: string;
  body: string;
  vars: number;
  /** itens regulamentados que o texto oferece (bebida, remédio): só para 18+ */
  regulated: string[];
  /** itens proibidos: a campanha não sai */
  prohibited: string[];
}

export type CampaignOptions = { ok: true; templates: CampaignTemplateOption[]; tags: string[]; timezone: string } | { ok: false; message: string };

/** Modelos de marketing aprovados do chatbot e as etiquetas dos contatos dele. */
export async function campaignOptions(botId: string): Promise<CampaignOptions> {
  const c = await campaignContext();
  if ("error" in c) return { ok: false, message: c.error! };
  const b = await campaignBot(botId);
  if (!b) return { ok: false, message: "Chatbot não encontrado ou sem o WhatsApp conectado." };
  let all: Template[];
  try {
    all = await listTemplates(b.ch);
  } catch (e) {
    return { ok: false, message: `A Meta não listou os modelos: ${metaMessage(e)}` };
  }
  const templates = all
    .filter((t) => t.category.toUpperCase() === "MARKETING" && !templateProblem("marketing", t))
    .map((t) => {
      const body = templateBody(t);
      const gate = templateGate(body, b.exempt);
      return { name: t.name, language: t.language, body, vars: templateVariables(body).length, regulated: gate.regulated, prohibited: gate.prohibited };
    });
  return { ok: true, templates, tags: await clientContactTags(b.admin, [b.bot.id as string]), timezone: b.tz };
}

export interface AudienceInput {
  botId: string;
  templateName: string;
  templateLanguage: string;
  tags: string[];
  /** telefones colados, um por linha (ou separados por vírgula) */
  phones: string;
  variables: VariableSpec[];
  /** marcado à mão: a campanha oferece bebida ou remédio (o texto do modelo também marca sozinho) */
  regulated: boolean;
}

/** Monta e confere tudo o que a prévia e a criação usam. */
async function prepare(input: AudienceInput) {
  const c = await campaignContext();
  if ("error" in c) return { error: c.error! };
  const b = await campaignBot(input.botId);
  if (!b) return { error: "Chatbot não encontrado ou sem o WhatsApp conectado." };
  let template: Template | undefined;
  try {
    template = (await listTemplates(b.ch)).find((t) => t.name === input.templateName && t.language === input.templateLanguage);
  } catch (e) {
    return { error: `A Meta não listou os modelos: ${metaMessage(e)}` };
  }
  if (!template || template.category.toUpperCase() !== "MARKETING") return { error: "Escolha um modelo de marketing aprovado." };
  const problem = templateProblem("marketing", template);
  if (problem) return { error: `Este modelo não pode ser usado: ${problem}.` };
  const body = templateBody(template);
  const vars = templateVariables(body).length;
  const specs = (Array.isArray(input.variables) ? input.variables : []).slice(0, vars).map((v) => ({ mode: v?.mode === "name" ? "name" : "fixed", value: String(v?.value ?? "") }) as VariableSpec);
  const varProblem = variablesProblem(specs, vars);
  if (varProblem) return { error: varProblem };
  // o portão olha o texto do modelo com os valores fixos
  const gate = templateGate([body, ...specs.filter((s) => s.mode === "fixed").map((s) => s.value)].join(" "), b.exempt);
  if (gate.prohibited.length) return { error: `O modelo oferece ${gate.prohibited.join(", ")}, que não pode ser anunciado pelo WhatsApp. A campanha não sai.` };
  const regulated = Boolean(input.regulated) || gate.regulated.length > 0;
  const tags = normalizeTags(Array.isArray(input.tags) ? input.tags.map(String).join(",") : "");
  const phones = String(input.phones ?? "").split(/[\n,;]+/).map((p) => p.trim()).filter(Boolean);
  if (!tags.length && !phones.length) return { error: "Escolha etiquetas ou cole uma lista de telefones." };
  if (phones.length > LIST_MAX) return { error: `A lista pode ter até ${LIST_MAX.toLocaleString("pt-BR")} telefones.` };
  const audience = await buildMarketingAudience(b.admin, { botId: b.bot.id as string, wabaId: b.ch.waba_id, tags, phones, regulated });
  const estimate = await estimateFor(b.admin, b.ch, b.bot.id as string, audience.included.length, "MARKETING");
  return { ctx: c.ctx, ...b, template, body, specs, tags, phones, regulated, regulatedItems: gate.regulated, audience, estimate };
}

export type CampaignPreview =
  | {
      ok: true;
      included: number;
      excluded: Array<{ reason: ExclusionReason; label: string; count: number }>;
      truncated: boolean;
      regulated: boolean;
      regulatedItems: string[];
      cost: string;
      days: number;
      limit: number;
      /** a mensagem como o primeiro contato do público recebe */
      sample: string | null;
      timezone: string;
    }
  | { ok: false; message: string };

/** Prévia: quantos recebem, quem fica de fora e por quê, custo e prazo. */
export async function previewCampaign(input: AudienceInput): Promise<CampaignPreview> {
  const p = await prepare(input);
  if ("error" in p) return { ok: false, message: p.error! };
  const first = p.audience.included[0];
  return {
    ok: true,
    included: p.audience.included.length,
    excluded: (Object.entries(p.audience.excluded) as Array<[ExclusionReason, number]>).map(([reason, count]) => ({ reason, label: EXCLUSION_LABEL[reason], count })),
    truncated: p.audience.truncated,
    regulated: p.regulated,
    regulatedItems: p.regulatedItems,
    cost: costText(p.estimate.costBrl),
    days: p.estimate.days,
    limit: p.estimate.limit,
    sample: first ? renderTemplate(p.body, renderVariables(p.specs, first.name)) : null,
    timezone: p.tz,
  };
}

export type CreateCampaignResult = { ok: true; id: string; message: string } | { ok: false; message: string; night?: { hour: number; eightAt: string } };

/**
 * Cria a campanha com quem entra no público. "Agora" entre 20h e 8h no fuso do cliente volta
 * pedindo confirmação (ou agendar para as 8h).
 */
export async function createMarketingCampaign(input: AudienceInput & { name: string; when: "now" | "schedule" | "eight"; scheduledLocal?: string; confirmNight?: boolean }): Promise<CreateCampaignResult> {
  const p = await prepare(input);
  if ("error" in p) return { ok: false, message: p.error! };
  if (!p.audience.included.length) return { ok: false, message: "Ninguém deste público pode receber agora. Veja quem ficou de fora e por quê na prévia." };

  let scheduledAt: string | null = null;
  if (input.when === "eight") scheduledAt = nextEightAm(p.tz);
  else if (input.when === "schedule") {
    scheduledAt = localInputToIso(String(input.scheduledLocal ?? ""), p.tz);
    if (!scheduledAt) return { ok: false, message: "Escolha a data e a hora do envio." };
    const at = Date.parse(scheduledAt);
    if (at < Date.now() + 60_000) return { ok: false, message: "Escolha um horário daqui para a frente." };
    if (at > Date.now() + 60 * 86_400_000) return { ok: false, message: "Agende para no máximo 60 dias à frente." };
  } else {
    const hour = localHour(p.tz);
    if (isQuietHour(hour) && !input.confirmNight) return { ok: false, message: "", night: { hour, eightAt: formatInZone(nextEightAm(p.tz), p.tz) } };
  }

  const name = String(input.name ?? "").trim().slice(0, 120) || `${p.template.name} · ${formatInZone(new Date().toISOString(), p.tz)}`;
  const recipients = p.audience.included.map((c) => ({ contactId: c.id, phone: c.phone, dedupeKey: `c:${c.id}`, variables: renderVariables(p.specs, c.name) }));
  let id: string;
  try {
    const r = await createCampaign(p.admin, {
      agencyId: p.ctx.agency.id,
      clientId: (p.bot.client_id as string | null) ?? null,
      botId: p.bot.id as string,
      kind: "marketing",
      name,
      template: { name: p.template.name, language: p.template.language, category: p.template.category },
      regulated: p.regulated,
      audience: { etiquetas: p.tags, lista: p.phones.length, fora: p.audience.excluded },
      scheduledAt,
      createdBy: p.ctx.email,
      recipients,
      estimatedCostBrl: p.estimate.costBrl,
    });
    id = r.id;
  } catch (e) {
    console.error("campanha não criada", (e as Error).message);
    return { ok: false, message: "Não foi possível criar a campanha. Tente de novo." };
  }
  await audit(p.admin, { agencyId: p.ctx.agency.id, actorType: "user", actorId: p.ctx.userId, action: "campanha.criar", targetType: "campaign", targetId: id, after: { nome: name, chatbot: p.bot.name, modelo: p.template.name, contatos: recipients.length, agendada: scheduledAt }, ...(await requestMeta()) });
  revalidatePath("/painel/campanhas");
  const when = scheduledAt ? `Agendada para ${formatInZone(scheduledAt, p.tz)} (horário do cliente).` : "Os envios começam em até um minuto.";
  return { ok: true, id, message: `Campanha criada para ${recipients.length.toLocaleString("pt-BR")} contato(s). ${when}` };
}

/** Pausar, retomar ou cancelar uma campanha de um chatbot do escopo. */
export async function changeCampaign(id: string, status: "paused" | "sending" | "canceled"): Promise<ActionResult> {
  const c = await campaignContext();
  if ("error" in c) return fail(c.error!);
  if (!["paused", "sending", "canceled"].includes(status)) return fail("Ação inválida.");
  const admin = createAdminClient();
  const { data: campaign } = await admin.from("campaigns").select("id, bot_id, name").eq("id", String(id)).eq("agency_id", c.ctx.agency.id).maybeSingle();
  // a RLS confere que o chatbot da campanha está no escopo de quem está logado
  const { data: bot } = campaign ? await (await createClient()).from("bots").select("id").eq("id", campaign.bot_id as string).maybeSingle() : { data: null };
  if (!campaign || !bot) return fail("Campanha não encontrada.");
  if (!(await setCampaignStatus(admin, campaign.id as string, status, status === "paused" ? "pausada pela equipe" : null))) return fail("A campanha já não está nesse ponto. Recarregue a página.");
  const action = { paused: "campanha.pausar", sending: "campanha.retomar", canceled: "campanha.cancelar" }[status];
  await audit(admin, { agencyId: c.ctx.agency.id, actorType: "user", actorId: c.ctx.userId, action, targetType: "campaign", targetId: campaign.id as string, after: { nome: campaign.name }, ...(await requestMeta()) });
  revalidatePath("/painel/campanhas");
  return ok({ paused: "Campanha pausada.", sending: "Campanha retomada: os envios voltam em até um minuto.", canceled: "Campanha cancelada: o que faltava não sai mais." }[status]);
}

/* ------------------------------------------------------------------ lembretes de utilidade (parte 5) */

export type ReminderOptions = { ok: true; templates: CampaignTemplateOption[]; timezone: string; declared: boolean; clientId: string | null } | { ok: false; message: string };

/** Modelos de utilidade aprovados do chatbot, o fuso do cliente e se ele já fez a declaração. */
export async function reminderOptions(botId: string): Promise<ReminderOptions> {
  const c = await campaignContext();
  if ("error" in c) return { ok: false, message: c.error! };
  const b = await campaignBot(botId);
  if (!b) return { ok: false, message: "Chatbot não encontrado ou sem o WhatsApp conectado." };
  let all: Template[];
  try {
    all = await listTemplates(b.ch);
  } catch (e) {
    return { ok: false, message: `A Meta não listou os modelos: ${metaMessage(e)}` };
  }
  const templates = all
    .filter((t) => t.category.toUpperCase() === "UTILITY" && !templateProblem("utility_reminder", t))
    .map((t) => {
      const body = templateBody(t);
      const gate = templateGate(body, b.exempt);
      return { name: t.name, language: t.language, body, vars: templateVariables(body).length, regulated: gate.regulated, prohibited: gate.prohibited };
    });
  return { ok: true, templates, timezone: b.tz, declared: b.declared, clientId: (b.bot.client_id as string | null) ?? null };
}

export interface ReminderInput {
  botId: string;
  templateName: string;
  templateLanguage: string;
  rows: RawReminderRow[];
}

const cleanRow = (r: Partial<RawReminderRow>): RawReminderRow => ({
  line: Number(r?.line) || 0,
  phone: String(r?.phone ?? "").slice(0, 40),
  name: String(r?.name ?? "").slice(0, 120),
  date: String(r?.date ?? "").slice(0, 20),
  time: String(r?.time ?? "").slice(0, 10),
  vars: (Array.isArray(r?.vars) ? r.vars : []).slice(0, 20).map((v) => String(v ?? "").slice(0, 400)),
});

async function prepareReminders(input: ReminderInput) {
  const c = await campaignContext();
  if ("error" in c) return { error: c.error! };
  const b = await campaignBot(input.botId);
  if (!b) return { error: "Chatbot não encontrado ou sem o WhatsApp conectado." };
  let template: Template | undefined;
  try {
    template = (await listTemplates(b.ch)).find((t) => t.name === input.templateName && t.language === input.templateLanguage);
  } catch (e) {
    return { error: `A Meta não listou os modelos: ${metaMessage(e)}` };
  }
  if (!template || template.category.toUpperCase() !== "UTILITY") return { error: "Escolha um modelo de utilidade aprovado." };
  const problem = templateProblem("utility_reminder", template);
  if (problem) return { error: `Este modelo não pode ser usado: ${problem}.` };
  const body = templateBody(template);
  const gate = templateGate(body, b.exempt);
  if (gate.prohibited.length) return { error: `O modelo fala de ${gate.prohibited.join(", ")}, que não pode ser enviado pelo WhatsApp.` };
  const raw = Array.isArray(input.rows) ? input.rows : [];
  if (!raw.length) return { error: "A planilha está vazia." };
  if (raw.length > REMINDER_MAX_ROWS) return { error: `Até ${REMINDER_MAX_ROWS.toLocaleString("pt-BR")} lembretes por planilha. Divida em partes.` };
  const { valid, errors } = validateReminderRows(raw.map(cleanRow), { vars: templateVariables(body).length, tz: b.tz });
  const audience = await buildReminderAudience(b.admin, { botId: b.bot.id as string, wabaId: b.ch.waba_id, rows: valid, declared: b.declared });
  const estimate = await estimateFor(b.admin, b.ch, b.bot.id as string, audience.included.length, "UTILITY");
  return { ctx: c.ctx, ...b, template, body, rows: raw.length, valid, errors, audience, estimate };
}

export type ReminderPreview =
  | {
      ok: true;
      rows: number;
      valid: number;
      included: number;
      excluded: Array<{ reason: ReminderExclusion; label: string; count: number }>;
      errors: ReminderError[];
      errorCount: number;
      offHours: number;
      cost: string;
      limit: number;
      busiest: { day: string; count: number } | null;
      first: string | null;
      last: string | null;
      sample: string | null;
      timezone: string;
      declared: boolean;
    }
  | { ok: false; message: string };

/** Prévia: linhas válidas, erros por linha, fora do horário, quem fica de fora e por quê, custo. */
export async function previewReminders(input: ReminderInput): Promise<ReminderPreview> {
  const p = await prepareReminders(input);
  if ("error" in p) return { ok: false, message: p.error! };
  const inc = [...p.audience.included].sort((a, b) => a.sendAt.localeCompare(b.sendAt));
  return {
    ok: true,
    rows: p.rows,
    valid: p.valid.length,
    included: inc.length,
    excluded: (Object.entries(p.audience.excluded) as Array<[ReminderExclusion, number]>).map(([reason, count]) => ({ reason, label: REMINDER_EXCLUSION_LABEL[reason], count })),
    errors: p.errors.slice(0, 100),
    errorCount: p.errors.length,
    offHours: inc.filter((r) => r.offHours).length,
    cost: costText(p.estimate.costBrl),
    limit: p.estimate.limit,
    busiest: busiestDay(inc),
    first: inc[0]?.local ?? null,
    last: inc[inc.length - 1]?.local ?? null,
    sample: inc[0] ? renderTemplate(p.body, inc[0].variables) : null,
    timezone: p.tz,
    declared: p.declared,
  };
}

/** Agenda os lembretes: cada linha sai na data e hora dela (no fuso do cliente), uma vez. */
export async function createReminderCampaign(input: ReminderInput & { name: string }): Promise<CreateCampaignResult> {
  const p = await prepareReminders(input);
  if ("error" in p) return { ok: false, message: p.error! };
  if (!p.audience.included.length) return { ok: false, message: "Nenhuma linha da planilha pode ser enviada. Veja os erros e quem ficou de fora na prévia." };
  const inc = [...p.audience.included].sort((a, b) => a.sendAt.localeCompare(b.sendAt));
  // agendada até a primeira linha vencer; cada linha leva a própria data e hora
  const first = inc[0].sendAt;
  const name = String(input.name ?? "").trim().slice(0, 120) || `Lembretes ${p.template.name} · ${formatInZone(new Date().toISOString(), p.tz)}`;
  let id: string;
  try {
    const r = await createCampaign(p.admin, {
      agencyId: p.ctx.agency.id,
      clientId: (p.bot.client_id as string | null) ?? null,
      botId: p.bot.id as string,
      kind: "utility_reminder",
      name,
      template: { name: p.template.name, language: p.template.language, category: p.template.category },
      regulated: false,
      audience: { planilha: p.rows, validas: p.valid.length, erros: p.errors.length, fora: p.audience.excluded, declaracao: p.declared },
      scheduledAt: Date.parse(first) > Date.now() + 60_000 ? first : null,
      createdBy: p.ctx.email,
      recipients: inc.map((r) => ({ contactId: r.contactId, phone: r.phone, dedupeKey: `l:${r.line}`, variables: r.variables, sendAt: r.sendAt })),
      estimatedCostBrl: p.estimate.costBrl,
    });
    id = r.id;
  } catch (e) {
    console.error("lembretes não criados", (e as Error).message);
    return { ok: false, message: "Não foi possível agendar os lembretes. Tente de novo." };
  }
  await audit(p.admin, { agencyId: p.ctx.agency.id, actorType: "user", actorId: p.ctx.userId, action: "campanha.criar", targetType: "campaign", targetId: id, after: { nome: name, tipo: "lembrete", chatbot: p.bot.name, modelo: p.template.name, linhas: inc.length }, ...(await requestMeta()) });
  revalidatePath("/painel/campanhas");
  return { ok: true, id, message: `${inc.length.toLocaleString("pt-BR")} lembrete(s) agendado(s), de ${inc[0].local} a ${inc[inc.length - 1].local} (horário do cliente).` };
}

/* ------------------------------------------------------------------ cliente: fuso e declaração (parte 5) */

const CONSENT_ORIGINS = new Set(["cadastro", "contrato", "compra", "outro"]);

/** Cliente do escopo de quem está logado (RLS), para quem configura. */
async function configClient(clientId: string) {
  const ctx = await requireAgency();
  if (!can(ctx.role, "config")) return null;
  const { data: client } = await (await createClient()).from("clients").select("id, name").eq("id", String(clientId)).maybeSingle();
  return client ? { ctx, client } : null;
}

async function auditClient(ctx: { agency: { id: string }; userId: string }, action: string, clientId: string, change: { before?: Record<string, unknown>; after?: Record<string, unknown> }) {
  await audit(createAdminClient(), { agencyId: ctx.agency.id, actorType: "user", actorId: ctx.userId, action, targetType: "client", targetId: clientId, ...change, ...(await requestMeta()) });
}

/** Fuso do cliente: a agenda dos lembretes e das campanhas e o aviso de 20h às 8h. */
export async function saveClientTimezone(clientId: string, fd: FormData): Promise<ActionResult> {
  const c = await configClient(clientId);
  if (!c) return fail(DENIED);
  const tz = text(fd.get("timezone"));
  if (!isClientTimezone(tz)) return fail("Escolha um dos fusos da lista.");
  const admin = createAdminClient();
  const { data: before } = await admin.from("clients").select("timezone").eq("id", c.client.id).maybeSingle();
  await admin.from("clients").update({ timezone: tz }).eq("id", c.client.id);
  await auditClient(c.ctx, "cliente.fuso", c.client.id as string, { before: { fuso: before?.timezone ?? null }, after: { fuso: tz } });
  revalidatePath(`/painel/clientes/${c.client.id}`);
  return ok("Fuso salvo. Lembretes novos usam este horário; os já agendados ficam como estão.");
}

/**
 * Declaração de consentimento para lembretes (spec Peça 7): feita uma vez pelo cliente (o
 * negócio é o controlador), com origem, texto, quem e quando. Fica na auditoria.
 */
export async function declareUtilityConsent(clientId: string, fd: FormData): Promise<ActionResult> {
  const c = await configClient(clientId);
  if (!c) return fail(DENIED);
  const origin = text(fd.get("origin"));
  if (!CONSENT_ORIGINS.has(origin)) return fail("Escolha onde os contatos aceitaram receber lembretes.");
  const declaration = String(fd.get("text") ?? "").trim().slice(0, 1000);
  if (declaration.length < 20) return fail("Escreva como os contatos aceitaram (ex.: o trecho do contrato ou do cadastro), com pelo menos 20 caracteres.");
  if (fd.get("confirm") !== "on") return fail("Confirme a declaração em nome do cliente.");
  const at = new Date().toISOString();
  await createAdminClient().from("clients").update({ utility_consent_origin: origin, utility_consent_text: declaration, utility_consent_by: c.ctx.email, utility_consent_at: at }).eq("id", c.client.id);
  await auditClient(c.ctx, "cliente.lembretes_declarar", c.client.id as string, { after: { origem: origin, texto: declaration, por: c.ctx.email } });
  revalidatePath(`/painel/clientes/${c.client.id}`);
  return ok("Declaração registrada. Os lembretes deste cliente podem ir também para quem ainda não falou com o chatbot.");
}

export async function revokeUtilityConsent(clientId: string): Promise<ActionResult> {
  const c = await configClient(clientId);
  if (!c) return fail(DENIED);
  const admin = createAdminClient();
  const { data: before } = await admin.from("clients").select("utility_consent_origin, utility_consent_text, utility_consent_by, utility_consent_at").eq("id", c.client.id).maybeSingle();
  if (!before?.utility_consent_at) return fail("Este cliente não tem declaração ativa.");
  await admin.from("clients").update({ utility_consent_origin: null, utility_consent_text: null, utility_consent_by: null, utility_consent_at: null }).eq("id", c.client.id);
  await auditClient(c.ctx, "cliente.lembretes_revogar", c.client.id as string, { before: { origem: before.utility_consent_origin, texto: before.utility_consent_text, por: before.utility_consent_by, em: before.utility_consent_at } });
  revalidatePath(`/painel/clientes/${c.client.id}`);
  return ok("Declaração revogada. Lembretes novos só vão para quem já falou com o chatbot; os já agendados seguem.");
}
