import type { SupabaseClient } from "@supabase/supabase-js";
import { needsConfirmation, paramsHash, paramsProblems, type ActionRow } from "./actions";
import { confirmButtonId } from "./action-confirm";
import { createRef } from "./button-refs";
import { conversationIdMap, paramsGateDecision, paramsGateFacts } from "./action-gate";
import { LIMITS, type MessageComponent, type OptionItem } from "./components";
import { isChatLink } from "./gate/sales-channel";
import { logGate } from "./gate/log";
import type { GateCategory } from "./gate/rules";

/*
 * Componentes vindos de fora da IA (C pública, parte 5b; spec "Peça 5"): o retorno das ações
 * (components) e o POST /v1/messages usam o mesmo formato, um componente por mensagem:
 *   {type: "buttons", buttons: [{title, id?, action?}]}         até 3, título até 20
 *   {type: "list", button?, items: [{title, description?, id?, action?}]}   até 10, título até 24
 *   {type: "link", title, url}                                   título até 20, só HTTPS
 * action = {name, params}: botão com ação. O clique chama a ação direto, sem a IA, e vale como
 * confirmação. Os parâmetros ficam no BoaVoz (button_refs) e o canal recebe só a referência
 * (bvc:<ref>:acao), válida por 24 horas; uso único só em ação "executa" ou de pedido. Ação que cria
 * pedido, reserva ou cobrança só vai em buttons, nunca em list. Sem action, o clique volta para a
 * IA como mensagem com o título (o id do dev volta no webhook, em interactive.id).
 */

export interface ButtonInput {
  title: string;
  id: string | null;
  description: string | null;
  action: { name: string; params: Record<string, unknown> } | null;
}

export type ComponentInput = { type: "buttons"; buttons: ButtonInput[] } | { type: "list"; button: string | null; items: ButtonInput[] } | { type: "link"; title: string; url: string };

/** Componente fora do formato: a mensagem e o campo (o 400 da API aponta para ele). */
export class ComponentProblem extends Error {
  constructor(
    message: string,
    public field: string,
    /** prohibited: o portão barrou (422 na API). */
    public kind: "invalid" | "prohibited" = "invalid",
  ) {
    super(message);
  }
}

const DEV_ID = /^[\w.:-]{1,100}$/;
/** Prefixo do id do dev no canal (não se confunde com os ids do BoaVoz); o webhook devolve sem ele. */
export const DEV_ID_PREFIX = "u:";

const str = (v: unknown, field: string, max: number, required = true): string | null => {
  if (v === undefined || v === null) {
    if (required) throw new ComponentProblem(`${field} é obrigatório.`, field);
    return null;
  }
  if (typeof v !== "string" || !v.trim()) throw new ComponentProblem(`${field} deve ser texto.`, field);
  if (v.trim().length > max) throw new ComponentProblem(`${field} pode ter até ${max} caracteres.`, field);
  return v.trim();
};

function parseItem(raw: unknown, field: string, titleMax: number, withDescription: boolean): ButtonInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ComponentProblem(`${field} deve ser um objeto {title, id?, action?}.`, field);
  const o = raw as Record<string, unknown>;
  const title = str(o.title, `${field}.title`, titleMax)!;
  const id = o.id === undefined || o.id === null ? null : typeof o.id === "string" && DEV_ID.test(o.id) ? o.id : null;
  if ((o.id !== undefined && o.id !== null) && !id) throw new ComponentProblem(`${field}.id deve ter até 100 caracteres (letras, números, _ . : -).`, `${field}.id`);
  const description = withDescription ? str(o.description, `${field}.description`, LIMITS.listDetail, false) : null;
  let action: ButtonInput["action"] = null;
  if (o.action !== undefined && o.action !== null) {
    const a = o.action as Record<string, unknown>;
    if (!a || typeof a !== "object" || Array.isArray(a) || typeof a.name !== "string" || !/^[a-z][a-z0-9_]{1,47}$/.test(a.name)) throw new ComponentProblem(`${field}.action deve ser {name, params}, com o nome de uma ação do chatbot.`, `${field}.action`);
    const params = a.params ?? {};
    if (!params || typeof params !== "object" || Array.isArray(params)) throw new ComponentProblem(`${field}.action.params deve ser um objeto.`, `${field}.action.params`);
    action = { name: a.name, params: params as Record<string, unknown> };
  }
  return { title, id, description, action };
}

/** Confere o componente (objeto, ou lista com um só). Lança ComponentProblem. Função pura. */
export function parseComponentInput(raw: unknown, field = "components"): ComponentInput {
  let c = raw;
  if (Array.isArray(raw)) {
    if (raw.length !== 1) throw new ComponentProblem("Um componente por mensagem.", field);
    c = raw[0];
    field = `${field}[0]`;
  }
  if (!c || typeof c !== "object") throw new ComponentProblem(`${field} deve ser um objeto com type: buttons, list ou link.`, field);
  const o = c as Record<string, unknown>;
  if (o.type === "buttons") {
    if (!Array.isArray(o.buttons) || !o.buttons.length || o.buttons.length > LIMITS.buttons) throw new ComponentProblem(`${field}.buttons deve ter de 1 a ${LIMITS.buttons} botões.`, `${field}.buttons`);
    return { type: "buttons", buttons: o.buttons.map((b, i) => parseItem(b, `${field}.buttons[${i}]`, LIMITS.buttonTitle, false)) };
  }
  if (o.type === "list") {
    if (!Array.isArray(o.items) || !o.items.length || o.items.length > LIMITS.list) throw new ComponentProblem(`${field}.items deve ter de 1 a ${LIMITS.list} itens.`, `${field}.items`);
    return { type: "list", button: str(o.button, `${field}.button`, LIMITS.buttonTitle, false), items: o.items.map((b, i) => parseItem(b, `${field}.items[${i}]`, LIMITS.listTitle, true)) };
  }
  if (o.type === "link") {
    const title = str(o.title ?? o.label, `${field}.title`, LIMITS.linkLabel)!;
    const url = str(o.url, `${field}.url`, 2048)!;
    let ok = false;
    try {
      ok = new URL(url).protocol === "https:";
    } catch {
      ok = false;
    }
    if (!ok) throw new ComponentProblem(`${field}.url deve ser um endereço HTTPS.`, `${field}.url`);
    if (isChatLink(url)) throw new ComponentProblem(`${field}.url não pode ser link de WhatsApp ou de DM (a conversa já é por aqui).`, `${field}.url`);
    return { type: "link", title, url };
  }
  throw new ComponentProblem(`${field}.type deve ser "buttons", "list" ou "link".`, `${field}.type`);
}

/** Títulos e descrições do componente (o portão de texto da API confere todos). Função pura. */
export function componentTexts(c: ComponentInput): string[] {
  if (c.type === "link") return [c.title];
  const items = c.type === "buttons" ? c.buttons : c.items;
  return items.flatMap((b) => [b.title, ...(b.description ? [b.description] : [])]);
}

export interface MaterializeInput {
  bot: { id: string };
  conversationId: string;
  /** Portão dos canais da Meta: botão de pedido com item barrado não vai. null no site. */
  gate: { channel: "whatsapp" | "instagram"; contactPhone: string | null; exempt?: GateCategory[] } | null;
  /** API: problema vira erro (400 ou 422). Retorno de ação: o botão sai e fica no log. */
  strict: boolean;
}

/**
 * O componente pronto para os canais: botão com ação vira referência (parâmetros guardados no
 * BoaVoz), conferida contra as ações do chatbot (existe, ativa, parâmetros do schema, pedido só em
 * buttons). dropped: o que saiu (retorno de ação). null quando não sobra nada.
 */
export async function materializeComponent(db: SupabaseClient, c: ComponentInput, i: MaterializeInput): Promise<{ component: MessageComponent | null; dropped: string[] }> {
  if (c.type === "link") return { component: { type: "link", url: c.url, label: c.title }, dropped: [] };
  const items = c.type === "buttons" ? c.buttons : c.items;
  const isList = c.type === "list";
  const field = isList ? "components.items" : "components.buttons";
  const dropped: string[] = [];
  const problem = (message: string, f: string, kind: "invalid" | "prohibited" = "invalid") => {
    if (i.strict) throw new ComponentProblem(message, f, kind);
    dropped.push(message);
  };

  let actions: Map<string, ActionRow> | null = null;
  if (items.some((b) => b.action)) {
    const { data } = await db.from("actions").select("*").eq("bot_id", i.bot.id);
    actions = new Map(((data ?? []) as ActionRow[]).map((a) => [a.name, a]));
  }
  const map = i.gate && items.some((b) => b.action) ? await conversationIdMap(db, i.conversationId) : {};

  const options: OptionItem[] = [];
  for (const [n, b] of items.entries()) {
    const f = `${field}[${n}].action`;
    let id = b.id ? `${DEV_ID_PREFIX}${b.id}` : `op_${options.length + 1}`;
    if (b.action) {
      const a = actions?.get(b.action.name);
      if (!a) {
        problem(`A ação ${b.action.name} não existe neste chatbot.`, `${f}.name`);
        continue;
      }
      if (!a.active || a.paused_by_plan_at) {
        problem(`A ação ${a.name} está desativada.`, `${f}.name`);
        continue;
      }
      if (isList && a.creates_order === true) {
        problem(`A ação ${a.name} cria pedido, reserva ou cobrança: só vai em buttons (numa lista, use uma ação que adicione ao carrinho e devolva o resumo com "Finalizar pedido").`, f);
        continue;
      }
      const missing = paramsProblems(a.params_schema, b.action.params);
      if (missing.length) {
        problem(`Parâmetros da ação ${a.name} com problema: ${missing.join(", ")}.`, `${f}.params`);
        continue;
      }
      // pedido de item barrado no canal (mapa de ids e dicionário): o botão não vai
      if (i.gate && a.creates_order === true) {
        const facts = paramsGateFacts(b.action.params, map, { channel: i.gate.channel, contactPhone: i.gate.contactPhone, exempt: i.gate.exempt, preview: [b.title] });
        if (paramsGateDecision(facts, true) === "barrar") {
          await logGate(db, { botId: i.bot.id, conversationId: i.conversationId, stage: "saida", decision: "parametro_barrado", categories: [...new Set([...facts.mapHits.flatMap((h) => (h.categoria ? [h.categoria] : [])), ...facts.dictionary])] });
          problem(`O botão ${b.title} pede item que não pode ser vendido por este canal.`, f, "prohibited");
          continue;
        }
      }
      const refId = await createRef(db, { botId: i.bot.id, conversationId: i.conversationId, actionId: a.id, kind: "action", params: b.action.params, paramsHash: paramsHash(a.id, b.action.params), singleUse: needsConfirmation(a) });
      id = confirmButtonId(refId, "acao");
    }
    options.push({ id, title: b.title, ...(b.description ? { description: b.description } : {}) });
  }
  if (dropped.length) console.warn("componentes: itens fora", dropped);
  if (!options.length) return { component: null, dropped };
  return { component: { type: "options", options, ...(isList ? { list: true } : {}), ...(isList && c.button ? { button: c.button } : {}) }, dropped };
}
