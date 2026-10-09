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
import { EXCLUSION_LABEL, buildMarketingAudience, renderVariables, templateGate, variablesProblem, type ExclusionReason, type VariableSpec } from "@/lib/campaign-audience";
import { DEFAULT_TIMEZONE, formatInZone, isQuietHour, localHour, localInputToIso, nextEightAm } from "@/lib/timezone";

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
    bot.client_id ? admin.from("clients").select("timezone").eq("id", bot.client_id).maybeSingle() : Promise.resolve({ data: null }),
    botGateExemptions(admin, bot.id as string),
  ]);
  return { bot, ch, admin, tz: (client?.timezone as string | null) ?? DEFAULT_TIMEZONE, exempt };
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
