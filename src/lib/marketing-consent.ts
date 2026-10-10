import type { SupabaseClient } from "@supabase/supabase-js";
import { activeSuppressions, contactHash, revoke, suppress, suppressionScope } from "./suppression";
import { ageRecord } from "./gate/age";
import { displayPhone } from "./phone";
import type { MessageComponent } from "./components";

/*
 * Consentimento de marketing com prova (leva B3, parte 1; spec Peça 7 "Consentimento no contato"):
 * cada sim ou não fica em marketing_consents com a origem, o texto mostrado, a versão e a data,
 * pelo hash do número (como a supressão: sobrevive à exclusão do contato). No chat, o bot oferece
 * novidades uma vez por contato, com botões Sim e Não, quando a agência liga a opção no chatbot; a
 * IA nunca dispara marketing, só a oferta. SAIR, o descadastro do WhatsApp e o erro 131050 revogam;
 * "Foi engano" grava um novo sim. No MVP, só WhatsApp (as campanhas são só por lá).
 */

export type ConsentState = "none" | "granted" | "declined" | "revoked";
export type ConsentSource = "chat" | "panel" | "import" | "api";

/** Contato no WhatsApp: escopo da supressão (waba:<id> ou bot:<id>) e o número. */
export interface ConsentTarget {
  scope: string;
  contact: string;
}

export interface ConsentRow {
  id: number;
  granted: boolean;
  source: ConsentSource;
  text: string;
  text_version: string;
  collected_by: string | null;
  collected_at: string;
  revoked_at: string | null;
  revoke_source: string | null;
}

/* ------------------------------------------------------------------ textos fixos da oferta */

export const OPTIN_YES = "mkt_optin_yes";
export const OPTIN_NO = "mkt_optin_no";
/** Versão do texto da oferta: muda quando o texto mudar (a prova guarda qual foi mostrado). */
export const OPTIN_VERSION = "oferta-chat-1";
export const OPTIN_BUTTONS = [
  { id: OPTIN_YES, title: "Sim, quero" },
  { id: OPTIN_NO, title: "Não, obrigado" },
];

export const optInOfferText = (company: string) => `Quer receber novidades e promoções da ${company} por aqui no WhatsApp? Você pode parar quando quiser respondendo SAIR.`;
export const optInYesText = (company: string) => `Pronto! Você vai receber as novidades da ${company} por aqui. Para parar, é só responder SAIR.`;
export const OPTIN_NO_TEXT = "Tudo bem, não vou mandar promoções. O atendimento continua normal por aqui.";

/** A oferta respondida por digitação vale por 24 horas (como a pergunta de 18+). */
export const OPTIN_TYPED_HOURS = 24;

const strip = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const TYPED_YES = new Set(["sim", "sim quero", "quero", "quero sim", "pode", "pode sim", "pode mandar", "claro", "aceito", "sim aceito", "s"]);
const TYPED_NO = new Set(["nao", "nao quero", "nao obrigado", "nao obrigada", "agora nao", "nao precisa", "n"]);

/** Sim ou não digitado logo depois da oferta (até 24 horas). Pura. */
export function typedOptInAnswer(text: string | null, offeredAt: string | null | undefined, now = Date.now()): "sim" | "nao" | null {
  if (!text || !offeredAt || now - Date.parse(offeredAt) > OPTIN_TYPED_HOURS * 3_600_000) return null;
  const t = strip(text);
  if (TYPED_YES.has(t)) return "sim";
  if (TYPED_NO.has(t)) return "nao";
  return null;
}

/* ------------------------------------------------------------------ quando oferecer */

const CLOSING = /^(?:(?:ok|ta bom|ta|beleza|blz|perfeito|otimo|show|entendi|certo|legal|top) )*(?:muito )?(?:obrigad[oa]|obg|brigad[oa]|valeu|vlw|agradeco|tchau|ate (?:mais|logo|breve|amanha)|era (?:so )?isso|so isso|nada mais)(?: (?:mesmo|pela ajuda|viu|ta|tchau|de novo|demais|valeu|vlw|(?:muito )?obrigad[oa]))*$/;

/** Agradecimento ou despedida curta ("obrigado!", "valeu, era só isso"). Pura. */
export const isClosingMessage = (text: string | null | undefined) => {
  const t = strip(text ?? "");
  return t.length > 0 && t.length <= 60 && CLOSING.test(t);
};

/**
 * A oferta sai agora? Uma vez por contato, só com a opção ligada no chatbot, sem resposta anterior
 * (sim, não ou revogado), sem descadastro ativo e nunca para quem disse que não tem 18 anos; no fim
 * natural da conversa (o contato deixou o contato ou agradeceu/se despediu). Pura.
 */
export function offerDue(o: { enabled: boolean; state: ConsentState; offeredAt: string | null; suppressed: boolean; under18: boolean; leadSaved: boolean; closing: boolean }): boolean {
  return o.enabled && o.state === "none" && !o.offeredAt && !o.suppressed && !o.under18 && (o.leadSaved || o.closing);
}

/** Estado pelo registro mais recente (a lista vem do mais novo para o mais velho). Pura. */
export function consentStateOf(rows: Array<Pick<ConsentRow, "granted" | "revoked_at">>): ConsentState {
  const last = rows[0];
  if (!last) return "none";
  if (!last.granted) return "declined";
  return last.revoked_at ? "revoked" : "granted";
}

/* ------------------------------------------------------------------ banco */

const CONSENT_COLS = "id, granted, source, text, text_version, collected_by, collected_at, revoked_at, revoke_source";

/** Registros do contato, do mais novo para o mais velho. */
export async function consentHistory(db: SupabaseClient, t: ConsentTarget, limit = 20): Promise<ConsentRow[]> {
  const { data, error } = await db
    .from("marketing_consents")
    .select(CONSENT_COLS)
    .eq("channel", "whatsapp")
    .eq("scope", t.scope)
    .eq("contact_hash", contactHash("whatsapp", t.contact))
    .order("collected_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`consentimento: ${error.message}`);
  return (data ?? []) as ConsentRow[];
}

export interface ConsentOrigin {
  agencyId: string | null;
  clientId: string | null;
  botId: string | null;
  wabaId: string | null;
  contactId: string | null;
}

/**
 * Grava um sim ou um não. O sim é um novo opt-in da própria pessoa: desfaz o descadastro de
 * promoções (o de lembretes continua).
 */
export async function recordConsent(db: SupabaseClient, t: ConsentTarget & ConsentOrigin & { granted: boolean; source: ConsentSource; text: string; textVersion: string; collectedBy?: string | null; collectedAt?: string | null; keepSuppression?: boolean; quiet?: boolean }): Promise<void> {
  const { data: row, error } = await db.from("marketing_consents").insert({
    agency_id: t.agencyId,
    client_id: t.clientId,
    bot_id: t.botId,
    waba_id: t.wabaId,
    contact_id: t.contactId,
    channel: "whatsapp",
    scope: t.scope,
    contact_hash: contactHash("whatsapp", t.contact),
    granted: t.granted,
    source: t.source,
    text: t.text.slice(0, 1000),
    text_version: t.textVersion,
    collected_by: t.collectedBy ?? null,
    ...(t.collectedAt ? { collected_at: t.collectedAt } : {}),
  }).select("id").single();
  if (error) throw new Error(`consentimento: ${error.message}`);
  // webhooks: contact.opted_in (quiet: o "Foi engano" já avisa pelo descadastro desfeito)
  if (t.granted && !t.quiet && row?.id) {
    const { queueConsentEvent } = await import("./platform-events");
    await queueConsentEvent(db, { channel: "whatsapp", scope: t.scope, contact: t.contact, type: "marketing", source: t.source === "import" ? "panel" : t.source, granted: true, key: `consent:${row.id}` });
  }
  // só o sim dado pela própria pessoa no chat tira do descadastro; o registrado pela empresa (painel,
  // planilha) não desfaz um SAIR (e o envio confere a supressão de qualquer jeito)
  if (!t.granted || t.source !== "chat" || t.keepSuppression) return;
  const target = { channel: "whatsapp" as const, scope: t.scope, contact: t.contact };
  const active = (await activeSuppressions(db, target)).map((s) => s.kind);
  if (active.includes("marketing")) await revoke(db, { ...target, kind: "marketing", source: `optin:${t.source}` });
  if (active.includes("all")) {
    // "tudo" vira só lembretes: o sim vale para as promoções
    await revoke(db, { ...target, kind: "all", source: `optin:${t.source}` });
    await suppress(db, { ...target, kind: "utility", reason: "opt_out", source: "optin:resto" });
  }
}

/** Revoga os sins ativos (SAIR, descadastro do WhatsApp, erro 131050). Devolve quantos. */
export async function revokeConsents(db: SupabaseClient, t: ConsentTarget, source: string): Promise<number> {
  const { data, error } = await db
    .from("marketing_consents")
    .update({ revoked_at: new Date().toISOString(), revoke_source: source })
    .eq("channel", "whatsapp")
    .eq("scope", t.scope)
    .eq("contact_hash", contactHash("whatsapp", t.contact))
    .eq("granted", true)
    .is("revoked_at", null)
    .select("id");
  if (error) throw new Error(`consentimento: ${error.message}`);
  return data?.length ?? 0;
}

/**
 * "Foi engano" depois do SAIR: o sim revogado por aquele SAIR volta como um novo sim da própria
 * pessoa (origem chat, com o texto anterior).
 */
export async function restoreConsents(db: SupabaseClient, t: ConsentTarget, revokedBy: string): Promise<boolean> {
  const { data } = await db
    .from("marketing_consents")
    .select("agency_id, client_id, bot_id, waba_id, contact_id, text")
    .eq("channel", "whatsapp")
    .eq("scope", t.scope)
    .eq("contact_hash", contactHash("whatsapp", t.contact))
    .eq("revoke_source", revokedBy)
    .order("collected_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return false;
  await recordConsent(db, {
    ...t,
    agencyId: data.agency_id as string | null,
    clientId: data.client_id as string | null,
    botId: data.bot_id as string | null,
    wabaId: data.waba_id as string | null,
    contactId: data.contact_id as string | null,
    granted: true,
    source: "chat",
    text: `Foi engano (desfez o SAIR). Antes: ${data.text as string}`,
    textVersion: "foi-engano-1",
    quiet: true,
  });
  return true;
}

/** Rótulo curto para o painel. Pura. */
export const CONSENT_LABEL: Record<ConsentState, string> = { none: "sem resposta", granted: "aceitou", declined: "recusou", revoked: "revogado" };
export const SOURCE_LABEL: Record<ConsentSource, string> = { chat: "pelo chat", panel: "pelo painel", import: "por planilha", api: "pela API" };

/** Situação de novidades de cada contato (pelo registro mais recente ligado à ficha), para a lista do painel. */
export async function consentByContact(db: SupabaseClient, contactIds: string[]): Promise<Map<string, ConsentState>> {
  const out = new Map<string, ConsentState>();
  if (!contactIds.length) return out;
  const { data, error } = await db.from("marketing_consents").select("contact_id, granted, revoked_at, collected_at").in("contact_id", contactIds).order("collected_at", { ascending: false }).order("id", { ascending: false });
  if (error) throw new Error(`consentimento: ${error.message}`);
  const seen = new Set<string>();
  for (const r of data ?? []) {
    const id = r.contact_id as string;
    if (seen.has(id)) continue;
    seen.add(id);
    out.set(id, consentStateOf([{ granted: r.granted as boolean, revoked_at: (r.revoked_at as string | null) ?? null }]));
  }
  return out;
}

/**
 * Aceites da planilha (leva B3): um registro por contato, com a origem e a data informadas pela
 * empresa. Pula quem já tem um aceite ativo (importar de novo não duplica a prova). Não mexe no
 * descadastro: só o sim dado no chat tira dele.
 */
export async function recordImportedConsents(db: SupabaseClient, items: Array<ConsentTarget & ConsentOrigin & { text: string; collectedAt: string }>, o: { textVersion: string; collectedBy: string | null }): Promise<{ recorded: number; skipped: number }> {
  const active = await consentByContact(db, items.map((i) => i.contactId).filter((x): x is string => Boolean(x)));
  const todo = items.filter((i) => !(i.contactId && active.get(i.contactId) === "granted"));
  for (let i = 0; i < todo.length; i += 500) {
    const { error } = await db.from("marketing_consents").insert(
      todo.slice(i, i + 500).map((t) => ({
        agency_id: t.agencyId,
        client_id: t.clientId,
        bot_id: t.botId,
        waba_id: t.wabaId,
        contact_id: t.contactId,
        channel: "whatsapp",
        scope: t.scope,
        contact_hash: contactHash("whatsapp", t.contact),
        granted: true,
        source: "import",
        text: t.text.slice(0, 1000),
        text_version: o.textVersion,
        collected_by: o.collectedBy,
        collected_at: t.collectedAt,
      })),
    );
    if (error) throw new Error(`consentimento: ${error.message}`);
  }
  return { recorded: todo.length, skipped: items.length - todo.length };
}

/* ------------------------------------------------------------------ oferta no site (leva B3, parte 2c) */

/** Versão do texto da oferta no site (a prova guarda qual foi mostrado). */
export const OPTIN_SITE_VERSION = "oferta-site-1";
/** Os botões da oferta, como o widget mostra. */
export const OPTIN_COMPONENT: MessageComponent = { type: "options", options: OPTIN_BUTTONS };

export const optInSiteText = (company: string, phone: string) => `Quer receber novidades e promoções da ${company} no seu WhatsApp (${displayPhone(phone)})? Você pode parar quando quiser respondendo SAIR por lá.`;
export const optInSiteYesText = (company: string, phone: string) => `Pronto! Você vai receber as novidades da ${company} no WhatsApp ${displayPhone(phone)}. Para parar, é só responder SAIR por lá.`;

/** A mensagem do assistente traz a oferta do site? Pura. */
export const isSiteOffer = (content: string | null | undefined, company: string) => Boolean(content?.includes(`Quer receber novidades e promoções da ${company} no seu WhatsApp (`));

/** O número do WhatsApp conectado ao chatbot dá o escopo do aceite (sem WhatsApp, não há oferta). */
export async function whatsappScopeOfBot(db: SupabaseClient, botId: string): Promise<{ scope: string; wabaId: string | null } | null> {
  const { data } = await db.from("whatsapp_channels").select("waba_id").eq("bot_id", botId).is("disconnected_at", null).maybeSingle();
  if (!data) return null;
  const wabaId = (data.waba_id as string | null) ?? null;
  return { scope: suppressionScope({ wabaId, botId }), wabaId };
}

/** O WhatsApp digitado no site pode receber a oferta? Sem resposta anterior, sem descadastro e sem "não" ao 18+. */
export async function siteOfferDue(db: SupabaseClient, botId: string, phone: string): Promise<boolean> {
  const wa = await whatsappScopeOfBot(db, botId);
  if (!wa) return false;
  const target = { scope: wa.scope, contact: phone };
  const [history, suppressed, age] = await Promise.all([
    consentHistory(db, target, 1),
    activeSuppressions(db, { channel: "whatsapp", ...target }),
    ageRecord(db, { botId, channel: "whatsapp", contact: phone }),
  ]);
  return consentStateOf(history) === "none" && !suppressed.some((s) => s.kind !== "utility") && age?.status !== "nao";
}


/**
 * O chatbot conectou uma conta do WhatsApp: se era outra (número ou WABA diferente), o SAIR e o
 * aceite de novidades vão junto para o escopo novo (migração 0084). Nunca derruba a conexão.
 */
export async function carryWhatsAppPreferences(db: SupabaseClient, botId: string, wabaId: string | null): Promise<void> {
  const { data, error } = await db.rpc("carry_whatsapp_preferences", { p_bot: botId, p_to: suppressionScope({ wabaId, botId }) });
  if (error) console.error("whatsapp: SAIR e aceite não levados para a conta nova", error.message);
  else if (data?.suppressions || data?.consents) console.log("whatsapp: preferências levadas da conta anterior", JSON.stringify(data));
}

/** Situação do aceite de vários contatos de uma vez (público de campanha). Chave: o contato informado. */
export async function consentStatesMany(db: SupabaseClient, scope: string, contacts: string[]): Promise<Map<string, ConsentState>> {
  const byHash = new Map(contacts.map((c) => [contactHash("whatsapp", c), c]));
  const hashes = [...byHash.keys()];
  const out = new Map<string, ConsentState>();
  for (let i = 0; i < hashes.length; i += 300) {
    const { data, error } = await db
      .from("marketing_consents")
      .select("contact_hash, granted, revoked_at")
      .eq("channel", "whatsapp")
      .eq("scope", scope)
      .in("contact_hash", hashes.slice(i, i + 300))
      .order("collected_at", { ascending: false })
      .order("id", { ascending: false });
    if (error) throw new Error(`consentimento: ${error.message}`);
    // o primeiro de cada contato é o mais recente
    for (const r of data ?? []) {
      const contact = byHash.get(r.contact_hash as string)!;
      if (!out.has(contact)) out.set(contact, consentStateOf([r as { granted: boolean; revoked_at: string | null }]));
    }
  }
  return out;
}
