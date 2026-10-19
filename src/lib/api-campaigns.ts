import type { SupabaseClient } from "@supabase/supabase-js";
import { apiContacts, parseContactAddress, whatsappContactsByPhone, whatsappPhonesOf } from "./contacts";
import { canonicalPhone } from "./phone";
import { campaignDetail, campaignReport, createCampaign, estimateFor, reportNumbers, templateProblem, type CampaignKind } from "./campaigns";
import { buildMarketingAudience, buildReminderAudience, renderVariables, templateGate, variablesProblem, type VariableSpec } from "./campaign-audience";
import { REMINDER_MAX_DAYS, REMINDER_MAX_ROWS, type ReminderRow } from "./reminder-sheet";
import { DEFAULT_TIMEZONE, formatInZone, isQuietHour, localHour } from "./timezone";
import { listTemplates, loadTemplateChannel, templateBody, templateVariables, type Template } from "./whatsapp-templates";
import { botGateExemptions } from "./gate/exceptions";
import { sendBlockedReason } from "./conversation-mode";
import { audit } from "./audit";
import { clientIp } from "./rate-limit";
import { UNSIZED_API_SENDS, isUnsized } from "./free-account";
import { channelError } from "./api-messages";
import { ApiError, invalidRequest, notFound, readJsonBody, withIdempotency, type ApiContext } from "./api-v1";

/*
 * Campanhas e lembretes pela API (C pública, parte 4b; permissão campaigns; spec Peça 7):
 * - POST /v1/campaigns {bot_id, channel: whatsapp, kind, template, audience? | sends?, send_at?}
 *   → 201 {campaign_id, estimated_contacts, estimated_cost_cents}. Idempotency-Key obrigatória.
 *   kind marketing: audience {tags?, contacts?, external_ids?}; só recebe quem aceitou novidades
 *   (e, com bebida ou remédio, quem confirmou 18+). kind utility_reminder: sends [{contact, send_at,
 *   variables}], como a planilha do painel; quem nunca conversou com o bot exige a declaração de
 *   lembretes do cliente (400 apontando o que falta); quem pediu para sair é pulado.
 * - GET /v1/campaigns/{id} → status e totais.
 * O mesmo motor do painel: o envio confere tudo de novo (categoria do modelo, supressão,
 * consentimento, qualidade do número).
 */

const MAX_CONTACTS = 10_000;
const MAX_EXTERNAL_IDS = 1_000;
const MAX_SCHEDULE_DAYS = 60;

/** Variável do modelo na campanha: texto fixo, ou {"type": "first_name", "fallback": "cliente"}. Pura. */
export function parseCampaignVariables(raw: unknown, field = "template.variables"): VariableSpec[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > 20) throw invalidRequest("template.variables deve ser uma lista (até 20).", { field });
  return raw.map((v, i) => {
    if (typeof v === "string") return { mode: "fixed", value: v };
    const o = v as Record<string, unknown>;
    if (o && typeof o === "object" && o.type === "first_name" && typeof o.fallback === "string") return { mode: "name", value: o.fallback };
    throw invalidRequest(`Variável ${i + 1}: um texto, ou {"type": "first_name", "fallback": "cliente"} para o primeiro nome do contato.`, { field: `${field}[${i}]` });
  });
}

export interface CampaignBody {
  kind: CampaignKind;
  name: string | null;
  template: { name: string; language: string; variables: VariableSpec[] };
  audience: { tags: string[]; contacts: string[]; externalIds: string[] } | null;
  sends: Array<{ contact: string; sendAt: string; variables: string[]; name: string | null }> | null;
  sendAt: string | null;
  regulated: boolean;
}

/** O corpo do POST /v1/campaigns (400 com o campo). Pura. */
export function parseCampaignBody(body: Record<string, unknown>, now = Date.now()): CampaignBody {
  if (body.channel !== undefined && body.channel !== "whatsapp") throw invalidRequest("Campanhas são só do WhatsApp: a API do Instagram não tem mensagem de marketing.", { field: "channel" });
  const kind = body.kind;
  if (kind !== "marketing" && kind !== "utility_reminder") throw invalidRequest('kind deve ser "marketing" ou "utility_reminder".', { field: "kind" });
  if (body.name !== undefined && body.name !== null && (typeof body.name !== "string" || body.name.trim().length > 120)) throw invalidRequest("name: texto de até 120 caracteres.", { field: "name" });
  const name = typeof body.name === "string" ? body.name.trim() || null : null;
  const t = body.template as Record<string, unknown> | undefined;
  if (!t || typeof t !== "object" || Array.isArray(t) || typeof t.name !== "string" || !t.name.trim()) throw invalidRequest("template é obrigatório: {name, language, variables}.", { field: "template.name" });
  if (t.language !== undefined && (typeof t.language !== "string" || !/^[a-z]{2,3}(_[A-Z]{2})?$/.test(t.language))) throw invalidRequest('template.language deve ser o código do idioma do modelo, ex.: "pt_BR".', { field: "template.language" });
  const template = { name: t.name.trim(), language: (t.language as string | undefined) ?? "pt_BR", variables: kind === "marketing" ? parseCampaignVariables(t.variables) : [] };

  if (kind === "marketing") {
    if (body.sends !== undefined) throw invalidRequest("sends é dos lembretes (utility_reminder); na campanha de marketing, use audience.", { field: "sends" });
    const a = body.audience as Record<string, unknown> | undefined;
    if (!a || typeof a !== "object" || Array.isArray(a)) throw invalidRequest("audience é obrigatório: {tags?, contacts?, external_ids?}.", { field: "audience" });
    const list = (k: string, max: number): string[] => {
      const v = a[k];
      if (v === undefined || v === null) return [];
      if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || !x.trim())) throw invalidRequest(`audience.${k} deve ser uma lista de textos.`, { field: `audience.${k}` });
      if (v.length > max) throw invalidRequest(`audience.${k}: até ${max.toLocaleString("pt-BR")} itens.`, { field: `audience.${k}` });
      return (v as string[]).map((x) => x.trim());
    };
    const audience = { tags: list("tags", 20), contacts: list("contacts", MAX_CONTACTS), externalIds: list("external_ids", MAX_EXTERNAL_IDS) };
    if (!audience.tags.length && !audience.contacts.length && !audience.externalIds.length) throw invalidRequest("audience precisa de tags, contacts ou external_ids.", { field: "audience" });
    let sendAt: string | null = null;
    if (body.send_at !== undefined && body.send_at !== null) {
      const at = typeof body.send_at === "string" ? Date.parse(body.send_at) : NaN;
      if (Number.isNaN(at)) throw invalidRequest("send_at deve ser uma data ISO 8601 (com o fuso, ex.: 2026-11-28T09:00:00-03:00).", { field: "send_at" });
      if (at > now + MAX_SCHEDULE_DAYS * 86_400_000) throw invalidRequest(`Agende para no máximo ${MAX_SCHEDULE_DAYS} dias à frente.`, { field: "send_at" });
      // no passado (ou daqui a menos de 1 minuto): sai agora
      sendAt = at > now + 60_000 ? new Date(at).toISOString() : null;
    }
    if (body.regulated !== undefined && typeof body.regulated !== "boolean") throw invalidRequest("regulated deve ser true ou false.", { field: "regulated" });
    return { kind, name, template, audience, sends: null, sendAt, regulated: body.regulated === true };
  }

  if (body.audience !== undefined) throw invalidRequest("audience é da campanha de marketing; nos lembretes, cada linha vai em sends.", { field: "audience" });
  if (!Array.isArray(body.sends) || !body.sends.length) throw invalidRequest("sends é obrigatório: [{contact, send_at, variables}].", { field: "sends" });
  if (body.sends.length > REMINDER_MAX_ROWS) throw invalidRequest(`Até ${REMINDER_MAX_ROWS.toLocaleString("pt-BR")} lembretes por campanha.`, { field: "sends" });
  const sends = (body.sends as unknown[]).map((raw, i) => {
    const s = raw as Record<string, unknown>;
    if (!s || typeof s !== "object" || typeof s.contact !== "string" || !s.contact.trim()) throw invalidRequest(`sends[${i}].contact é obrigatório (phone:…, ctc_…, wa:… ou ext:…).`, { field: `sends[${i}].contact` });
    const at = typeof s.send_at === "string" ? Date.parse(s.send_at) : NaN;
    if (Number.isNaN(at)) throw invalidRequest(`sends[${i}].send_at deve ser uma data ISO 8601 com o fuso.`, { field: `sends[${i}].send_at` });
    if (at < now - 5 * 60_000) throw invalidRequest(`sends[${i}].send_at já passou.`, { field: `sends[${i}].send_at` });
    if (at > now + REMINDER_MAX_DAYS * 86_400_000) throw invalidRequest(`sends[${i}].send_at: no máximo ${REMINDER_MAX_DAYS} dias à frente.`, { field: `sends[${i}].send_at` });
    const vars = s.variables ?? [];
    if (!Array.isArray(vars) || vars.length > 20 || vars.some((v) => typeof v !== "string" || !v.trim() || v.length > 200 || /[\n\t]| {5,}/.test(v))) {
      throw invalidRequest(`sends[${i}].variables: lista de textos de até 200 caracteres, sem quebra de linha.`, { field: `sends[${i}].variables` });
    }
    const name = typeof s.name === "string" && s.name.trim() ? s.name.trim().slice(0, 120) : null;
    return { contact: s.contact.trim(), sendAt: new Date(at).toISOString(), variables: (vars as string[]).map((v) => v.trim()), name };
  });
  return { kind, name, template, audience: null, sends, sendAt: null, regulated: false };
}

/* ------------------------------------------------------------------ POST /v1/campaigns */

/** Telefones dos contatos do público (ctc_, phone:, ext:; BSUID sem telefone não recebe campanha). */
async function audiencePhones(db: SupabaseClient, botId: string, a: NonNullable<CampaignBody["audience"]>): Promise<{ phones: string[]; invalid: number }> {
  const phones: string[] = [];
  const ids: string[] = [];
  const externalIds = [...a.externalIds];
  let invalid = 0;
  for (const raw of a.contacts) {
    const addr = parseContactAddress(raw);
    if (addr?.kind === "phone") phones.push(addr.phone);
    else if (addr?.kind === "id") ids.push(addr.id);
    else if (addr?.kind === "ext") externalIds.push(addr.externalId);
    else invalid++;
  }
  for (const [, c] of await whatsappPhonesOf(db, botId, ids)) if (c.phone) phones.push(c.phone);
  for (const ext of new Set(externalIds)) {
    for (const c of await apiContacts(db, [botId], { kind: "ext", externalId: ext })) if (c.channel === "whatsapp" && c.phone) phones.push(c.phone);
  }
  return { phones: [...new Set(phones)], invalid };
}

export async function postCampaign(req: Request, api: ApiContext): Promise<Response> {
  if (!req.headers.get("idempotency-key")?.trim()) throw invalidRequest("Idempotency-Key é obrigatório em POST /v1/campaigns (uma chave por campanha: repetir não cria outra).", { field: "Idempotency-Key" });
  const { raw, body } = await readJsonBody(req);
  const botId = api.requireBot(body.bot_id);
  const c = parseCampaignBody(body);
  return withIdempotency(api, req, raw, async () => {
    const db = api.db;
    const { data: bot } = await db.from("bots").select("id, agency_id, client_id, name, paused_at").eq("id", botId).maybeSingle();
    if (!bot) throw notFound();
    if (bot.paused_at) throw new ApiError(422, "bot_paused", "O bot está pausado pelo dono: campanhas e lembretes não saem até ele ser retomado.");
    if (await isUnsized(db, botId)) throw new ApiError(422, "bot_without_size", UNSIZED_API_SENDS);
    const ch = await loadTemplateChannel(db, botId);
    if (!ch) throw new ApiError(422, "channel_not_connected", "O bot não tem WhatsApp conectado (com a conta do WhatsApp Business).", { channel: "whatsapp" });
    const blocked = await sendBlockedReason(db, botId, "whatsapp");
    if (blocked) throw new ApiError(403, "feature_suspended", blocked, { feature: "channel", channel: "whatsapp" });
    const { data: client } = bot.client_id ? await db.from("clients").select("timezone, utility_consent_at").eq("id", bot.client_id).maybeSingle() : { data: null };
    const tz = (client?.timezone as string | null) ?? DEFAULT_TIMEZONE;

    let templates: Template[];
    try {
      templates = await listTemplates(ch);
    } catch (e) {
      throw channelError(e);
    }
    const template = templates.find((t) => t.name === c.template.name && t.language === c.template.language);
    if (!template) throw invalidRequest("Modelo não encontrado neste número (confira o nome e o idioma em GET /v1/bots/{id}/templates).", { field: "template.name" });
    const want = c.kind === "marketing" ? "MARKETING" : "UTILITY";
    if (template.category.toUpperCase() !== want) throw new ApiError(422, "template_category_mismatch", c.kind === "marketing" ? "Campanha de marketing usa modelo de marketing." : "Lembrete usa modelo de utilidade (o de marketing nunca vai como lembrete).", { category: template.category.toLowerCase() });
    const problem = templateProblem(c.kind, template);
    if (problem) throw invalidRequest(`Este modelo não pode ser usado: ${problem}.`, { field: "template.name" });
    const body = templateBody(template);
    const vars = templateVariables(body).length;
    const exempt = await botGateExemptions(db, botId);
    const created = { kind: c.kind, createdBy: `api:${api.key.prefix}`, botRef: { agencyId: bot.agency_id as string, clientId: (bot.client_id as string | null) ?? null, botId } };

    if (c.kind === "marketing") {
      const specs = c.template.variables;
      const varProblem = variablesProblem(specs, vars);
      if (varProblem) throw invalidRequest(varProblem, { field: "template.variables", expected: vars });
      const gate = templateGate([body, ...specs.filter((s) => s.mode === "fixed").map((s) => s.value)].join(" "), exempt);
      if (gate.prohibited.length) throw new ApiError(422, "prohibited_content", "O modelo (corpo ou variáveis) oferece item proibido no WhatsApp: a campanha não sai.", { reason: "prohibited", matches: gate.prohibited.map((term) => ({ term, excerpt: null })), channel: "whatsapp" });
      const regulated = c.regulated || gate.regulated.length > 0;
      const { phones, invalid } = await audiencePhones(db, botId, c.audience!);
      const audience = await buildMarketingAudience(db, { botId, wabaId: ch.waba_id, tags: c.audience!.tags, phones, regulated });
      const excluded = { ...audience.excluded, ...(invalid ? { invalid_contact: invalid } : {}) };
      if (!audience.included.length) throw new ApiError(422, "empty_audience", "Ninguém deste público pode receber agora (sem aceite de novidades, descadastrado ou fora do público).", { excluded });
      const estimate = await estimateFor(db, ch, botId, audience.included.length, "MARKETING");
      const name = c.name ?? `${template.name} · ${formatInZone(new Date().toISOString(), tz)}`;
      const r = await createCampaign(db, {
        ...created.botRef,
        kind: "marketing",
        name,
        template: { name: template.name, language: template.language, category: template.category },
        regulated,
        audience: { etiquetas: c.audience!.tags, contatos: c.audience!.contacts.length, ids_externos: c.audience!.externalIds.length, fora: excluded, origem: "api" },
        scheduledAt: c.sendAt,
        createdBy: created.createdBy,
        recipients: audience.included.map((x) => ({ contactId: x.id, phone: x.phone, dedupeKey: `c:${x.id}`, variables: renderVariables(specs, x.name) })),
        estimatedCostBrl: estimate.costBrl,
      });
      await audit(db, { agencyId: api.key.agency_id, actorType: "api_key", actorId: api.key.id, action: "campanha.criar", targetType: "campaign", targetId: r.id, after: { nome: name, chatbot: bot.name, modelo: template.name, contatos: r.queued, agendada: c.sendAt }, ip: clientIp(req), userAgent: req.headers.get("user-agent") });
      return {
        status: 201,
        body: {
          campaign_id: `cmp_${r.id}`,
          status: c.sendAt ? "scheduled" : "sending",
          estimated_contacts: audience.included.length,
          estimated_cost_cents: Math.round(estimate.costBrl * 100),
          estimated_days: estimate.days,
          excluded,
          ...(c.sendAt ? {} : { quiet_hours: isQuietHour(localHour(tz)) }),
        },
      };
    }

    // lembretes: cada linha vira um envio, na hora dela
    const gate = templateGate(body, exempt);
    if (gate.prohibited.length) throw new ApiError(422, "prohibited_content", "O modelo fala de item proibido no WhatsApp.", { reason: "prohibited", matches: gate.prohibited.map((term) => ({ term, excerpt: null })), channel: "whatsapp" });
    const sends = c.sends!;
    const badVars = sends.findIndex((s) => s.variables.length !== vars);
    if (badVars >= 0) throw invalidRequest(`sends[${badVars}].variables: o modelo pede ${vars} variável(is).`, { field: `sends[${badVars}].variables`, expected: vars });
    // o contato de cada linha: telefone direto, ou o do contato (ctc_, ext:)
    const ids = sends.map((s) => parseContactAddress(s.contact)).map((a) => (a?.kind === "id" ? a.id : null)).filter((x): x is string => Boolean(x));
    const byId = await whatsappPhonesOf(db, botId, ids);
    const rows: ReminderRow[] = [];
    const unresolved: number[] = [];
    for (const [i, s] of sends.entries()) {
      const addr = parseContactAddress(s.contact);
      let phone: string | null = null;
      if (addr?.kind === "phone") phone = addr.phone;
      else if (addr?.kind === "id") phone = byId.get(addr.id)?.phone ?? null;
      else if (addr?.kind === "ext") phone = (await apiContacts(db, [botId], addr)).find((x) => x.channel === "whatsapp" && x.phone)?.phone ?? null;
      phone = phone ? canonicalPhone(phone) : null;
      if (!phone) {
        unresolved.push(i);
        continue;
      }
      const hour = localHour(tz, new Date(s.sendAt));
      rows.push({ line: i, phone, name: s.name ?? (addr?.kind === "id" ? (byId.get(addr.id)?.name ?? null) : null), sendAt: s.sendAt, local: formatInZone(s.sendAt, tz), offHours: isQuietHour(hour), variables: s.variables });
    }
    if (unresolved.length) throw invalidRequest(`Contato sem telefone do WhatsApp neste bot nas linhas ${unresolved.slice(0, 20).join(", ")}${unresolved.length > 20 ? "…" : ""}.`, { field: `sends[${unresolved[0]}].contact`, lines: unresolved.slice(0, 50) });
    const declared = Boolean(client?.utility_consent_at);
    // quem nunca conversou com o bot, sem a declaração de lembretes do cliente: 400 apontando o que falta
    if (!declared) {
      const known = await whatsappContactsByPhone(db, botId, [...new Set(rows.map((r) => r.phone))]);
      const lines = rows.filter((r) => !known.get(r.phone)?.messaged).map((r) => r.line);
      if (lines.length) throw invalidRequest("Há contatos que nunca conversaram com o bot, e o cliente ainda não fez a declaração de consentimento para lembretes (no painel, aba Campanhas do cliente).", { field: "utility_consent", lines: lines.slice(0, 50) });
    }
    const audience = await buildReminderAudience(db, { botId, wabaId: ch.waba_id, rows, declared });
    if (!audience.included.length) throw new ApiError(422, "empty_audience", "Todos os contatos pediram para não receber lembretes.", { excluded: audience.excluded });
    const included = [...audience.included].sort((a, b) => a.sendAt.localeCompare(b.sendAt));
    const estimate = await estimateFor(db, ch, botId, included.length, "UTILITY");
    const first = included[0].sendAt;
    const name = c.name ?? `Lembretes ${template.name} · ${formatInZone(new Date().toISOString(), tz)}`;
    const r = await createCampaign(db, {
      ...created.botRef,
      kind: "utility_reminder",
      name,
      template: { name: template.name, language: template.language, category: template.category },
      regulated: false,
      audience: { linhas: sends.length, fora: audience.excluded, declaracao: declared, origem: "api" },
      scheduledAt: Date.parse(first) > Date.now() + 60_000 ? first : null,
      createdBy: created.createdBy,
      recipients: included.map((x) => ({ contactId: x.contactId, phone: x.phone, dedupeKey: `l:${x.line}`, variables: x.variables, sendAt: x.sendAt })),
      estimatedCostBrl: estimate.costBrl,
    });
    await audit(db, { agencyId: api.key.agency_id, actorType: "api_key", actorId: api.key.id, action: "campanha.criar", targetType: "campaign", targetId: r.id, after: { nome: name, tipo: "lembrete", chatbot: bot.name, modelo: template.name, linhas: included.length }, ip: clientIp(req), userAgent: req.headers.get("user-agent") });
    return {
      status: 201,
      body: {
        campaign_id: `cmp_${r.id}`,
        status: Date.parse(first) > Date.now() + 60_000 ? "scheduled" : "sending",
        estimated_contacts: included.length,
        estimated_cost_cents: Math.round(estimate.costBrl * 100),
        excluded: audience.excluded,
        off_hours: included.filter((x) => x.offHours).length,
      },
    };
  });
}

/* ------------------------------------------------------------------ GET /v1/campaigns/{id} */

const CMP_ID = /^cmp_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export async function getCampaign(api: ApiContext, rawId: string): Promise<Response> {
  const m = CMP_ID.exec(rawId);
  if (!m) throw notFound();
  const c = await campaignDetail(api.db, m[1].toLowerCase(), api.botIds);
  if (!c) throw notFound();
  const report = await campaignReport(api.db, c.id);
  const n = reportNumbers(report);
  const s = (k: string) => report.status[k as keyof typeof report.status] ?? 0;
  return Response.json({
    id: `cmp_${c.id}`,
    bot_id: `bot_${c.bot_id}`,
    kind: c.kind,
    name: c.name,
    status: c.status,
    pause_reason: c.pause_reason,
    template: { name: c.template_name, language: c.template_language, category: c.template_category.toLowerCase() },
    scheduled_at: c.scheduled_at,
    created_at: c.created_at,
    finished_at: c.finished_at,
    estimated_contacts: c.estimated_contacts,
    estimated_cost_cents: c.estimated_cost_cents,
    totals: {
      sent: n.sent,
      delivered: n.delivered,
      read: n.read,
      replied: n.replied,
      failed: n.failed,
      pending: n.pending,
      uncertain: n.uncertain,
      skipped_no_consent: s("skipped_no_consent"),
      skipped_no_age: s("skipped_no_age"),
      skipped_suppressed: s("skipped_suppressed") + s("skipped_contact_deleted"),
      opted_out: n.optOuts,
    },
  });
}
