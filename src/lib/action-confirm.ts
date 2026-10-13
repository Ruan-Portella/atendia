import type { SupabaseClient } from "@supabase/supabase-js";
import { generateText } from "ai";
import { callAction, needsConfirmation, paramsHash, reaches, type ActionLevel, type ActionRow, type CallContact, type CallResult, type Confirmation, type ParamsSchema } from "./actions";
import { cancelRef, claimRef, createRef, getRef, refCallId, reopenRef, setRefStatus, supersedeOpenRefs, uncertainRef, type ButtonRef, type RefStatus } from "./button-refs";
import { conversationIdMap, paramsGateDecision, paramsGateFacts, type IdMap } from "./action-gate";
import { findMessage } from "./messages";
import { parseComponents, type MessageComponent } from "./components";
import { firstExceeded } from "./rate-limit";
import { chatModel, classifierModelId, modelCallOptions } from "./ai";
import { recordAiUsage, usageFrom } from "./ai-usage";
import { normalizeGateText } from "./gate/match";
import { CATEGORIES, type GateCategory } from "./gate/rules";
import { logGate } from "./gate/log";

/*
 * Ações "executa" com Confirmar / Cancelar (C pública, parte 5a; spec "Peça 1", confirmação
 * determinística, e "Formatos de payload", seção 2). A IA decide chamar e preenche os parâmetros;
 * o BoaVoz não chama o endpoint: manda um resumo com Confirmar e Cancelar (botões de resposta no
 * WhatsApp, respostas rápidas no Instagram, botões no site). Só o clique em Confirmar (ou o atalho
 * "sim", "confirmo" ou "1" logo depois do resumo) dispara a chamada, numa etapa sem IA, com os
 * parâmetros guardados na referência do botão (button-refs.ts):
 *   - o clique é resolvido pelo id do botão, nunca pelo título; a referência é consumida de forma
 *     atômica antes da chamada, e o call_id é o id dela;
 *   - no clique, o BoaVoz confere de novo a ação (ativa), o nível do contato e o contexto;
 *   - sem resposta a tempo, a chamada fica incerta: "Tentar de novo" (mesmo call_id) e "Falar com
 *     alguém"; o BoaVoz nunca refaz sozinho.
 */

export type ConfirmVerb = "sim" | "nao" | "repetir" | "humano";

/** Títulos dos botões (até 20 caracteres: WhatsApp e Instagram). */
export const CONFIRM_TITLES: Record<ConfirmVerb, string> = { sim: "Confirmar", nao: "Cancelar", repetir: "Tentar de novo", humano: "Falar com alguém" };

export const confirmButtonId = (refId: string, verb: ConfirmVerb) => `bvc:${refId}:${verb}`;

/** O botão é de uma confirmação? Devolve a referência e o que ele faz. Função pura. */
export function parseConfirmButton(id: string | null | undefined): { refId: string; verb: ConfirmVerb } | null {
  const m = /^bvc:([0-9a-f-]{36}):(sim|nao|repetir|humano)$/.exec(id ?? "");
  return m ? { refId: m[1], verb: m[2] as ConfirmVerb } : null;
}

const options = (refId: string, verbs: ConfirmVerb[]): MessageComponent => ({ type: "options", options: verbs.map((v) => ({ id: confirmButtonId(refId, v), title: CONFIRM_TITLES[v] })) });
/** Confirmar e Cancelar apontam para a mesma referência. */
export const confirmComponent = (refId: string) => options(refId, ["sim", "nao"]);
/** Depois de uma chamada incerta: repetir com o mesmo call_id, ou chamar a equipe. */
export const uncertainComponent = (refId: string) => options(refId, ["repetir", "humano"]);
/** O componente é desta etapa (Confirmar ou "Tentar de novo")? Função pura. */
export const isConfirmComponent = (c: MessageComponent | null | undefined) => c?.type === "options" && c.options.some((o) => parseConfirmButton(o.id) !== null);

/** Textos fixos ao contato (sem IA). */
export const CONFIRM_TEXTS = {
  intro: "Confere antes de eu concluir:",
  tail: "Nada é feito antes do Confirmar.",
  canceled: "Tudo bem, cancelei. Nada foi feito.",
  alreadyDone: "Esse pedido já foi confirmado.",
  alreadyCanceled: "Esse pedido já tinha sido cancelado. Se ainda quiser, me diga de novo o que precisa.",
  running: "Esse pedido já está sendo confirmado. Um instante.",
  expired: "Essa proposta foi substituída ou venceu. Se ainda quiser, me diga de novo o que precisa.",
  failedBefore: "Esse pedido não foi concluído. Se ainda quiser, me diga de novo o que precisa.",
  refused: "Não consigo concluir esse pedido por aqui agora. Se quiser, posso chamar alguém da equipe.",
  tooFast: "São muitas tentativas seguidas. Espere um minuto e toque de novo.",
  uncertain: "Não consegui confirmar se deu certo: o sistema não respondeu a tempo. Toque em Tentar de novo (sem duplicar o pedido) ou fale com alguém da equipe.",
  cantCancelUncertain: "Esse pedido já foi enviado e não consegui confirmar se deu certo. Toque em Tentar de novo ou fale com alguém da equipe.",
  sameAsBefore: "É o mesmo pedido de antes: confirmar de novo não duplica.",
  previousMayExist: "Atenção: o pedido anterior pode já ter sido registrado.",
  unresolved: (codes: string[]) => `Não consegui conferir o nome de: ${codes.join(", ")}. Confira antes de confirmar.`,
};

/* ------------------------------------------------------------------ atalho de texto */

/**
 * "sim", "confirmo", "confirmar" ou "1" (primeira opção) e "não", "cancelar" ou "2" (segunda),
 * sozinhos na mensagem. Função pura.
 */
export function typedChoice(text: string | null | undefined): { pos: 1 | 2; number: boolean } | null {
  if (!text) return null;
  const t = normalizeGateText(text).trim().replace(/[.!]+$/, "").trim();
  if (t === "1") return { pos: 1, number: true };
  if (t === "2") return { pos: 2, number: true };
  if (["sim", "s", "confirmo", "confirmar", "confirma", "sim confirmo"].includes(t)) return { pos: 1, number: false };
  if (["nao", "n", "cancelar", "cancela", "cancelo"].includes(t)) return { pos: 2, number: false };
  return null;
}

/**
 * O que o atalho digitado aciona, dados os botões da última mensagem enviada. Número = a opção da
 * lista (no Instagram pelo computador, o resumo numerado); "sim" = Confirmar (ou "Tentar de
 * novo"); "não" = só Cancelar. Função pura.
 */
export function shortcutTarget(choice: { pos: 1 | 2; number: boolean }, last: MessageComponent | null): { refId: string; verb: ConfirmVerb } | null {
  if (last?.type !== "options") return null;
  const opts = last.options.map((o) => parseConfirmButton(o.id)).filter((x) => x !== null);
  if (!opts.length) return null;
  const picked = opts[choice.pos - 1] ?? null;
  if (!picked) return null;
  if (choice.number) return picked;
  if (choice.pos === 1) return picked.verb === "sim" || picked.verb === "repetir" ? picked : null;
  return picked.verb === "nao" ? picked : null;
}

/* ------------------------------------------------------------------ resumo */

const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
/** Rótulo do parâmetro: a descrição do dev, se curta ("endereço de entrega"), senão o nome. */
const labelFor = (name: string, description?: string) => {
  const d = description?.trim();
  return capitalize(d && d.length <= 30 && !/[,;:()]/.test(d) ? d : name.replace(/_/g, " ").trim());
};
/** Valor com cara de código (tem número): é o que o aviso de "não consegui conferir" cita. */
const looksLikeCode = (v: string) => /\d/.test(v) && v.length <= 40;
/** "2x calabresa, coca": repetidos contados, na ordem em que apareceram. */
const counted = (values: string[]) => {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].map(([v, n]) => `${n > 1 ? `${n}x ` : ""}${v}`);
};
/** Parâmetro que leva código de item (id, sku, codigo, ref, itens, produtos). */
const ID_PARAM = /(^|_)(ids?|skus?|codigos?|refs?|itens|items?|produtos?)$/i;
const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\s/g, " ");
const show = (v: unknown) => (typeof v === "boolean" ? (v ? "sim" : "não") : String(v).replace(/\s+/g, " ").trim().slice(0, 80));

/**
 * Linhas do resumo do Confirmar. Com prévia, o que o endpoint devolveu (resumo, itens, total).
 * Sem prévia, cada parâmetro, com os códigos trocados pelos nomes do mapa de ids ("2x Pizza
 * Calabresa"); unresolved: os códigos de item que o mapa não conhece (vão no aviso). Função pura.
 */
export function confirmationLines(schema: ParamsSchema, params: Record<string, unknown>, map: IdMap, preview: Confirmation | null): { lines: string[]; unresolved: string[] } {
  if (preview) {
    const lines = [...(preview.summary ? [preview.summary] : []), ...preview.items.map((i) => `• ${i}`), ...(preview.total_cents !== null ? [`Total: ${brl(preview.total_cents)}`] : [])];
    return { lines, unresolved: [] };
  }
  const names = [...Object.keys(schema.properties ?? {}), ...Object.keys(params).filter((n) => !(n in (schema.properties ?? {})))];
  const lines: string[] = [];
  const unresolved: string[] = [];
  const labelOf = (v: unknown) => (typeof v === "string" || typeof v === "number" ? (map[String(v)]?.rotulo ?? null) : null);
  for (const name of names) {
    const v = params[name];
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) continue;
    const values = Array.isArray(v) ? v : [v];
    for (const x of values) if (ID_PARAM.test(name) && (typeof x === "string" || typeof x === "number") && !labelOf(x) && looksLikeCode(show(x))) unresolved.push(show(x));
    if (Array.isArray(v) && v.every((x) => labelOf(x))) {
      // itens do mapa: um por linha, com a quantidade ("2x Pizza Calabresa")
      for (const item of counted(v.map((x) => labelOf(x)!))) lines.push(`• ${item}`);
      continue;
    }
    lines.push(`• ${labelFor(name, schema.properties?.[name]?.description)}: ${counted(values.map((x) => labelOf(x) ?? show(x))).join(", ")}`);
  }
  return { lines: lines.slice(0, 15), unresolved: [...new Set(unresolved)].slice(0, 10) };
}

/** A mensagem do Confirmar: a frase da IA, as linhas, os avisos e o lembrete. Função pura. */
export function confirmationText(intro: string | null | undefined, lines: string[], notes: string[]): string {
  return [intro?.trim() || CONFIRM_TEXTS.intro, lines.join("\n"), ...notes, CONFIRM_TEXTS.tail].filter((x) => x && x.trim()).join("\n\n");
}

/* ------------------------------------------------------------------ quem chama (nível e contexto) */

/** O contato e o contexto da chamada (montados como nas consultas; conferidos de novo no clique). */
export interface Caller {
  level: ActionLevel;
  hasContext: boolean;
  contact: CallContact;
  context: { source: "token" | "pairing" | "bot"; data: Record<string, unknown> } | null;
  gateChannel: "widget" | "whatsapp" | "instagram";
  /** Última vez que a conversa falou de bebida ou remédio (portão do reply). */
  regulatedAt?: string | null;
}

/** A ação ainda pode ser chamada por este contato? (ativa, não pausada pelo plano, nível e contexto). Função pura. */
export function stillCallable(a: Pick<ActionRow, "active" | "paused_by_plan_at" | "min_level" | "context_required" | "type" | "creates_order">, c: Pick<Caller, "level" | "hasContext">): boolean {
  return a.active && !a.paused_by_plan_at && needsConfirmation(a) && reaches(c.level, a.min_level) && (a.context_required === "none" || c.hasContext);
}

/* ------------------------------------------------------------------ abrir a confirmação (ferramenta da IA) */

export interface OpenInput {
  bot: { id: string; agency_id: string };
  conversationId: string;
  action: ActionRow;
  params: Record<string, unknown>;
  /** A frase da IA antes das linhas ("Confere o seu pedido:"). */
  intro: string | null;
  caller: Caller;
  /** Chave da mensagem: forma o call_id da prévia. */
  messageKey: string;
  /** Portão dos canais da Meta (no site não há trava do BoaVoz). */
  gate: { channel: "whatsapp" | "instagram"; contactPhone: string | null; exempt?: GateCategory[]; destination: { destino: string } | null } | null;
}

export type OpenResult = { ok: true; refId: string; text: string; component: MessageComponent } | { ok: false; output: Record<string, unknown> };

/** Etapa de IA do portão de parâmetros: a chamada vende, reserva ou cobra item regulamentado ou proibido? Erro: sim (lado seguro). */
async function sellsRestricted(db: SupabaseClient, agencyId: string, a: Pick<ActionRow, "name" | "description">, params: Record<string, unknown>, labels: string[]): Promise<boolean> {
  const modelId = classifierModelId();
  const categories = Object.values(CATEGORIES)
    .map((c) => c.label)
    .join(", ");
  try {
    const r = await generateText({
      model: chatModel(modelId),
      system: "Você confere chamadas de integração de um chatbot de atendimento antes de elas acontecerem. Responda só com JSON válido.",
      prompt: `Ação: ${a.name}\nDescrição: ${a.description}\nParâmetros: ${JSON.stringify(params).slice(0, 2000)}\nItens reconhecidos: ${labels.join("; ").slice(0, 1000) || "(nenhum)"}\n\nEsta chamada vende, reserva ou cobra algum item destas categorias: ${categories}? Consultar, cancelar ou mudar endereço não conta.\nResponda só: {"barrar": true} ou {"barrar": false}`,
      ...modelCallOptions(modelId, { temperature: 0 }),
      maxRetries: 2,
    });
    void recordAiUsage(db, { agencyId, kind: "classificacao", ...usageFrom(r.response?.modelId ?? modelId, r.totalUsage) });
    const j = JSON.parse(r.text.replace(/^\s*```(?:json)?|```\s*$/g, "").trim()) as { barrar?: unknown };
    return j.barrar !== false;
  } catch {
    return true;
  }
}

/** O que a IA recebe quando o portão barra o pedido. */
export function blockedOrderOutput(labels: string[], destination: { destino: string } | null): Record<string, unknown> {
  const where = destination ? ` Diga que esses itens ficam fora do chat: ${destination.destino}.` : " Diga que esses itens não podem ser pedidos por aqui.";
  return { ok: false, motivo: "item_fora_do_chat", instrucao: `Este pedido tem item que não pode ser vendido nem reservado por este canal${labels.length ? ` (${labels.join(", ")})` : ""}. Não chame de novo com ele: ofereça seguir sem esse item.${where}` };
}

/**
 * Prepara a confirmação: prévia (se a ação aceita), portão de parâmetros, a referência do botão
 * (a nova vence as abertas desta ação na conversa) e o texto do resumo. Nada é chamado de
 * verdade aqui.
 */
export async function openConfirmation(db: SupabaseClient, i: OpenInput): Promise<OpenResult> {
  const { action: a, params } = i;
  const map = await conversationIdMap(db, i.conversationId);

  // prévia: só para ação que declarou aceitar (endpoint que não declarou criaria o pedido)
  let preview: Confirmation | null = null;
  if (a.supports_preview) {
    const r = await callAction(db, a, { params, mode: "preview", messageKey: i.messageKey, conversation: { id: i.conversationId, channel: i.caller.gateChannel }, contact: i.caller.contact, context: i.caller.context });
    if (r.status === "not_found") return { ok: false, output: { ok: false, motivo: "nao_encontrado", detalhe: r.error ?? null } };
    if (r.status !== "ok") return { ok: false, output: { ok: false, motivo: "falha", instrucao: "Diga que não conseguiu preparar o pedido agora e siga a conversa (nada foi feito)." } };
    preview = r.confirmation ?? null;
  }

  // portão de parâmetros (WhatsApp e Instagram): o mapa de ids, o dicionário e, se precisar, a IA
  if (i.gate) {
    const previewTexts = preview ? [preview.summary ?? "", ...preview.items].filter(Boolean) : [];
    const facts = paramsGateFacts(params, map, { channel: i.gate.channel, contactPhone: i.gate.contactPhone, exempt: i.gate.exempt, preview: previewTexts });
    let decision = paramsGateDecision(facts, a.creates_order === true);
    const labels = [...new Set(Object.values(params).flat().map((v) => (typeof v === "string" || typeof v === "number" ? map[String(v)]?.rotulo : null)).filter((x): x is string => Boolean(x)))];
    if (decision === "perguntar_ia") decision = (await sellsRestricted(db, i.bot.agency_id, a, params, [...labels, ...previewTexts])) ? "barrar" : "liberar";
    if (decision === "barrar") {
      const categories = [...new Set([...facts.mapHits.flatMap((h) => (h.categoria ? [h.categoria] : [])), ...facts.dictionary])];
      await logGate(db, { botId: i.bot.id, conversationId: i.conversationId, stage: "saida", decision: "parametro_barrado", categories });
      const blockedLabels = facts.mapHits.map((h) => h.rotulo).filter((x): x is string => Boolean(x));
      return { ok: false, output: blockedOrderOutput([...new Set(blockedLabels)], i.gate.destination) };
    }
  }

  // "tenta de novo aí": chamada incerta da mesma ação nas últimas 24 horas
  const hash = paramsHash(a.id, params);
  const notes: string[] = [];
  const uncertain = await uncertainRef(db, i.conversationId, a.id);
  let refId: string;
  if (uncertain && uncertain.params_hash === hash && (await reopenRef(db, uncertain.id))) {
    // os mesmos parâmetros: o Confirmar volta preso ao call_id antigo
    refId = uncertain.id;
    notes.push(CONFIRM_TEXTS.sameAsBefore);
  } else {
    if (uncertain) notes.push(CONFIRM_TEXTS.previousMayExist);
    refId = await createRef(db, { botId: i.bot.id, conversationId: i.conversationId, actionId: a.id, kind: "confirm", params, paramsHash: hash });
  }
  await supersedeOpenRefs(db, i.conversationId, a.id, refId);

  const { lines, unresolved } = confirmationLines(a.params_schema, params, map, preview);
  if (unresolved.length) notes.unshift(CONFIRM_TEXTS.unresolved(unresolved));
  return { ok: true, refId, text: confirmationText(i.intro, lines, notes), component: confirmComponent(refId) };
}

/* ------------------------------------------------------------------ o clique */

export interface ClickInput {
  bot: { id: string };
  conversationId: string;
  /** Id do botão tocado (WhatsApp, Instagram ou site). */
  buttonId: string | null;
  /** O texto da mensagem (atalho "sim", "confirmo" ou "1"). */
  text: string | null;
  /** Só esta mensagem com texto no lote: o atalho só vale sozinho. */
  alone: boolean;
  /** Evento da fila (ou id da mensagem): o reprocesso do mesmo clique segue sem consumir de novo. */
  key: string;
  /** Nível e contexto do contato agora. */
  caller: () => Promise<Caller>;
}

export type ClickResult =
  | { kind: "none" }
  | { kind: "fixed"; text: string; component?: MessageComponent | null }
  | { kind: "handoff" }
  | { kind: "called"; action: ActionRow; params: Record<string, unknown>; call: CallResult; caller: Caller };

const fixed = (text: string, component: MessageComponent | null = null): ClickResult => ({ kind: "fixed", text, component });

/** Texto fixo para uma referência que não pôde ser usada. Função pura. */
export function unusableText(status: RefStatus): string {
  if (status === "done") return CONFIRM_TEXTS.alreadyDone;
  if (status === "canceled") return CONFIRM_TEXTS.alreadyCanceled;
  if (status === "running") return CONFIRM_TEXTS.running;
  if (status === "failed") return CONFIRM_TEXTS.failedBefore;
  return CONFIRM_TEXTS.expired;
}

/** Qual botão foi acionado: o id tocado, ou o atalho digitado com o resumo como última mensagem enviada. */
async function clickTarget(db: SupabaseClient, i: ClickInput): Promise<{ refId: string; verb: ConfirmVerb } | null> {
  const tapped = parseConfirmButton(i.buttonId);
  if (tapped) return tapped;
  if (!i.alone) return null;
  const choice = typedChoice(i.text);
  if (!choice) return null;
  // qualquer mensagem enviada depois do resumo (de qualquer origem) desarma o atalho
  const last = await findMessage(db, { conversationId: i.conversationId, roles: ["assistant", "agent"], delivered: true, newestFirst: true }, ["components_enc"] as const);
  return shortcutTarget(choice, parseComponents(last?.components_enc ?? null));
}

/**
 * Trata o clique (ou o atalho) numa confirmação, sem IA. none: não é clique de confirmação (segue
 * normal). fixed: texto fixo ao contato. handoff: "Falar com alguém". called: o endpoint foi
 * chamado (ok, não encontrado ou falha); quem chama monta a resposta (reply exato ou a IA a
 * partir do data).
 */
export async function resolveConfirmClick(db: SupabaseClient, i: ClickInput): Promise<ClickResult> {
  const target = await clickTarget(db, i);
  if (!target) return { kind: "none" };
  const ref = await getRef(db, target.refId);
  if (!ref || ref.bot_id !== i.bot.id || ref.conversation_id !== i.conversationId) return fixed(CONFIRM_TEXTS.expired);
  if (target.verb === "humano") return { kind: "handoff" };
  if (target.verb === "nao") {
    if (await cancelRef(db, ref.id)) return fixed(CONFIRM_TEXTS.canceled);
    return fixed(ref.status === "uncertain" ? CONFIRM_TEXTS.cantCancelUncertain : unusableText(ref.status));
  }
  // "Tentar de novo" e Confirmar levam ao mesmo call_id (a incerta reaberta pelo texto vale pelos dois)
  return execute(db, i, ref, ["open", "uncertain"]);
}

async function execute(db: SupabaseClient, i: ClickInput, ref: ButtonRef, from: RefStatus[]): Promise<ClickResult> {
  // reprocesso do mesmo clique: a referência já é dele; a chamada repete com o mesmo call_id (o ok
  // gravado é reaproveitado sem chamar o endpoint)
  const mine = ref.used_key === i.key && ["running", "done", "failed"].includes(ref.status);
  if (!mine && (!from.includes(ref.status) || Date.parse(ref.expires_at) <= Date.now())) return fixed(unusableText(ref.status === "open" || ref.status === "uncertain" ? "superseded" : ref.status));

  // no clique, tudo de novo: a ação, o nível do contato e o contexto
  const { data } = await db.from("actions").select("*").eq("id", ref.action_id).maybeSingle();
  const action = data as ActionRow | null;
  const caller = await i.caller();
  if (!action || !stillCallable(action, caller)) {
    if (!mine) await setRefStatus(db, ref.id, "failed");
    return fixed(CONFIRM_TEXTS.refused);
  }
  if (!mine) {
    const limited = await firstExceeded(db, [{ key: `acao:${i.conversationId}:m`, max: 15, windowSeconds: 60, message: "rate_limited" }]);
    if (limited) return fixed(CONFIRM_TEXTS.tooFast);
    // consumida de forma atômica: só um clique chama
    if (!(await claimRef(db, ref, from, i.key))) {
      const now = await getRef(db, ref.id);
      return fixed(unusableText(now?.status ?? "superseded"));
    }
  }

  const call = await callAction(db, action, { params: ref.params, confirmed: true, callId: refCallId(ref.id), conversation: { id: i.conversationId, channel: caller.gateChannel }, contact: caller.contact, context: caller.context });
  if (call.status === "uncertain") {
    await setRefStatus(db, ref.id, "uncertain");
    return fixed(CONFIRM_TEXTS.uncertain, uncertainComponent(ref.id));
  }
  await setRefStatus(db, ref.id, call.status === "ok" ? "done" : "failed");
  return { kind: "called", action, params: ref.params, call, caller };
}

/* ------------------------------------------------------------------ depois do clique */

/**
 * O que a IA lê na vez depois do Confirmar: a ação já foi chamada (não chamar de novo) e o
 * resultado, já filtrado pelo portão. Função pura.
 */
export function confirmedNote(actionName: string, output: Record<string, unknown>): string {
  const result = JSON.stringify(output).slice(0, 6000);
  if (output.ok === false && output.motivo === "nao_encontrado")
    return `A pessoa tocou em Confirmar e a ação acao_${actionName} foi chamada agora, mas o sistema da empresa respondeu que não encontrou: ${result}. Explique com naturalidade e ofereça ajustar o pedido. Não chame a ação de novo nesta resposta.`;
  if (output.ok === false)
    return `A pessoa tocou em Confirmar, mas a ação acao_${actionName} falhou agora: ${result}. Diga que não conseguiu concluir agora e ofereça tentar de novo daqui a pouco ou falar com alguém da equipe. Não chame a ação de novo nesta resposta.`;
  return `A pessoa tocou em Confirmar e a ação acao_${actionName} acabou de ser executada (não chame de novo). Resultado: ${result}. Confirme para a pessoa o que foi feito a partir desse resultado, sem inventar número de pedido, valor ou prazo que não estejam nele.`;
}
