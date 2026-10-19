import type { SupabaseClient } from "@supabase/supabase-js";
import { tool, type Tool } from "ai";
import { z } from "zod";
import { openNullable, sealField, scopeOfBot } from "./field-cipher";
import { contextHashOf } from "./identity";
import { contactActiveLinkId, externalIdHash, setActiveLink } from "./contacts";
import { activeLinks, unlinkLink, type LinkRow } from "./pairing";
import { emitLinkEvent } from "./webhooks";
import { findMessage } from "./messages";
import { parseComponents, type MessageComponent } from "./components";
import { normalizeKeyword } from "./routines";
import { typedChoice } from "./routine-run";
import { endActiveRoutine, type RoutineIdentityPort } from "./routine-engine";
import type { ActionIdentity, IdentityAccount } from "./actions";
import type { ChatIdentity } from "./widget-identity";

/*
 * Identificação pelo roteiro (leva B2', parte 2c): a ação de um passo do roteiro devolve quem é a
 * pessoa (identity: external_id, nome e as contas dela). A conversa fica identificada: as próximas
 * ações recebem o nível usuario e a conta escolhida, já na mesma vez. Regras:
 * - com mais de uma conta, a pessoa escolhe por botão (o roteiro espera); depois troca com
 *   trocar_contexto;
 * - no WhatsApp e no Instagram, o BoaVoz pede licença para lembrar o número ("Lembrar este número"
 *   / "Não lembrar"), logo depois da primeira resposta sem botões; sem licença, vale só para esta
 *   conversa;
 * - número lembrado: a conversa nova sempre começa por "Estou falando com Ana?" ("Sim, sou eu" /
 *   "Sou outra pessoa"); a mensagem que chegou espera a resposta e é respondida depois. "Sou outra
 *   pessoa" esquece o número (o titular pode ter mudado e falar pelo mesmo número);
 * - quantos dados pedir para identificar é decisão do sistema da empresa (o roteiro pede, a ação
 *   decide).
 * A identidade vale 24 horas desde a identificação ou a confirmação. Fica em
 * conversation_identities, cifrada com a chave do cliente, fora das colunas do token e do
 * pareamento (que prendem a conversa do site ao token).
 */

export const IDENTITY_TTL_MS = 24 * 3_600_000;
export const IDENTITY_BUTTON_PREFIX = "idn:";
export type MetaChannel = "whatsapp" | "instagram";
const isMeta = (c: string): c is MetaChannel => c === "whatsapp" || c === "instagram";

export interface IdentityState {
  externalId: string;
  name: string | null;
  accounts: IdentityAccount[];
  /** A conta escolhida (null: mais de uma e a pessoa ainda não escolheu, ou nenhuma conta). */
  active: number | null;
  /** O número está lembrado para esta pessoa (veio do "Sim, sou eu" ou a pessoa deu licença). */
  remembered: boolean;
}

/** A pergunta "Estou falando com...?" em aberto: o vínculo perguntado e a mensagem que espera a resposta. */
export interface PendingCheck {
  linkId: string;
  text: string;
  texts: string[];
}

export interface ConversationIdentity {
  /** A identidade da conversa (null: nenhuma, ou venceu). */
  state: IdentityState | null;
  consent: "due" | "asked" | null;
  check: PendingCheck | null;
  checkAt: string | null;
}

export const CHECK_YES = "Sim, sou eu";
export const CHECK_NO = "Sou outra pessoa";
export const CONSENT_NO = "Não lembrar";
export const consentYes = (c: MetaChannel) => (c === "instagram" ? "Lembrar este perfil" : "Lembrar este número");
const thing = (c: MetaChannel) => (c === "instagram" ? "perfil" : "número");

export const IDENTITY_TEXTS = {
  consent: (c: MetaChannel) => `Posso lembrar deste ${thing(c)} para as próximas conversas? Nas próximas, eu pergunto se é você antes de mostrar qualquer dado da conta. Para esquecer depois, é só mandar "desconectar".`,
  remembered: (c: MetaChannel) => `Combinado: vou lembrar deste ${thing(c)}. Nas próximas conversas, eu confirmo se é você antes de mostrar dados da conta.`,
  notRemembered: "Tudo bem, não vou lembrar. A identificação vale só para esta conversa.",
  check: (name: string | null, c: MetaChannel) => (name ? `Estou falando com ${name}?` : `Estou falando com a pessoa que se identificou por este ${thing(c)}?`),
  stale: "Esse botão não vale mais. Se precisar de alguma coisa, é só me dizer.",
} as const;

/** O que a IA lê nesta vez. */
export const IDENTITY_NOTES = {
  chose: (label: string) => `A pessoa escolheu a conta "${label}": as próximas consultas usam essa conta.`,
  otherPerson:
    "A pessoa disse que não é quem estava lembrado neste número: o número foi esquecido e a conversa segue sem conta identificada. Responda à mensagem dela sem dados de conta; se ela precisar de algo da conta, a identificação é pelo roteiro.",
  checkPending: "Este número está lembrado, mas a pessoa ainda não confirmou se é ela (os botões estão numa mensagem anterior): responda sem dados de conta.",
} as const;

/* ------------------------------------------------------------------ puras */

/** Nome da conta no botão e para a IA ("Conta 2" quando o sistema não mandou). Pura. */
export const accountLabel = (a: IdentityAccount, i: number) => a.label ?? `Conta ${i + 1}`;

/** A pessoa tem mais de uma conta e ainda não escolheu. Pura. */
export const isChoosing = (s: IdentityState | null) => Boolean(s && s.active === null && s.accounts.length > 1);

/** A identidade que a ação devolveu: com uma conta só, ela já é a escolhida. Pura. */
export function stateOf(id: ActionIdentity, remembered: boolean): IdentityState {
  return { externalId: id.externalId, name: id.name, accounts: id.accounts, active: id.accounts.length === 1 ? 0 : null, remembered };
}

/** Identidade para a IA e para as ações (o contexto vai só para as ações). Pura. */
export function chatIdentityOfState(s: IdentityState): ChatIdentity {
  const acc = s.active !== null ? (s.accounts[s.active] ?? null) : null;
  return {
    externalId: s.externalId,
    userDisplay: s.name ? { name: s.name } : null,
    contextDisplay: acc && s.active !== null ? accountLabel(acc, s.active) : null,
    context: acc?.context ?? null,
    source: "routine",
    ageVerified: null,
    otherContexts: s.active !== null ? s.accounts.flatMap((a, i) => (i === s.active ? [] : [accountLabel(a, i)])) : [],
  };
}

/** Marca da pessoa nos botões (parte do hash do id externo): o toque antigo, de outra pessoa, não vale. */
const tagOf = (externalId: string) => externalIdHash(externalId).slice(0, 12);

/** Os botões das contas (até 3 viram botões no WhatsApp; mais, ou nome longo, viram lista). Pura. */
export function accountButtons(s: IdentityState): MessageComponent {
  const t = tagOf(s.externalId);
  return { type: "options", options: s.accounts.map((a, i) => ({ id: `${IDENTITY_BUTTON_PREFIX}conta:${t}:${i}`, title: accountLabel(a, i) })) };
}

/** "Lembrar este número" / "Não lembrar". Pura. */
export function consentButtons(channel: MetaChannel, s: IdentityState): MessageComponent {
  const t = tagOf(s.externalId);
  return {
    type: "options",
    options: [
      { id: `${IDENTITY_BUTTON_PREFIX}lembrar:${t}`, title: consentYes(channel) },
      { id: `${IDENTITY_BUTTON_PREFIX}nao:${t}`, title: CONSENT_NO },
    ],
  };
}

/** "Sim, sou eu" / "Sou outra pessoa". Pura. */
export function checkButtons(linkId: string): MessageComponent {
  return {
    type: "options",
    options: [
      { id: `${IDENTITY_BUTTON_PREFIX}eu:${linkId}`, title: CHECK_YES },
      { id: `${IDENTITY_BUTTON_PREFIX}outra:${linkId}`, title: CHECK_NO },
    ],
  };
}

export type IdentityClick = { kind: "conta"; tag: string; index: number } | { kind: "lembrar" | "nao"; tag: string } | { kind: "eu" | "outra"; linkId: string };

/** O toque é num botão da identificação? Pura. */
export function parseIdentityButton(id: string | null | undefined): IdentityClick | null {
  if (!id?.startsWith(IDENTITY_BUTTON_PREFIX)) return null;
  const conta = /^idn:conta:([0-9a-f]{12}):(\d{1,2})$/.exec(id);
  if (conta) return { kind: "conta", tag: conta[1], index: Number(conta[2]) };
  const consent = /^idn:(lembrar|nao):([0-9a-f]{12})$/.exec(id);
  if (consent) return { kind: consent[1] as "lembrar" | "nao", tag: consent[2] };
  const check = /^idn:(eu|outra):([0-9a-f-]{36})$/.exec(id);
  if (check) return { kind: check[1] as "eu" | "outra", linkId: check[2] };
  return null;
}

const TYPED_YES = new Set(["sim", "s", "sou", "sou eu", "sim sou eu", "sim sou", "sou sim", "isso", "isso mesmo", "pode", "pode sim", "pode lembrar", "lembrar", "lembra", "quero", "ok"]);
const TYPED_NO = new Set(["nao", "n", "nao sou", "nao sou eu", "outra pessoa", "sou outra pessoa", "nao lembrar", "nao precisa", "nao quero", "nao obrigado", "nao obrigada"]);

/** Sim ou não digitado (só vale logo depois da pergunta com os botões). Pura. */
export function typedYesNo(text: string): "sim" | "nao" | null {
  const t = normalizeKeyword(text);
  return TYPED_YES.has(t) ? "sim" : TYPED_NO.has(t) ? "nao" : null;
}

/** O pedido de licença que falta, com os botões (só no WhatsApp e no Instagram). Pura. */
export function consentPrompt(channel: string, c: Pick<ConversationIdentity, "state" | "consent">): { text: string; component: MessageComponent } | null {
  if (!isMeta(channel) || !c.state || c.consent !== "due" || c.state.remembered || isChoosing(c.state)) return null;
  return { text: IDENTITY_TEXTS.consent(channel), component: consentButtons(channel, c.state) };
}

/** A conta que a pessoa pediu ("trocar para a da Rua das Flores"): uma, nenhuma ou ambígua. Pura. */
export function matchAccount(s: IdentityState, wanted: string): { index: number } | { options: string[] } {
  const w = normalizeKeyword(wanted);
  const labels = s.accounts.map((a, i) => accountLabel(a, i));
  const hits = labels.flatMap((l, i) => {
    const n = normalizeKeyword(l);
    return w && n && (n.includes(w) || w.includes(n)) ? [i] : [];
  });
  return hits.length === 1 ? { index: hits[0] } : { options: (hits.length ? hits : labels.map((_, i) => i)).map((i) => labels[i]) };
}

/* ------------------------------------------------------------------ banco */

interface Where {
  conversationId: string;
  botId: string;
  contactId: string | null;
}

interface IdentityRow {
  conversation_id: string;
  state_enc: string | null;
  identified_at: string | null;
  consent: "due" | "asked" | null;
  check_enc: string | null;
  check_at: string | null;
}

const EMPTY: ConversationIdentity = { state: null, consent: null, check: null, checkAt: null };

async function openJson<T>(field: "conversation_identities.state_enc" | "conversation_identities.check_enc" | "contact_links.context_enc", raw: string | null | undefined): Promise<T | null> {
  const s = await openNullable(field, raw ?? null);
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

/** A identidade da conversa (a que venceu, 24 horas depois, não vale). */
export async function loadConversationIdentity(db: SupabaseClient, conversationId: string, now = Date.now()): Promise<ConversationIdentity> {
  const { data } = await db.from("conversation_identities").select("conversation_id, state_enc, identified_at, consent, check_enc, check_at").eq("conversation_id", conversationId).maybeSingle<IdentityRow>();
  if (!data) return EMPTY;
  const fresh = Boolean(data.identified_at) && now - Date.parse(data.identified_at!) <= IDENTITY_TTL_MS;
  const state = fresh ? await openJson<IdentityState>("conversation_identities.state_enc", data.state_enc) : null;
  return { state, consent: state ? (data.consent ?? null) : null, check: await openJson<PendingCheck>("conversation_identities.check_enc", data.check_enc), checkAt: data.check_at ?? null };
}

/** Só a identidade, para a IA e as ações (o Confirmar de uma ação, fora da vez da IA). */
export async function conversationChatIdentity(db: SupabaseClient, conversationId: string): Promise<ChatIdentity | null> {
  const { state } = await loadConversationIdentity(db, conversationId);
  return state ? chatIdentityOfState(state) : null;
}

async function saveIdentity(
  db: SupabaseClient,
  w: Where,
  patch: { state?: IdentityState | null; identifiedAt?: string | null; consent?: "due" | "asked" | null; check?: PendingCheck | null; checkAt?: string | null },
): Promise<void> {
  const scope = await scopeOfBot(w.botId);
  const row: Record<string, unknown> = { conversation_id: w.conversationId, bot_id: w.botId, contact_id: w.contactId, updated_at: new Date().toISOString() };
  if (patch.state !== undefined) {
    // o que veio do sistema da empresa e do contato: cifrado com a chave do cliente
    row.state_enc = patch.state ? await sealField("conversation_identities.state_enc", JSON.stringify(patch.state), scope) : null;
    row.external_id_hash = patch.state ? externalIdHash(patch.state.externalId) : null;
  }
  if (patch.identifiedAt !== undefined) row.identified_at = patch.identifiedAt;
  if (patch.consent !== undefined) row.consent = patch.consent;
  if (patch.check !== undefined) row.check_enc = patch.check ? await sealField("conversation_identities.check_enc", JSON.stringify(patch.check), scope) : null;
  if (patch.checkAt !== undefined) row.check_at = patch.checkAt;
  const { error } = await db.from("conversation_identities").upsert(row, { onConflict: "conversation_id" });
  if (error) console.error("identidade: conversa não gravada", error.message);
}

/**
 * A ação do passo do roteiro devolveu identity: a conversa fica identificada (outra pessoa na
 * mesma conversa abre um trecho novo: a IA não lê o que era da anterior). No WhatsApp e no
 * Instagram, sem o número lembrado para esta pessoa, fica devendo o pedido de licença.
 */
export async function applyRoutineIdentity(db: SupabaseClient, i: Where & { channel: string; identity: ActionIdentity; previous: IdentityState | null; offerRemember?: boolean }): Promise<{ state: IdentityState; consent?: "due" | null }> {
  const hash = externalIdHash(i.identity.externalId);
  const remembered = i.contactId ? (await activeLinks(db, i.contactId)).some((l) => l.source === "routine" && l.external_id_hash === hash) : false;
  const state = stateOf(i.identity, remembered);
  const now = new Date().toISOString();
  const samePerson = i.previous?.externalId === state.externalId;
  // a loja pode desligar o "lembrar o número" (Roteiros → Oferecer lembrar o número)
  const consent = isMeta(i.channel) && i.contactId && !remembered && i.offerRemember !== false ? ("due" as const) : null;
  // a mesma pessoa de novo: o pedido de licença fica como estava (já perguntado ou recusado)
  await saveIdentity(db, i, { state, identifiedAt: now, check: null, ...(samePerson ? {} : { consent }) });
  if (i.previous && !samePerson) await db.from("conversations").update({ context_since: now }).eq("id", i.conversationId);
  return samePerson ? { state } : { state, consent };
}

/** O vínculo da conta escolhida, quando o número está lembrado (a próxima conversa pergunta por ela). */
async function rememberedLinkOf(db: SupabaseClient, contactId: string, s: IdentityState): Promise<LinkRow | null> {
  const hash = externalIdHash(s.externalId);
  const ctx = s.active !== null ? contextHashOf(s.accounts[s.active]?.context ?? null) : null;
  return (await activeLinks(db, contactId)).find((l) => l.source === "routine" && l.external_id_hash === hash && (l.context_hash ?? "") === (ctx ?? "")) ?? null;
}

/**
 * Escolha (ou troca) da conta. Troca de uma conta para outra abre um trecho novo da conversa e
 * encerra o roteiro em andamento (context_changed); com o número lembrado, a conta escolhida passa
 * a ser a da próxima pergunta "Estou falando com...?".
 */
export async function selectAccount(db: SupabaseClient, w: Where, s: IdentityState, index: number): Promise<IdentityState> {
  const switching = s.active !== null && s.active !== index;
  const next: IdentityState = { ...s, active: index };
  const now = new Date().toISOString();
  await saveIdentity(db, w, { state: next, identifiedAt: now });
  if (switching) {
    await db.from("conversations").update({ context_since: now }).eq("id", w.conversationId);
    await endActiveRoutine(db, w.conversationId, "context_changed");
  }
  if (next.remembered && w.contactId) {
    const link = await rememberedLinkOf(db, w.contactId, next);
    if (link) await setActiveLink(db, w.contactId, link.id, link.display);
  }
  return next;
}

/**
 * "Lembrar este número": um vínculo por conta (source routine), e a conta escolhida fica ativa.
 * Conta já vinculada (pelo roteiro ou pelo pareamento) não duplica. Sai contact.linked dos novos.
 */
export async function rememberIdentity(db: SupabaseClient, w: Where & { channel: MetaChannel; state: IdentityState; onLinked?: () => Promise<void> }): Promise<IdentityState> {
  if (!w.contactId) return w.state;
  const s = w.state;
  const hash = externalIdHash(s.externalId);
  const scope = await scopeOfBot(w.botId);
  const existing = await activeLinks(db, w.contactId);
  const accounts = s.accounts.length ? s.accounts : [{ label: null, context: null }];
  const now = new Date().toISOString();
  const ids: Array<{ id: string; display: Record<string, string> }> = [];
  const created: string[] = [];
  for (const a of accounts) {
    const ctxHash = contextHashOf(a.context);
    const display = { ...(s.name ? { name: s.name } : {}), ...(a.label ? { workspace_name: a.label } : {}) };
    const same = existing.find((l) => l.external_id_hash === hash && (l.context_hash ?? "") === (ctxHash ?? ""));
    if (same) {
      // o do pareamento fica com o display que o sistema da empresa mandou
      await db.from("contact_links").update({ last_used_at: now, ...(same.source === "routine" ? { display } : {}) }).eq("id", same.id);
      ids.push({ id: same.id, display });
      continue;
    }
    const { data, error } = await db
      .from("contact_links")
      .insert({
        bot_id: w.botId,
        contact_id: w.contactId,
        channel: w.channel,
        external_id_hash: hash,
        external_id_enc: await sealField("contact_links.external_id_enc", s.externalId, scope),
        context_hash: ctxHash,
        context_enc: a.context ? await sealField("contact_links.context_enc", JSON.stringify(a.context), scope) : null,
        display,
        source: "routine",
      })
      .select("id")
      .single();
    if (error || !data) {
      console.error("identidade: número não lembrado", error?.message);
      continue;
    }
    ids.push({ id: data.id as string, display });
    created.push(data.id as string);
  }
  const active = ids[s.active ?? 0] ?? ids[0];
  if (active) await setActiveLink(db, w.contactId, active.id, active.display);
  const next: IdentityState = { ...s, remembered: true };
  await saveIdentity(db, w, { state: next, consent: null });
  // depois de gravar: o webhook do sistema da empresa ("número lembrado para a conta X")
  for (const id of created) await emitLinkEvent(db, id, "linked", { conversationId: w.conversationId }).catch((e) => console.error("webhook: contact.linked", (e as Error).message));
  if (created.length) await w.onLinked?.().catch((e) => console.error("identidade: depois de lembrar", (e as Error).message));
  return next;
}

/**
 * A loja desligou "Oferecer lembrar o número": os números lembrados pelo roteiro neste chatbot saem
 * (contact.unlinked, remember_off), em lotes. Devolve quantos vínculos saíram.
 */
export async function forgetBotRememberedNumbers(db: SupabaseClient, botId: string): Promise<number> {
  let n = 0;
  for (;;) {
    const { data } = await db.from("contact_links").select("id, contact_id").eq("bot_id", botId).eq("source", "routine").is("unlinked_at", null).limit(200);
    if (!data?.length) return n;
    let done = 0;
    for (const l of data) if (await unlinkLink(db, { id: l.id as string, contact_id: l.contact_id as string }, "remember_off")) done++;
    n += done;
    // nada saiu nesta volta (outro processo no meio-tempo): para, sem girar à toa
    if (!done) return n;
  }
}

/** "Sou outra pessoa": todos os números lembrados pelo roteiro saem (contact.unlinked, other_person). */
export async function forgetRoutineLinks(db: SupabaseClient, contactId: string, reason: string): Promise<number> {
  let n = 0;
  for (const l of await activeLinks(db, contactId)) if (l.source === "routine" && (await unlinkLink(db, l, reason))) n++;
  return n;
}

/** O número lembrado pelo roteiro que vale para a pergunta: o vínculo ativo, senão o mais recente. */
async function rememberedLink(db: SupabaseClient, contactId: string): Promise<{ link: LinkRow; all: LinkRow[] } | null> {
  const all = (await activeLinks(db, contactId)).filter((l) => l.source === "routine");
  if (!all.length) return null;
  const activeId = await contactActiveLinkId(db, contactId);
  return { link: all.find((l) => l.id === activeId) ?? all[all.length - 1], all };
}

/** Depois do "Sim, sou eu": a pessoa do vínculo, com as contas lembradas dela e a perguntada escolhida. */
async function stateFromLinks(link: LinkRow, all: LinkRow[]): Promise<IdentityState> {
  const same = all.filter((l) => l.external_id_hash === link.external_id_hash);
  const accounts: Array<IdentityAccount & { id: string }> = [];
  for (const l of same) {
    const context = await openJson<Record<string, unknown>>("contact_links.context_enc", l.context_enc);
    const label = l.display?.workspace_name ?? null;
    if (label || context) accounts.push({ id: l.id, label, context });
  }
  const at = accounts.findIndex((a) => a.id === link.id);
  return {
    externalId: (await openNullable("contact_links.external_id_enc", link.external_id_enc)) ?? "",
    name: link.display?.name ?? null,
    accounts: accounts.map(({ label, context }) => ({ label, context })),
    active: accounts.length ? Math.max(0, at) : null,
    remembered: true,
  };
}

/* ------------------------------------------------------------------ antes da IA */

export type IdentityTurn =
  /** Segue para o roteiro e a IA (note: o que a IA precisa saber; consumed: a mensagem foi o toque numa conta, o roteiro não usa). */
  | { kind: "none"; note: string | null; consumed: boolean }
  /** Texto fixo, sem a IA. */
  | { kind: "fixed"; text: string; component: MessageComponent | null }
  /** Respondeu à pergunta "Estou falando com...?": a IA responde agora à mensagem que esperava. */
  | { kind: "resume"; text: string; texts: string[]; note: string | null };

const NONE: IdentityTurn = { kind: "none", note: null, consumed: false };

/**
 * Antes do roteiro e da IA: o toque (ou a resposta digitada logo depois da pergunta) na escolha da
 * conta, na licença para lembrar o número e no "Estou falando com...?"; e, na conversa sem
 * identidade de um número lembrado, a própria pergunta (a mensagem espera a resposta).
 */
export async function identityPreTurn(
  db: SupabaseClient,
  i: {
    bot: { id: string };
    channel: string;
    conversationId: string;
    contactId: string | null;
    buttonId: string | null;
    /** A mensagem desta vez e os textos da rajada (os que esperam a resposta da pergunta). */
    text: string;
    texts: string[];
    /** false: a mensagem já foi usada (Confirmar, resposta de 18+). */
    consume: boolean;
    /** A conversa já tem identidade de fora (pareamento ou token do site): nada daqui vale. */
    external: boolean;
    /** Depois de lembrar o número (no WhatsApp, liga a checagem de identidade da Meta). */
    onLinked?: () => Promise<void>;
    /** A loja oferece lembrar o número (padrão: sim). Desligado: nem a licença nem o "Estou falando com...?". */
    offerRemember?: boolean;
  },
  now = Date.now(),
): Promise<IdentityTurn> {
  if (!i.consume || i.external) return NONE;
  const w: Where = { conversationId: i.conversationId, botId: i.bot.id, contactId: i.contactId };
  const cur = await loadConversationIdentity(db, i.conversationId, now);
  const stale: IdentityTurn = { kind: "fixed", text: IDENTITY_TEXTS.stale, component: null };

  // resposta digitada: só com os botões da identificação na última mensagem que saiu
  let click = parseIdentityButton(i.buttonId);
  if (!click && !i.buttonId && (cur.check || cur.consent === "asked" || isChoosing(cur.state))) {
    const last = await findMessage(db, { conversationId: i.conversationId, roles: ["assistant", "agent"], delivered: true, newestFirst: true }, ["components_enc"] as const);
    const comp = parseComponents(last?.components_enc ?? null);
    if (comp?.type === "options" && comp.options.length && comp.options.every((o) => o.id.startsWith(IDENTITY_BUTTON_PREFIX))) {
      const kind = parseIdentityButton(comp.options[0].id)?.kind;
      let pick = typedChoice(i.text, comp.options);
      if (pick === null && (kind === "lembrar" || kind === "eu")) {
        const yn = typedYesNo(i.text);
        pick = yn === "sim" ? 0 : yn === "nao" ? 1 : null;
      }
      if (pick !== null) click = parseIdentityButton(comp.options[pick].id);
    }
  }

  if (click?.kind === "conta") {
    const s = cur.state;
    if (!s || tagOf(s.externalId) !== click.tag || !s.accounts[click.index]) return stale;
    const label = accountLabel(s.accounts[click.index], click.index);
    if (s.active !== click.index) await selectAccount(db, w, s, click.index);
    return { kind: "none", note: IDENTITY_NOTES.chose(label), consumed: true };
  }

  if (click?.kind === "lembrar" || click?.kind === "nao") {
    const s = cur.state;
    if (!isMeta(i.channel) || !s || tagOf(s.externalId) !== click.tag || i.offerRemember === false) return stale;
    if (click.kind === "nao") {
      await saveIdentity(db, w, { consent: null });
      return { kind: "fixed", text: IDENTITY_TEXTS.notRemembered, component: null };
    }
    if (!s.remembered) await rememberIdentity(db, { ...w, channel: i.channel, state: s, onLinked: i.onLinked });
    return { kind: "fixed", text: IDENTITY_TEXTS.remembered(i.channel), component: null };
  }

  if (click?.kind === "eu" || click?.kind === "outra") {
    if (!isMeta(i.channel) || !i.contactId || !cur.check || cur.check.linkId !== click.linkId) return stale;
    const pending = cur.check;
    if (click.kind === "outra") {
      await forgetRoutineLinks(db, i.contactId, "other_person");
      await saveIdentity(db, w, { check: null });
      return { kind: "resume", text: pending.text, texts: pending.texts, note: IDENTITY_NOTES.otherPerson };
    }
    const r = await rememberedLink(db, i.contactId);
    const link = r?.all.find((l) => l.id === click.linkId);
    if (!r || !link) {
      // o número foi esquecido no meio-tempo (desconectar, API): segue sem identidade
      await saveIdentity(db, w, { check: null });
      return { kind: "resume", text: pending.text, texts: pending.texts, note: null };
    }
    const at = new Date(now).toISOString();
    await saveIdentity(db, w, { state: await stateFromLinks(link, r.all), identifiedAt: at, consent: null, check: null });
    await db.from("contact_links").update({ last_used_at: at }).eq("id", link.id);
    return { kind: "resume", text: pending.text, texts: pending.texts, note: null };
  }
  if (i.buttonId?.startsWith(IDENTITY_BUTTON_PREFIX)) return stale;

  // conversa sem identidade de um número lembrado pelo roteiro: pergunta antes (uma vez a cada 24 horas)
  const asked = cur.checkAt && now - Date.parse(cur.checkAt) <= IDENTITY_TTL_MS;
  if (isMeta(i.channel) && i.contactId && !cur.state && !asked && !i.buttonId && i.offerRemember !== false) {
    const r = await rememberedLink(db, i.contactId);
    if (r) {
      await saveIdentity(db, w, { check: { linkId: r.link.id, text: i.text, texts: i.texts }, checkAt: new Date(now).toISOString() });
      return { kind: "fixed", text: IDENTITY_TEXTS.check(r.link.display?.name ?? null, i.channel), component: checkButtons(r.link.id) };
    }
  }
  return cur.check && !cur.state ? { kind: "none", note: IDENTITY_NOTES.checkPending, consumed: false } : NONE;
}

/** Depois de pedir a licença: não pergunta de novo nesta conversa. */
export async function markConsentAsked(db: SupabaseClient, w: Where): Promise<void> {
  await saveIdentity(db, w, { consent: "asked" });
}

/* ------------------------------------------------------------------ na vez da IA */

export interface IdentityPort extends RoutineIdentityPort {
  /** A identidade agora (muda no meio da vez quando a ação do roteiro identifica). */
  current(): ChatIdentity | null;
  /** O pedido de licença que falta, depois da resposta sem botões. */
  consentPrompt(): { text: string; component: MessageComponent } | null;
  /** trocar_contexto entre as contas da pessoa (com 2 ou mais e uma já escolhida). */
  switchTool(): Record<string, Tool>;
}

/**
 * A identidade da conversa para o roteiro e para as ações desta vez. external: a identidade do
 * pareamento ou do token do site, que vence (com ela, o roteiro não identifica de novo).
 */
export function identityPort(db: SupabaseClient, i: Where & { channel: string; initial: ConversationIdentity; external: ChatIdentity | null; offerRemember?: boolean }): IdentityPort {
  let state = i.initial.state;
  let consent = i.initial.consent;
  const external = i.external?.externalId ? i.external : null;
  return {
    identified: () => Boolean(external) || Boolean(state),
    choosing: () => !external && isChoosing(state),
    accountButtons: () => (!external && state && isChoosing(state) ? accountButtons(state) : null),
    apply: async (identity) => {
      if (external) return null;
      const r = await applyRoutineIdentity(db, { ...i, identity, previous: state });
      state = r.state;
      if (r.consent !== undefined) consent = r.consent;
      return { choosing: isChoosing(state), name: state.name, accounts: state.accounts.length };
    },
    current: () => external ?? (state ? chatIdentityOfState(state) : null),
    consentPrompt: () => (i.offerRemember === false ? null : consentPrompt(i.channel, { state, consent })),
    switchTool: (): Record<string, Tool> => {
      const s = state;
      if (external || !s || s.active === null || s.accounts.length < 2) return {};
      const names = s.accounts.map((a, k) => accountLabel(a, k)).join("; ");
      return {
        trocar_contexto: tool({
          description: `Troca a conta desta conversa entre as da pessoa (${names}). Use quando a pessoa pedir para trocar ("é sobre a outra conta"). Se não der para saber qual, pergunte.`,
          inputSchema: z.object({ conta: z.string().min(1).describe("o nome da conta, como a pessoa disse") }),
          execute: async ({ conta }) => {
            const cur = state ?? s;
            const m = matchAccount(cur, conta);
            if (!("index" in m)) return { ok: false, motivo: "ambiguo", opcoes: m.options, instrucao: "Pergunte qual destas contas a pessoa quer." };
            const label = accountLabel(cur.accounts[m.index], m.index);
            if (m.index === cur.active) return { ok: true, conta: label, instrucao: "Diga que a conversa já está nessa conta." };
            state = await selectAccount(db, i, cur, m.index);
            return { ok: true, conta: label, instrucao: `Diga que agora a conversa está na conta "${label}". As próximas consultas usam essa conta.` };
          },
        }),
      };
    },
  };
}
