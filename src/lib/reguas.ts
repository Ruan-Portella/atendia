import type { SupabaseClient } from "@supabase/supabase-js";
import { reguaContactCount, reguaContacts, whatsappPhonesOf, phoneHash, type ReguaContact, type ReguaSearch } from "./contacts";
import { campaignReport, ensureReguaCampaign, queueReguaSends, reguaCampaigns, reguaRecentPhoneHashes, reportNumbers, stopReguaCampaign, type ReguaRecipient } from "./campaigns";
import { referencePrices } from "./whatsapp-usage";
import { loadMessages } from "./messages";
import { DEFAULT_TIMEZONE, atLocal, wallClock } from "./timezone";
import { REGUA_CATEGORY, REGUA_DELAY, REGUA_EXAMPLES, REGUA_KINDS, REGUA_LABEL, reguaTemplateBody, reguaTemplateName, reguaTemplateProblem, reguaTemplateState, type ReguaKind, type ReguaTemplateState } from "./regua-kinds";
import { createTemplate, listTemplates, type TemplateChannel } from "./whatsapp-templates";
import { TEMPLATE_LANGUAGE, type Template } from "./template-text";
import { templateGate } from "./campaign-audience";
import type { GateCategory } from "./gate/rules";

export { REGUA_DELAY, REGUA_KINDS, REGUA_LABEL, type ReguaKind } from "./regua-kinds";

/*
 * Réguas (leva Réguas; spec "Próximos passos", depois do MVP): mensagens automáticas do WhatsApp em
 * cima das campanhas e dos lembretes da B3. Uma régua por chatbot e tipo; ligada, ela tem uma
 * campanha que nunca termina (campaigns.regua_id), e o planejador põe na agenda dela, a cada hora,
 * quem entrou na régua. O motor da B3 envia, com o aceite, o SAIR, o limite do número, as pausas e
 * o relatório.
 *  - aniversário: no dia (o dia e o mês do contato), na hora escolhida;
 *  - faz tempo que você não vem (sumido): N dias depois da última visita registrada ou, sem ela, da
 *    última mensagem do contato; uma vez por ausência;
 *  - pós-atendimento: N horas depois da visita registrada ou da conversa encerrada pela equipe;
 *  - lembrete antes do horário: N horas antes do horário marcado (e nunca depois dele);
 *  - sem resposta: N dias depois da última mensagem da loja (IA ou equipe) sem resposta do contato,
 *    em conversa que a equipe não encerrou (mensagem de campanha ou de régua não conta).
 * Envio só das 8h às 20h no fuso do cliente. Uma régua por pessoa a cada 24 h no chatbot, na ordem
 * de importância (o lembrete primeiro). O lembrete de utilidade sem a declaração de consentimento
 * do cliente só vai para quem já escreveu ao chatbot (a regra dos lembretes da B3).
 */

/** O envio sai das 8h às 20h, no fuso do cliente. */
export const SEND_FROM = 8;
export const SEND_UNTIL = 20;

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** O planejador olha cada régua ligada a cada hora. */
export const PLAN_EVERY_MS = HOUR;
/** Os eventos que a régua procura em cada rodada: o que venceu nas últimas 24 horas. */
const LOOKBACK_MS = DAY;

const pad = (n: number) => String(n).padStart(2, "0");

/* ------------------------------------------------------------------ horários (puros) */

/** O primeiro horário a partir de "at" dentro das 8h às 20h locais: antes das 8h, 8h; depois das 20h, 8h do dia seguinte. Pura. */
export function nextAllowed(at: number, tz: string): number {
  const w = wallClock(tz, new Date(at));
  if (w.hour < SEND_FROM) return atLocal(tz, w.year, w.month, w.day, SEND_FROM);
  if (w.hour >= SEND_UNTIL) return atLocal(tz, w.year, w.month, w.day + 1, SEND_FROM);
  return at;
}

/** "MM-DD" de hoje no fuso; no 28/02 de ano que não é bissexto, o 29/02 junto. Pura. */
export function birthdaysOn(at: number, tz: string): string[] {
  const w = wallClock(tz, new Date(at));
  const md = `${pad(w.month)}-${pad(w.day)}`;
  const leap = (w.year % 4 === 0 && w.year % 100 !== 0) || w.year % 400 === 0;
  return md === "02-28" && !leap ? [md, "02-29"] : [md];
}

export interface Slot {
  sendAt: number;
  expiresAt: number;
}

/** Aniversário: hoje, na hora escolhida (passou dela, agora); até as 20h de hoje. Pura. */
export function birthdaySlot(now: number, o: { tz: string; sendHour: number }): Slot | null {
  const w = wallClock(o.tz, new Date(now));
  const sendAt = Math.max(atLocal(o.tz, w.year, w.month, w.day, o.sendHour), now);
  const expiresAt = atLocal(o.tz, w.year, w.month, w.day, SEND_UNTIL);
  return sendAt < expiresAt ? { sendAt, expiresAt } : null;
}

/**
 * Régua por dia (sumido, sem resposta): no dia em que o prazo vence, na hora escolhida; se já
 * passou, agora; fora das 8h às 20h, na hora escolhida do dia seguinte. Vale por 24 horas. Pura.
 */
export function daySlot(dueAt: number, o: { tz: string; sendHour: number; now: number }): Slot {
  const w = wallClock(o.tz, new Date(dueAt));
  let sendAt = Math.max(atLocal(o.tz, w.year, w.month, w.day, o.sendHour), o.now);
  const s = wallClock(o.tz, new Date(sendAt));
  if (s.hour >= SEND_UNTIL) sendAt = atLocal(o.tz, s.year, s.month, s.day + 1, o.sendHour);
  else if (s.hour < SEND_FROM) sendAt = atLocal(o.tz, s.year, s.month, s.day, o.sendHour);
  return { sendAt, expiresAt: sendAt + DAY };
}

/** Régua por hora (pós-atendimento): quando o prazo vence (ou agora), dentro das 8h às 20h. Vale por 24 horas. Pura. */
export function hourSlot(dueAt: number, o: { tz: string; now: number }): Slot {
  const sendAt = nextAllowed(Math.max(dueAt, o.now), o.tz);
  return { sendAt, expiresAt: sendAt + DAY };
}

/**
 * Lembrete: N horas antes do horário (ou agora, se o horário foi marcado em cima da hora), dentro
 * das 8h às 20h, até 30 minutos antes do horário. Se a hora permitida cai tarde demais, vale o fim
 * da janela da véspera (19h55), se ainda não passou. Some 15 minutos antes do horário. Pura.
 */
export function reminderSlot(appointmentAt: number, hoursBefore: number, o: { tz: string; now: number }): Slot | null {
  const latest = appointmentAt - 30 * MIN;
  const target = Math.max(appointmentAt - hoursBefore * HOUR, o.now);
  let sendAt = nextAllowed(target, o.tz);
  if (sendAt > latest) {
    // o fim da janela antes do período sem envio em que o alvo caiu
    const w = wallClock(o.tz, new Date(target));
    const day = w.hour < SEND_FROM ? w.day - 1 : w.day;
    sendAt = atLocal(o.tz, w.year, w.month, day, SEND_UNTIL - 1, 55);
    if (sendAt < o.now || sendAt > latest) return null;
  }
  return { sendAt, expiresAt: appointmentAt - 15 * MIN };
}

/** "20/12" e "14:30" do horário no fuso do cliente (as variáveis do lembrete). Pura. */
export function appointmentLabels(at: number, tz: string): { date: string; time: string } {
  const w = wallClock(tz, new Date(at));
  return { date: `${pad(w.day)}/${pad(w.month)}`, time: `${pad(w.hour)}:${pad(w.minute)}` };
}

/** O primeiro nome do contato para a variável {{1}}; sem nome, "cliente". Pura. */
export const firstNameOf = (name: string | null | undefined) => ((name ?? "").trim().split(/\s+/)[0] || "cliente").slice(0, 60);

/* ------------------------------------------------------------------ o planejador */

interface ReguaRow {
  id: string;
  agency_id: string;
  client_id: string | null;
  bot_id: string;
  kind: ReguaKind;
  delay_value: number | null;
  send_hour: number;
  planned_at: string | null;
}

/** Quem entra na régua agora: o envio (telefone, ocasião, horário, prazo, variáveis) e se a pessoa já escreveu. */
interface Candidate extends ReguaRecipient {
  messaged: boolean;
}

interface PlanContext {
  tz: string;
  /** O cliente declarou o consentimento para lembretes (B3, parte 5). */
  declared: boolean;
  /** A categoria do modelo da régua (o lembrete de utilidade segue a regra da declaração). */
  category: string;
  now: number;
}

const iso = (ms: number) => new Date(ms).toISOString();
const delayOf = (r: Pick<ReguaRow, "kind" | "delay_value">) => r.delay_value ?? REGUA_DELAY[r.kind]?.default ?? 1;

function fromContact(c: ReguaContact, dedupeKey: string, slot: Slot, variables: string[]): Candidate {
  return { contactId: c.id, phone: c.phone, dedupeKey, variables, sendAt: iso(slot.sendAt), expiresAt: iso(slot.expiresAt), messaged: c.messaged };
}

/** Os candidatos de uma régua agora (sem as regras de quem já recebeu). */
async function candidatesOf(db: SupabaseClient, r: ReguaRow, ctx: PlanContext): Promise<Candidate[]> {
  const { tz, now } = ctx;
  const search = (by: ReguaSearch) => reguaContacts(db, r.bot_id, by);
  const n = delayOf(r);
  if (r.kind === "aniversario") {
    const slot = birthdaySlot(now, { tz, sendHour: r.send_hour });
    if (!slot) return [];
    const year = wallClock(tz, new Date(now)).year;
    return (await search({ birthdays: birthdaysOn(now, tz) })).map((c) => fromContact(c, `a:${c.id}:${year}`, slot, [firstNameOf(c.name)]));
  }
  if (r.kind === "sumido") {
    // a ausência venceu nas últimas 24 horas: a última visita (ou, sem ela, a última mensagem) faz N dias
    const range: [string, string] = [iso(now - n * DAY - LOOKBACK_MS), iso(now - n * DAY)];
    const people = [...(await search({ lastVisit: range })), ...(await search({ lastInboundNoVisit: range }))];
    return people.map((c) => {
      const ref = (c.last_visit_at ?? c.last_inbound_at)!;
      return fromContact(c, `s:${c.id}:${ref.slice(0, 10)}`, daySlot(Date.parse(ref) + n * DAY, { tz, sendHour: r.send_hour, now }), [firstNameOf(c.name)]);
    });
  }
  if (r.kind === "lembrete") {
    // o lembrete vence até daqui a 1 hora e o horário ainda está a mais de 30 minutos. Só na última
    // hora: o horário remarcado depois quase nunca pega um lembrete na fila (e o motor confere de
    // novo o horário do contato antes de enviar)
    const people = await search({ appointment: [iso(now + 30 * MIN), iso(now + n * HOUR + HOUR)] });
    const out: Candidate[] = [];
    for (const c of people) {
      const at = Date.parse(c.appointment_at!);
      const slot = reminderSlot(at, n, { tz, now });
      if (!slot) continue;
      const label = appointmentLabels(at, tz);
      out.push(fromContact(c, `l:${c.id}:${c.appointment_at}`, slot, [firstNameOf(c.name), label.date, label.time]));
    }
    return out;
  }
  if (r.kind === "pos_atendimento") {
    const range: [string, string] = [iso(now - n * HOUR - LOOKBACK_MS), iso(now - n * HOUR)];
    // a visita registrada (planilha, painel ou API)
    const visits = (await search({ lastVisit: range })).map((c) => fromContact(c, `p:v:${c.id}:${c.last_visit_at}`, hourSlot(Date.parse(c.last_visit_at!) + n * HOUR, { tz, now }), [firstNameOf(c.name)]));
    // a conversa encerrada pela equipe
    const { data: convs } = await db.from("conversations").select("id, contact_id, handled_at").eq("bot_id", r.bot_id).eq("channel", "whatsapp").gte("handled_at", range[0]).lte("handled_at", range[1]).not("contact_id", "is", null).limit(500);
    const closed = (convs ?? []) as Array<{ id: string; contact_id: string; handled_at: string }>;
    const phones = await whatsappPhonesOf(db, r.bot_id, [...new Set(closed.map((c) => c.contact_id))]);
    const fromConvs: Candidate[] = [];
    for (const cv of closed) {
      const p = phones.get(cv.contact_id);
      if (!p?.phone) continue;
      const slot = hourSlot(Date.parse(cv.handled_at) + n * HOUR, { tz, now });
      fromConvs.push({ contactId: cv.contact_id, phone: p.phone, dedupeKey: `p:c:${cv.id}:${cv.handled_at}`, variables: [firstNameOf(p.name)], sendAt: iso(slot.sendAt), expiresAt: iso(slot.expiresAt), messaged: p.messaged });
    }
    return [...visits, ...fromConvs];
  }
  // sem resposta: a última mensagem da loja (IA ou equipe) faz N dias, e o contato não respondeu
  const range: [string, string] = [iso(now - n * DAY - LOOKBACK_MS), iso(now - n * DAY)];
  const { data: convs } = await db.from("conversations").select("id, contact_id, last_reply_at, last_contact_at, handled_at").eq("bot_id", r.bot_id).eq("channel", "whatsapp").gte("last_reply_at", range[0]).lte("last_reply_at", range[1]).not("contact_id", "is", null).limit(500);
  const quiet = ((convs ?? []) as Array<{ id: string; contact_id: string; last_reply_at: string; last_contact_at: string | null; handled_at: string | null }>).filter(
    (c) => c.last_contact_at && Date.parse(c.last_contact_at) < Date.parse(c.last_reply_at) && !(c.handled_at && Date.parse(c.handled_at) >= Date.parse(c.last_reply_at)),
  );
  const phones = await whatsappPhonesOf(db, r.bot_id, [...new Set(quiet.map((c) => c.contact_id))]);
  const out: Candidate[] = [];
  for (const cv of quiet) {
    const p = phones.get(cv.contact_id);
    if (!p?.phone) continue;
    // a última mensagem da loja foi de campanha ou régua: não é conversa à espera de resposta
    const [last] = await loadMessages(db, { conversationId: cv.id, roles: ["agent", "assistant"], newestFirst: true, limit: 1 }, ["author"] as const);
    if (!last || last.author === "campanha" || last.author === "sistema") continue;
    const slot = daySlot(Date.parse(cv.last_reply_at) + n * DAY, { tz, sendHour: r.send_hour, now });
    out.push({ contactId: cv.contact_id, phone: p.phone, dedupeKey: `r:${cv.id}:${cv.last_reply_at}`, variables: [firstNameOf(p.name)], sendAt: iso(slot.sendAt), expiresAt: iso(slot.expiresAt), messaged: p.messaged });
  }
  return out;
}

/**
 * Uma rodada do planejador (no tique das campanhas): as réguas ligadas que ninguém olhou na
 * última hora, com a campanha enviando, por chatbot e na ordem de importância. Devolve quantas
 * réguas olhou e quantos envios entraram na fila.
 */
export async function planReguas(db: SupabaseClient, o: { hasTime: () => boolean; now?: number } = { hasTime: () => true }): Promise<{ reguas: number; queued: number }> {
  const now = o.now ?? Date.now();
  const { data } = await db.from("reguas").select("id, agency_id, client_id, bot_id, kind, delay_value, send_hour, planned_at").eq("active", true).order("planned_at", { ascending: true, nullsFirst: true }).limit(200);
  const due = ((data ?? []) as ReguaRow[]).filter((r) => !r.planned_at || Date.parse(r.planned_at) <= now - PLAN_EVERY_MS);
  const result = { reguas: 0, queued: 0 };
  if (!due.length) return result;
  const campaigns = await reguaCampaigns(db, due.map((r) => r.id));
  const byBot = new Map<string, ReguaRow[]>();
  for (const r of due) if (campaigns.get(r.id)?.status === "sending") byBot.set(r.bot_id, [...(byBot.get(r.bot_id) ?? []), r]);

  for (const [botId, list] of byBot) {
    if (!o.hasTime()) break;
    const clientId = list[0].client_id;
    const { data: client } = clientId ? await db.from("clients").select("timezone, utility_consent_at").eq("id", clientId).maybeSingle() : { data: null };
    const tz = (client?.timezone as string | null) ?? DEFAULT_TIMEZONE;
    const declared = Boolean(client?.utility_consent_at);
    // uma régua por pessoa a cada 24 h, contando todas as réguas do chatbot
    const { data: allOfBot } = await db.from("reguas").select("id").eq("bot_id", botId);
    const botCampaigns = [...(await reguaCampaigns(db, (allOfBot ?? []).map((x) => x.id as string))).values()].map((c) => c.id);
    const recent = await reguaRecentPhoneHashes(db, botCampaigns, iso(now - DAY));
    for (const r of [...list].sort((a, b) => REGUA_KINDS.indexOf(a.kind) - REGUA_KINDS.indexOf(b.kind))) {
      const campaign = campaigns.get(r.id)!;
      const ctx: PlanContext = { tz, declared, category: campaign.template_category.toUpperCase(), now };
      const picked: Candidate[] = [];
      for (const c of await candidatesOf(db, r, ctx)) {
        const h = phoneHash(c.phone);
        if (recent.has(h)) continue;
        // lembrete de utilidade sem a declaração do cliente: só quem já escreveu ao chatbot
        if (ctx.category === "UTILITY" && !ctx.declared && !c.messaged) continue;
        recent.add(h);
        picked.push(c);
      }
      result.queued += await queueReguaSends(db, campaign.id, botId, picked);
      await db.from("reguas").update({ planned_at: iso(now) }).eq("id", r.id);
      result.reguas++;
    }
  }
  return result;
}

/* ------------------------------------------------------------------ painel (partes 3 e 4) */

const REGUA_COLS = "id, agency_id, client_id, bot_id, kind, active, template_name, template_language, delay_value, send_hour, planned_at, updated_at";

export interface Regua extends ReguaRow {
  active: boolean;
  template_name: string | null;
  template_language: string;
  updated_at: string;
}

/** As réguas de um chatbot, pelo tipo (a que ainda não existe fica de fora: a tela mostra o padrão). */
export async function botReguas(db: SupabaseClient, botId: string): Promise<Map<ReguaKind, Regua>> {
  const { data } = await db.from("reguas").select(REGUA_COLS).eq("bot_id", botId);
  return new Map(((data ?? []) as Regua[]).map((r) => [r.kind, r]));
}

/** A régua do chatbot e do tipo; na primeira vez, criada desligada, com o prazo padrão. */
export async function ensureRegua(db: SupabaseClient, bot: { id: string; agency_id: string; client_id: string | null }, kind: ReguaKind, by: string | null): Promise<Regua> {
  const current = (await botReguas(db, bot.id)).get(kind);
  if (current) return current;
  const { data, error } = await db.from("reguas").insert({ agency_id: bot.agency_id, client_id: bot.client_id, bot_id: bot.id, kind, active: false, delay_value: REGUA_DELAY[kind]?.default ?? null, send_hour: 9, created_by: by }).select(REGUA_COLS).single();
  // duas abas ao mesmo tempo: a outra criou primeiro
  if (error || !data) {
    const again = (await botReguas(db, bot.id)).get(kind);
    if (again) return again;
    throw new Error(`régua: ${error?.message ?? "não gravada"}`);
  }
  return data as Regua;
}

/**
 * O modelo pronto da régua (parte 3): confere o texto (as regras da Meta, as variáveis que o
 * planejador manda e o portão: item proibido, bebida e remédio não entram em régua, que não pergunta
 * a idade), cria na Meta com um nome novo e guarda na régua. Um modelo que já estava aprovado
 * continua em uso até o novo ser aprovado e a régua ser ligada de novo. Erro da Meta sobe.
 */
export async function submitReguaTemplate(db: SupabaseClient, o: { regua: Pick<Regua, "id" | "kind">; ch: TemplateChannel; body: string; exempt?: readonly GateCategory[] }): Promise<{ ok: true; name: string } | { ok: false; message: string }> {
  const body = o.body.trim();
  const problem = reguaTemplateProblem(o.regua.kind, body);
  if (problem) return { ok: false, message: problem };
  const gate = templateGate(body, o.exempt ?? []);
  if (gate.prohibited.length) return { ok: false, message: `O texto cita um item que não pode ser oferecido pelo WhatsApp (${gate.prohibited.join(", ")}).` };
  if (gate.regulated.length) return { ok: false, message: `A régua não confere a idade de quem recebe: tire do texto o que é só para maiores (${gate.regulated.join(", ")}).` };
  const name = reguaTemplateName(o.regua.kind, (await listTemplates(o.ch)).map((t) => t.name));
  await createTemplate(o.ch, { name, category: REGUA_CATEGORY[o.regua.kind], body, examples: REGUA_EXAMPLES[o.regua.kind] });
  await db.from("reguas").update({ template_name: name, template_language: TEMPLATE_LANGUAGE, updated_at: new Date().toISOString() }).eq("id", o.regua.id);
  return { ok: true, name };
}

/** O prazo e a hora da régua (dentro dos limites do tipo). Devolve o problema, ou null. */
export async function saveReguaSettings(db: SupabaseClient, regua: Pick<Regua, "id" | "kind">, s: { delay: number | null; sendHour: number | null }): Promise<string | null> {
  const limits = REGUA_DELAY[regua.kind];
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), planned_at: null };
  if (limits) {
    if (!Number.isInteger(s.delay) || s.delay! < limits.min || s.delay! > limits.max) return `O prazo vai de ${limits.min} a ${limits.max} ${limits.unit}.`;
    patch.delay_value = s.delay;
  }
  if (s.sendHour !== null) {
    if (!Number.isInteger(s.sendHour) || s.sendHour < 8 || s.sendHour > 19) return "A hora do envio vai das 8h às 19h.";
    patch.send_hour = s.sendHour;
  }
  await db.from("reguas").update(patch).eq("id", regua.id);
  return null;
}

/**
 * Até quantas pessoas a régua alcança nos próximos 30 dias, antes do aceite, do SAIR e da regra de
 * uma régua por dia. Pós-atendimento e sem resposta usam os últimos 30 dias como referência.
 */
export async function estimateRegua(db: SupabaseClient, botId: string, kind: ReguaKind, delay: number | null, tz: string, now = Date.now()): Promise<number> {
  const n = delay ?? REGUA_DELAY[kind]?.default ?? 1;
  const count = (by: ReguaSearch) => reguaContactCount(db, botId, by);
  const month = 30 * DAY;
  if (kind === "aniversario") {
    const days = new Set<string>();
    for (let i = 0; i < 30; i++) for (const md of birthdaysOn(now + i * DAY, tz)) days.add(md);
    return count({ birthdays: [...days] });
  }
  if (kind === "sumido") {
    const range: [string, string] = [iso(now - n * DAY), iso(now - n * DAY + month)];
    return (await count({ lastVisit: range })) + (await count({ lastInboundNoVisit: range }));
  }
  if (kind === "lembrete") return count({ appointment: [iso(now), iso(now + month)] });
  if (kind === "pos_atendimento") {
    const { count: closed } = await db.from("conversations").select("id", { count: "exact", head: true }).eq("bot_id", botId).eq("channel", "whatsapp").gte("handled_at", iso(now - month)).not("contact_id", "is", null);
    return (await count({ lastVisit: [iso(now - month), iso(now)] })) + (closed ?? 0);
  }
  const { data } = await db.from("conversations").select("last_reply_at, last_contact_at").eq("bot_id", botId).eq("channel", "whatsapp").gte("last_reply_at", iso(now - month)).not("contact_id", "is", null).limit(5000);
  return ((data ?? []) as Array<{ last_reply_at: string; last_contact_at: string | null }>).filter((c) => c.last_contact_at && Date.parse(c.last_contact_at) < Date.parse(c.last_reply_at)).length;
}

/** Na tela, as réguas na ordem da spec. */
export const REGUA_DISPLAY: ReguaKind[] = ["aniversario", "sumido", "pos_atendimento", "lembrete", "sem_resposta"];

export interface ReguaPanelItem {
  kind: ReguaKind;
  regua: Regua | null;
  delay: number | null;
  sendHour: number;
  template: ReguaTemplateState;
  /** O texto para a caixa de edição: o do modelo na Meta, ou o sugerido. */
  draft: string;
  state: "desligada" | "ligada" | "pausada";
  pauseReason: string | null;
  /** O modelo que a campanha da régua usa (um novo pode estar em análise). */
  inUse: string | null;
  numbers: ReturnType<typeof reportNumbers> | null;
  estimate: { people: number; costBrl: number };
}

/** O que a tela das réguas mostra de cada régua do chatbot. A lista de modelos da Meta é lida uma vez. */
export async function reguasPanel(db: SupabaseClient, o: { botId: string; company: string; ch: TemplateChannel | null; tz: string; now?: number }): Promise<{ items: ReguaPanelItem[]; templatesError: string | null }> {
  const reguas = await botReguas(db, o.botId);
  const campaigns = await reguaCampaigns(db, [...reguas.values()].map((r) => r.id));
  let templates: Template[] = [];
  let templatesError: string | null = null;
  if (o.ch) {
    try {
      templates = await listTemplates(o.ch);
    } catch (e) {
      templatesError = (e as Error).message;
    }
  }
  const prices = referencePrices();
  const items = await Promise.all(
    REGUA_DISPLAY.map(async (kind): Promise<ReguaPanelItem> => {
      const regua = reguas.get(kind) ?? null;
      const campaign = regua ? campaigns.get(regua.id) : undefined;
      const template = reguaTemplateState(kind, templates, regua?.template_name ?? null);
      const delay = regua?.delay_value ?? REGUA_DELAY[kind]?.default ?? null;
      const people = await estimateRegua(db, o.botId, kind, delay, o.tz, o.now);
      const price = prices[(template.category ?? REGUA_CATEGORY[kind]).toLowerCase()] ?? prices.marketing;
      return {
        kind,
        regua,
        delay,
        sendHour: regua?.send_hour ?? 9,
        template,
        draft: template.body ?? reguaTemplateBody(kind, o.company),
        state: !regua?.active ? "desligada" : campaign?.status === "sending" ? "ligada" : "pausada",
        pauseReason: regua?.active && campaign?.status !== "sending" ? (campaign?.pause_reason ?? null) : null,
        inUse: campaign?.template_name ?? null,
        numbers: campaign ? reportNumbers(await campaignReport(db, campaign.id)) : null,
        estimate: { people, costBrl: Math.round(people * price * 100) / 100 },
      };
    }),
  );
  return { items, templatesError };
}

/**
 * Liga a régua com o modelo dela aprovado na Meta (a campanha é criada ou volta a enviar, com o
 * modelo novo, se mudou) ou desliga (o que estava na fila espera; passado o prazo, não sai). Ligar
 * sem o modelo aprovado devolve o motivo.
 */
export async function setReguaActive(db: SupabaseClient, o: { regua: Regua; on: boolean; ch: TemplateChannel | null; by: string | null }): Promise<string | null> {
  if (!o.on) {
    await db.from("reguas").update({ active: false, updated_at: new Date().toISOString() }).eq("id", o.regua.id);
    await stopReguaCampaign(db, o.regua.id);
    return null;
  }
  if (!o.ch) return "Conecte o WhatsApp do chatbot: as réguas saem pelo número dele.";
  const state = reguaTemplateState(o.regua.kind, await listTemplates(o.ch), o.regua.template_name);
  if (state.status !== "aprovado") return state.status === "ausente" ? "Crie o modelo da régua antes de ligar." : `O modelo da régua ainda não está aprovado pela Meta (${state.label}).`;
  await ensureReguaCampaign(db, { reguaId: o.regua.id, agencyId: o.regua.agency_id, clientId: o.regua.client_id, botId: o.regua.bot_id, name: `Régua ${REGUA_LABEL[o.regua.kind]}`, template: { name: o.regua.template_name!, language: o.regua.template_language, category: state.category ?? REGUA_CATEGORY[o.regua.kind] }, createdBy: o.by });
  await db.from("reguas").update({ active: true, planned_at: null, updated_at: new Date().toISOString() }).eq("id", o.regua.id);
  return null;
}
