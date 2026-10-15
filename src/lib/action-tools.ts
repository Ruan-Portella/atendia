import { jsonSchema, tool, type Tool } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { callAction, needsConfirmation, paramsProblems, reaches, type ActionLevel, type ActionRow, type CallContact, type CallResult } from "./actions";
import { gateActionData, idLabels, saveIdMap } from "./action-gate";
import { openConfirmation, type Caller } from "./action-confirm";
import { ComponentProblem, materializeComponent, parseComponentInput } from "./component-input";
import { filesNote, prepareActionFiles, readAttachmentList, type ActionFile } from "./action-files";
import type { MessageComponent } from "./components";
import { firstExceeded } from "./rate-limit";
import { hiddenNote } from "./gate/context";
import { ageSource, type AgeStatus } from "./gate/age";
import { CATEGORIES, type GateCategory } from "./gate/rules";
import { checkActionReply } from "./gate/exit";
import { REGULATED_WINDOW_MS } from "./gate/payment";
import { logGate } from "./gate/log";
import { INTERNAL_RULE, internalTerms } from "./internal-guard";
import type { ChatIdentity } from "./widget-identity";

/*
 * As ações do bot como ferramentas da IA (spec "Peça 1"): acao_<nome>, só as ativas que o contato
 * pode usar (nível mínimo; as que exigem contexto, só com ele). A lista sai em ordem fixa (cache do
 * provedor). Cada chamada respeita os tetos (15 por minuto na conversa, 600 por minuto no bot) e o
 * limite de "não encontrado" (5 em 1 hora tiram a ação da conversa). Consulta chama o endpoint na
 * hora; "executa" (ou pedido, reserva e cobrança) só monta o resumo com Confirmar e Cancelar
 * (action-confirm.ts), e o endpoint só é chamado no clique.
 */

export { reaches };

/** Regra do BoaVoz que vai depois da descrição do dev em toda ação. */
export const ACTION_RULE = "Chame a cada pergunta que precise desses dados, mesmo que já tenha consultado antes nesta conversa: o resultado pode ter mudado. Se a pessoa não deu um parâmetro obrigatório, não chame: peça a ela (nunca mande vazio nem inventado).";

/** Regra das ações que fazem algo de verdade: a confirmação é do BoaVoz, por botão. */
export const CONFIRM_RULE =
  "Esta ação faz uma operação de verdade (cria, altera ou cancela). Chame quando a pessoa já disse o que quer, com todos os dados obrigatórios (nunca vazio nem inventado): o sistema mostra a ela um resumo com os botões Confirmar e Cancelar e só executa depois do Confirmar. Parâmetro que pede id ou código de item leva o id que uma ação de consulta devolveu nesta conversa (se ainda não consultou, chame a consulta antes); nunca escreva o nome no lugar do id. Ao chamar, não escreva texto: o resumo vai pronto para a pessoa. Nunca diga que já foi feito antes da confirmação.";

/** O que a IA recebe depois de abrir a confirmação (a vez acaba aqui). */
export const CONFIRM_SENT_NOTE = "O resumo com os botões Confirmar e Cancelar vai para a pessoa agora. Nada foi feito ainda: só depois do Confirmar.";

/**
 * Item proibido tirado dos dados (cigarro, arma…), com qualquer idade: a IA informa o resto sem
 * citá-lo e mostra onde ver a versão completa: o link do pedido nos dados, senão o canal que a
 * empresa declarou para esses itens (site, app, telefone). Função pura.
 */
export function prohibitedNote(links: string[], destination: { destino: string } | null): string {
  const base = "Alguns itens foram tirados destes dados porque não podem ser citados por este canal: cite normalmente tudo o que está nos dados, sem citar os que saíram e sem dizer que foram removidos.";
  if (links.length) return `${base} Diga que a versão completa está em ${links[0]}.`;
  if (destination) return `${base} Se a pessoa perguntar por eles, diga que os detalhes desses itens ficam fora do chat: ${destination.destino}.`;
  return `${base} Se a pessoa perguntar por eles, diga que os detalhes desses itens não podem ser mostrados por aqui.`;
}

/** 18+ confirmado e bebida ou remédio nos dados: citar é ver, não vender (decisão de 2026-10-03). */
export const shownRegulatedNote = (labels: string) =>
  `A pessoa confirmou ter 18 anos ou mais: cite normalmente os itens de ${labels} que estão nos dados (por exemplo, os itens de um pedido já feito). Só não feche venda, não anote pedido novo desses itens e não mande pagamento por aqui.`;

/** Reply barrado: a IA responde com o data (já filtrado), e a pessoa não perde o resto. */
export const REPLY_DROPPED_NOTE = "A resposta pronta da empresa não pode ser enviada por este canal. Responda você com os dados acima, sem citar itens que não estão neles; se os dados não bastarem, diga que esses detalhes não podem ser mostrados por aqui e ofereça o resto do atendimento.";

/**
 * O que fazer com o reply nos canais da Meta. Função pura.
 * - enviar: passou no portão;
 * - esperar_idade: só item 18+, sem resposta de idade (o canal pergunta e guarda o reply);
 * - descartar: item proibido, pagamento, ou 18+ depois do "Não" (a IA responde com o data filtrado).
 */
export function replyOutcome(rc: { ok: boolean; prohibited: GateCategory[]; regulated: GateCategory[]; payment: boolean }, o: { age: AgeStatus }): "enviar" | "esperar_idade" | "descartar" {
  if (rc.ok) return "enviar";
  if (!rc.prohibited.length && !rc.payment && rc.regulated.length && o.age === null) return "esperar_idade";
  return "descartar";
}

/** Linha do prompt para bots com ações: consultar antes de dizer que não tem a informação. */
export const ACTIONS_PROMPT_NOTE = "As ferramentas acao_ consultam os sistemas da empresa (pedidos, cadastro, agenda, estoque). Antes de dizer que não tem uma informação ou que vai confirmar com a equipe, veja se uma delas consulta isso e chame, mesmo que antes nesta conversa você tenha respondido que não tinha.";

/** Nível do contato na P1: canal quando a Meta garante quem é (telefone no WhatsApp, Instagram); senão anônimo. */
export function contactLevel(channel: string, waPhone: string | null): ActionLevel {
  if (channel === "whatsapp") return waPhone ? "canal" : "anonimo";
  if (channel === "instagram") return "canal";
  return "anonimo";
}

/** Ações que a IA deste bot pode receber agora (ativas, sem pausa do plano). */
export async function loadBotActions(db: SupabaseClient, botId: string): Promise<ActionRow[]> {
  const { data, error } = await db.from("actions").select("*").eq("bot_id", botId).eq("active", true).is("paused_by_plan_at", null).order("name");
  if (error) {
    console.error("ações: não carregaram", error.message);
    return [];
  }
  return (data ?? []) as ActionRow[];
}

export interface CallerInput {
  bot: { id: string };
  conversationId: string;
  channel: "widget" | "demo" | "painel" | "whatsapp" | "instagram";
  waPhone: string | null;
  age: AgeStatus;
  /** Quem fala no canal (wa_id ou BSUID no WhatsApp, IGSID no Instagram), para a origem da idade. */
  contactKey?: string | null;
  /** Contato identificado (P2): nível usuario e o contexto assinado da conversa. */
  identity?: ChatIdentity | null;
}

/** O contato e o contexto que vão no corpo da chamada (consulta, prévia e clique em Confirmar). */
export async function callerFor(db: SupabaseClient, i: CallerInput): Promise<Caller & { regulatedAt: string | null }> {
  // identificado pela empresa (token ou pareamento): nível usuario; ação que exige contexto só com ele
  const level: ActionLevel = i.identity?.externalId ? "usuario" : contactLevel(i.channel, i.waPhone);
  const { data: conv } = await db.from("conversations").select("contact_id, regulated_at").eq("id", i.conversationId).maybeSingle();
  const gateChannel = i.channel === "whatsapp" || i.channel === "instagram" ? i.channel : "widget";
  const source = i.age !== null && gateChannel !== "widget" && i.contactKey ? await ageSource(db, { botId: i.bot.id, channel: gateChannel, contact: i.contactKey }) : null;
  // no widget, a idade vem do token (a empresa verificou); nos canais da Meta, da barreira de 18+
  const tokenAge = gateChannel === "widget" ? (i.identity?.ageVerified ?? null) : null;
  const contact: CallContact = {
    id: (conv?.contact_id as string | null) ?? null,
    level,
    verified_by: i.identity?.externalId ? (i.identity.source === "pairing" ? "pairing" : "signed_token") : gateChannel === "widget" ? null : "meta",
    ...(i.identity?.externalId ? { external_id: i.identity.externalId, display: i.identity.userDisplay } : {}),
    phone: i.waPhone,
    whatsapp_user_id: null,
    age_confirmed: tokenAge ?? (i.age === "sim" ? true : i.age === "nao" ? false : null),
    age_confirmed_source: tokenAge !== null ? "company" : i.age ? (source ?? "chat") : null,
  };
  return {
    level,
    hasContext: Boolean(i.identity?.context),
    contact,
    context: i.identity?.context ? { source: i.identity.source, data: i.identity.context } : null,
    gateChannel,
    regulatedAt: (conv?.regulated_at as string | null | undefined) ?? null,
  };
}

export interface ShapeInput {
  bot: { id: string };
  conversationId: string;
  gateChannel: "widget" | "whatsapp" | "instagram";
  waPhone: string | null;
  age: AgeStatus;
  exempt?: GateCategory[];
  /** Canal declarado para bebida e remédio (regulatedDestination): onde ver o que não sai no chat. */
  destination?: { destino: string } | null;
  regulatedAt: string | null;
}

/**
 * O que a IA lê sobre os botões que uma consulta devolveu. Eles só vão se a resposta pede a escolha
 * entre eles (mostrar_opcoes ou mostrar_link com eles, ver offeredMatch): a IA também consulta para
 * achar o id de um item ou conferir algo, e aí os botões não têm a ver com a resposta. Pura.
 */
export function componentNote(c: MessageComponent): Record<string, unknown> {
  if (c.type === "link") return { link: c.label, url: c.url, instrucao_botoes: "Se a sua resposta é abrir esse link, chame mostrar_link com essa url (vira o botão desta ação; não escreva o endereço). Se você consultou para outra coisa, não fale dele." };
  return { botoes: c.options.map((x) => x.title), instrucao_botoes: "Se a sua resposta pede para a pessoa escolher entre essas opções, chame mostrar_opcoes com elas (viram os botões desta ação). Se você consultou para outra coisa (achar o id de um item, conferir um preço ou um item que a pessoa já escolheu), não chame mostrar_opcoes nem fale de botões." };
}

const foldTitle = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * A escolha que a IA quer mostrar é a que a consulta devolveu? Opções: algum título igual (ou um
 * contido no outro, como "Calabresa" e "Pizza Calabresa"); link: a mesma url. Então vai o
 * componente da ação (com o que cada botão faz), senão null. Pura.
 */
export function offeredMatch(offered: MessageComponent | null, choice: { opcoes?: string[]; url?: string }): MessageComponent | null {
  if (!offered) return null;
  if (offered.type === "link") {
    const bare = (u: string) => u.trim().replace(/\/+$/, "").toLowerCase();
    return choice.url && bare(choice.url) === bare(offered.url) ? offered : null;
  }
  const mine = (choice.opcoes ?? []).map(foldTitle).filter((t) => t.length >= 3);
  const theirs = offered.options.map((o) => foldTitle(o.title));
  return mine.some((a) => theirs.some((b) => a === b || (b.length >= 3 && (a.includes(b) || b.includes(a))))) ? offered : null;
}

/** components do retorno de uma ação: conferido e convertido (botão com ação vira referência). Fora do formato: aviso no log e nada vai. */
async function actionComponent(db: SupabaseClient, i: ShapeInput, raw: unknown): Promise<MessageComponent | null> {
  if (raw === undefined || raw === null) return null;
  try {
    const input = parseComponentInput(raw);
    const gate = i.gateChannel === "widget" ? null : { channel: i.gateChannel, contactPhone: i.waPhone, exempt: i.exempt };
    return (await materializeComponent(db, input, { bot: i.bot, conversationId: i.conversationId, gate, strict: false })).component;
  } catch (e) {
    if (!(e instanceof ComponentProblem)) throw e;
    console.warn("ação: components fora do formato", e.field, e.message);
    return null;
  }
}

/**
 * O resultado de uma chamada como a IA recebe: o data pelo portão do canal (o que sai entra no mapa
 * de ids; o resto, com o rótulo, para o resumo do Confirmar), o reply conferido, o internal com a
 * regra de nunca citar, os components convertidos e os anexos preparados. reply: o texto exato que
 * vai ao contato (null se não veio ou caiu); component: botões, lista ou link que vão junto do
 * texto; files: os anexos (já baixados, conferidos e guardados), que saem logo depois do texto.
 */
export async function shapeActionResult(
  db: SupabaseClient,
  i: ShapeInput,
  r: CallResult,
  o: { execute?: boolean } = {},
): Promise<{ output: Record<string, unknown>; reply: string | null; internal: string[]; component: MessageComponent | null; files: ActionFile[] }> {
  if (r.status === "not_found") return { output: { ok: false, motivo: "nao_encontrado", detalhe: r.error ?? null }, reply: null, internal: [], component: null, files: [] };
  if (r.status !== "ok")
    return {
      output: { ok: false, motivo: "falha", instrucao: o.execute ? "Diga que não conseguiu concluir agora e ofereça tentar de novo daqui a pouco ou falar com alguém da equipe." : "Diga que não conseguiu consultar agora e siga a conversa (sem inventar o resultado)." },
      reply: null,
      internal: [],
      component: null,
      files: [],
    };

  // portão do canal no data (como na base): o que sai entra no mapa de ids da conversa
  const gated = gateActionData(r.data, { channel: i.gateChannel, contactPhone: i.waPhone, age: i.age, exempt: i.exempt });
  await saveIdMap(db, i.conversationId, { ...idLabels(gated.data), ...gated.ids });
  // reply nos canais da Meta: conferido aqui, para a IA ainda poder responder com o data se ele cair
  let reply = r.reply ?? null;
  if (reply && i.gateChannel !== "widget") {
    const regulatedConversation = gated.hidden.some((c) => CATEGORIES[c].level === "regulamentado") || (i.regulatedAt !== null && Date.now() - Date.parse(i.regulatedAt) < REGULATED_WINDOW_MS);
    const rc = checkActionReply({ text: reply, channel: i.gateChannel, contactPhone: i.waPhone, age: i.age, regulatedConversation, exempt: i.exempt });
    if (replyOutcome(rc, { age: i.age }) === "descartar") {
      await logGate(db, { botId: i.bot.id, conversationId: i.conversationId, stage: "saida", decision: "reply_descartado", categories: [...rc.prohibited, ...rc.regulated] });
      reply = null;
    }
  }
  // o que saiu: proibido (com a saída para ver fora do chat) e 18+ (a pergunta de idade)
  const prohibitedHidden = gated.hidden.some((c) => CATEGORIES[c].level === "proibido");
  const notes = [prohibitedHidden ? prohibitedNote(gated.links, i.destination ?? null) : null, hiddenNote(gated.hidden, i.age)].filter(Boolean);
  const hiddenAviso = !gated.hidden.length ? null : notes.length ? notes.join(" ") : "Alguns itens ficaram de fora desta resposta: não cite nem diga que a empresa não tem.";
  // o que ficou com o 18+: sem isso a IA escondia a cerveja do pedido ("e outros itens")
  const shownAviso = gated.shown.length ? shownRegulatedNote(gated.shown.map((c) => CATEGORIES[c].label).join(" e ")) : null;
  const aviso = [hiddenAviso, shownAviso].filter(Boolean).join(" ") || null;
  // o que saiu, para o histórico: por idade (vale até o "Sim") e proibido (vale sempre)
  const byAge = gated.hidden.filter((c) => CATEGORIES[c].level === "regulamentado");
  const component = await actionComponent(db, i, r.components);
  // anexos: preparados antes do texto (baixados, conferidos pelo portão e guardados)
  const list = readAttachmentList(r.attachments);
  const files = list.length ? await prepareActionFiles(db, list, { bot: i.bot, conversationId: i.conversationId, channel: i.gateChannel, gate: i.gateChannel === "widget" ? null : { contactPhone: i.waPhone, age: i.age, exempt: i.exempt } }) : [];
  return {
    output: {
      ok: true,
      data: gated.data,
      ...(component ? componentNote(component) : {}),
      ...filesNote(files),
      ...(aviso ? { aviso } : {}),
      // só para decidir o que dizer: a resposta é conferida antes de sair (internal-guard.ts)
      ...(r.internal ? { interno: r.internal, instrucao_interno: INTERNAL_RULE } : {}),
      ...(byAge.length ? { ocultos_por_idade: byAge } : {}),
      ...(prohibitedHidden ? { ocultos_proibidos: true } : {}),
      // com reply, a resposta exata já vai para o contato: não escreva mais nada
      ...(reply ? { resposta_exata: reply, instrucao: "A resposta exata desta ação já vai para a pessoa. Não escreva nada." } : r.reply ? { instrucao: REPLY_DROPPED_NOTE } : {}),
    },
    reply,
    internal: r.internal ? internalTerms(r.internal) : [],
    component,
    files,
  };
}

export interface ActionToolsInput extends CallerInput {
  destination?: { destino: string } | null;
  exempt?: GateCategory[];
  /** Chave da mensagem: forma o call_id (o mesmo no reprocesso). */
  messageKey: string;
  /** A ação devolveu reply: o texto exato vai para o contato e a vez acaba. */
  onReply: (reply: string) => void;
  /** A ação devolveu internal: os valores que a resposta não pode conter. */
  onInternal?: (terms: string[]) => void;
  /** Resumo com Confirmar e Cancelar desta vez (a vez acaba; o canal manda os botões). */
  onConfirm?: (c: { text: string; component: MessageComponent }) => void;
  /** Botões, lista ou link devolvidos por uma ação: vão junto do texto desta vez (a IA ainda escreve). */
  onComponent?: (c: MessageComponent) => void;
  /** Anexos devolvidos por uma ação: saem logo depois do texto desta vez. */
  onFiles?: (files: ActionFile[]) => void;
  /** Vez logo depois de um Confirmar: sem ações com Confirmar (nunca outra confirmação na mesma vez). */
  confirmRound?: boolean;
  /** Para o portão de parâmetros (etapa de IA): a agência paga a classificação. */
  agencyId?: string;
}

/** Ferramentas acao_<nome> para esta resposta (vazio se o bot não tem ações). */
export async function actionToolsFor(db: SupabaseClient, i: ActionToolsInput): Promise<Record<string, Tool>> {
  const all = await loadBotActions(db, i.bot.id);
  if (!all.length) return {};
  const caller = await callerFor(db, i);
  const actions = all.filter((a) => (a.context_required === "none" || caller.hasContext) && reaches(caller.level, a.min_level) && !(i.confirmRound && needsConfirmation(a)));
  if (!actions.length) return {};
  const shape: ShapeInput = { bot: i.bot, conversationId: i.conversationId, gateChannel: caller.gateChannel, waPhone: i.waPhone, age: i.age, exempt: i.exempt, destination: i.destination, regulatedAt: caller.regulatedAt };
  const gate = caller.gateChannel === "widget" ? null : { channel: caller.gateChannel, contactPhone: i.waPhone, exempt: i.exempt, destination: i.destination ?? null };
  const limits = () =>
    firstExceeded(db, [
      { key: `acao:${i.conversationId}:m`, max: 15, windowSeconds: 60, message: "rate_limited" },
      { key: `acao:bot:${i.bot.id}:m`, max: 600, windowSeconds: 60, message: "rate_limited" },
    ]);
  const RATE_LIMITED = { ok: false, motivo: "rate_limited", instrucao: "Diga que são muitas consultas seguidas e peça para tentar de novo em um minuto." };
  // uma confirmação por vez (as chamadas em paralelo ficam desligadas no provedor; isto é a garantia)
  let confirmOpened = false;

  const tools: Record<string, Tool> = {};
  for (const a of actions) {
    if (needsConfirmation(a)) {
      tools[`acao_${a.name}`] = tool({
        description: `${a.description}\n\n${CONFIRM_RULE}`,
        inputSchema: jsonSchema<Record<string, unknown>>(a.params_schema as Parameters<typeof jsonSchema>[0]),
        execute: async (params: Record<string, unknown>) => {
          if (confirmOpened || !i.onConfirm) return { ok: false, motivo: "uma_por_vez", instrucao: "Já há uma confirmação nesta resposta: espere a pessoa responder a ela." };
          const missing = paramsProblems(a.params_schema, params);
          if (missing.length) return { ok: false, motivo: "faltam_dados", faltando: missing, instrucao: `Peça à pessoa: ${missing.join(", ")}. Não chame com dado vazio ou inventado.` };
          if (await limits()) return RATE_LIMITED;
          const opened = await openConfirmation(db, { bot: { id: i.bot.id, agency_id: i.agencyId ?? "" }, conversationId: i.conversationId, action: a, params, caller, messageKey: i.messageKey, gate });
          if (!opened.ok) return opened.output;
          confirmOpened = true;
          i.onConfirm({ text: opened.text, component: opened.component });
          // componente e texto: o widget recebe o resumo e os botões pelo stream (como no mostrar_opcoes)
          return { ok: true, confirmacao: "enviada", componente: opened.component, texto: opened.text, instrucao: CONFIRM_SENT_NOTE };
        },
      });
      continue;
    }
    tools[`acao_${a.name}`] = tool({
      description: `${a.description}\n\n${ACTION_RULE}`,
      inputSchema: jsonSchema<Record<string, unknown>>(a.params_schema as Parameters<typeof jsonSchema>[0]),
      execute: async (params: Record<string, unknown>) => {
        // obrigatório ausente ou vazio: o endpoint não é chamado; a IA pede o dado à pessoa
        const missing = paramsProblems(a.params_schema, params);
        if (missing.length) return { ok: false, motivo: "faltam_dados", faltando: missing, instrucao: `Peça à pessoa: ${missing.join(", ")}. Não diga que não tem a informação.` };
        if (await limits()) return RATE_LIMITED;
        // 5 "não encontrado" desta ação nesta conversa em 1 hora: ninguém varre códigos de pedido ou de cliente
        const { count: misses } = await db.from("action_calls").select("id", { count: "exact", head: true }).eq("action_id", a.id).eq("conversation_id", i.conversationId).eq("status", "not_found").gt("created_at", new Date(Date.now() - 3_600_000).toISOString());
        if ((misses ?? 0) >= 5) return { ok: false, motivo: "indisponivel", instrucao: "Esta consulta não está disponível agora. Não tente de novo; ofereça falar com a equipe." };

        const r = await callAction(db, a, { params, messageKey: i.messageKey, conversation: { id: i.conversationId, channel: caller.gateChannel }, contact: caller.contact, context: caller.context });
        const shaped = await shapeActionResult(db, shape, r);
        if (shaped.reply) i.onReply(shaped.reply);
        if (shaped.internal.length) i.onInternal?.(shaped.internal);
        if (shaped.component) i.onComponent?.(shaped.component);
        if (shaped.files.length) i.onFiles?.(shaped.files);
        return shaped.output;
      },
    });
  }
  return tools;
}
