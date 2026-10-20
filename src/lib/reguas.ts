import type { SupabaseClient } from "@supabase/supabase-js";
import { reguaContacts, whatsappPhonesOf, phoneHash, type ReguaContact, type ReguaSearch } from "./contacts";
import { queueReguaSends, reguaCampaigns, reguaRecentPhoneHashes, type ReguaRecipient } from "./campaigns";
import { loadMessages } from "./messages";
import { DEFAULT_TIMEZONE, atLocal, wallClock } from "./timezone";

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

export type ReguaKind = "aniversario" | "sumido" | "pos_atendimento" | "lembrete" | "sem_resposta";

/** Na ordem de importância: numa mesma rodada, a pessoa recebe a primeira régua que couber. */
export const REGUA_KINDS: ReguaKind[] = ["lembrete", "aniversario", "pos_atendimento", "sem_resposta", "sumido"];

export const REGUA_LABEL: Record<ReguaKind, string> = {
  aniversario: "Aniversário",
  sumido: "Faz tempo que você não vem",
  pos_atendimento: "Pós-atendimento",
  lembrete: "Lembrete antes do horário",
  sem_resposta: "Sem resposta",
};

/** O prazo de cada régua: a unidade, o padrão e os limites (o aniversário não tem prazo). */
export const REGUA_DELAY: Record<ReguaKind, { unit: "dias" | "horas"; default: number; min: number; max: number } | null> = {
  aniversario: null,
  sumido: { unit: "dias", default: 30, min: 7, max: 365 },
  pos_atendimento: { unit: "horas", default: 48, min: 1, max: 168 },
  lembrete: { unit: "horas", default: 24, min: 1, max: 72 },
  sem_resposta: { unit: "dias", default: 2, min: 1, max: 30 },
};

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
