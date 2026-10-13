import { jsonSchema, tool, type Tool } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { callAction, needsConfirmation, paramsProblems, reaches, type ActionLevel, type ActionRow, type CallContact, type CallResult, type ParamsSchema } from "./actions";
import { gateActionData, idLabels, saveIdMap } from "./action-gate";
import { openConfirmation, type Caller } from "./action-confirm";
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
  "Esta ação faz uma operação de verdade (cria, altera ou cancela). Chame quando a pessoa já disse o que quer, com todos os dados obrigatórios (nunca vazio nem inventado): o sistema mostra a ela um resumo com os botões Confirmar e Cancelar e só executa depois do Confirmar. Parâmetro que pede id ou código de item leva o id que uma ação de consulta devolveu nesta conversa (se ainda não consultou, chame a consulta antes); nunca escreva o nome no lugar do id. Em boavoz_resumo, escreva uma frase curta que apresenta o resumo (ex.: \"Confere o seu pedido:\"), sem repetir os itens. Nunca diga que já foi feito antes da confirmação.";

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

/** O schema que a IA vê numa ação com Confirmar: o do dev mais a frase do resumo. Função pura. */
export function confirmToolSchema(s: ParamsSchema): ParamsSchema {
  return {
    ...s,
    properties: { ...(s.properties ?? {}), boavoz_resumo: { type: "string", description: "Frase curta que apresenta o resumo para a pessoa conferir (ex.: \"Confere o seu pedido:\")" } },
    required: [...(s.required ?? []), "boavoz_resumo"],
  };
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
 * O resultado de uma chamada como a IA recebe: o data pelo portão do canal (o que sai entra no mapa
 * de ids; o resto, com o rótulo, para o resumo do Confirmar), o reply conferido e o internal com a
 * regra de nunca citar. reply: o texto exato que vai ao contato (null se não veio ou caiu).
 */
export async function shapeActionResult(db: SupabaseClient, i: ShapeInput, r: CallResult, o: { execute?: boolean } = {}): Promise<{ output: Record<string, unknown>; reply: string | null; internal: string[] }> {
  if (r.status === "not_found") return { output: { ok: false, motivo: "nao_encontrado", detalhe: r.error ?? null }, reply: null, internal: [] };
  if (r.status !== "ok")
    return {
      output: { ok: false, motivo: "falha", instrucao: o.execute ? "Diga que não conseguiu concluir agora e ofereça tentar de novo daqui a pouco ou falar com alguém da equipe." : "Diga que não conseguiu consultar agora e siga a conversa (sem inventar o resultado)." },
      reply: null,
      internal: [],
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
  return {
    output: {
      ok: true,
      data: gated.data,
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
        inputSchema: jsonSchema<Record<string, unknown>>(confirmToolSchema(a.params_schema) as Parameters<typeof jsonSchema>[0]),
        execute: async (input: Record<string, unknown>) => {
          const { boavoz_resumo: intro, ...params } = input;
          if (confirmOpened || !i.onConfirm) return { ok: false, motivo: "uma_por_vez", instrucao: "Já há uma confirmação nesta resposta: espere a pessoa responder a ela." };
          const missing = paramsProblems(a.params_schema, params);
          if (missing.length) return { ok: false, motivo: "faltam_dados", faltando: missing, instrucao: `Peça à pessoa: ${missing.join(", ")}. Não chame com dado vazio ou inventado.` };
          if (await limits()) return RATE_LIMITED;
          const opened = await openConfirmation(db, { bot: { id: i.bot.id, agency_id: i.agencyId ?? "" }, conversationId: i.conversationId, action: a, params, intro: typeof intro === "string" ? intro : null, caller, messageKey: i.messageKey, gate });
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
        return shaped.output;
      },
    });
  }
  return tools;
}
