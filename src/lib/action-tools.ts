import { jsonSchema, tool, type Tool } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { callAction, paramsProblems, type ActionLevel, type ActionRow, type CallContact } from "./actions";
import { gateActionData, saveIdMap } from "./action-gate";
import { firstExceeded } from "./rate-limit";
import { hiddenNote } from "./gate/context";
import { ageSource, type AgeStatus } from "./gate/age";
import { CATEGORIES, type GateCategory } from "./gate/rules";
import { checkActionReply } from "./gate/exit";
import { REGULATED_WINDOW_MS } from "./gate/payment";
import { logGate } from "./gate/log";

/*
 * As ações do bot como ferramentas da IA (spec "Peça 1"): acao_<nome>, só as de consulta ativas
 * que o contato pode usar (nível mínimo; as que exigem contexto ficam para a P2). A lista sai em
 * ordem fixa (cache do provedor). Cada chamada respeita os tetos (15 por minuto na conversa, 600
 * por minuto no bot) e o limite de "não encontrado" (5 em 1 hora tiram a ação da conversa).
 */

const LEVELS: ActionLevel[] = ["anonimo", "canal", "usuario"];

/** Regra do BoaVoz que vai depois da descrição do dev em toda ação. */
export const ACTION_RULE = "Chame a cada pergunta que precise desses dados, mesmo que já tenha consultado antes nesta conversa: o resultado pode ter mudado. Se a pessoa não deu um parâmetro obrigatório, não chame: peça a ela (nunca mande vazio nem inventado).";

/**
 * Item proibido tirado dos dados (cigarro, arma…), com qualquer idade: a IA informa o resto sem
 * citá-lo e mostra onde ver a versão completa: o link do pedido nos dados, senão o canal que a
 * empresa declarou para esses itens (site, app, telefone). Função pura.
 */
export function prohibitedNote(links: string[], destination: { destino: string } | null): string {
  const base = "Alguns itens não podem ser citados por este canal: informe o resto sem citá-los e sem dizer que foram removidos.";
  if (links.length) return `${base} Diga que a versão completa está em ${links[0]}.`;
  if (destination) return `${base} Se a pessoa perguntar por eles, diga que os detalhes desses itens ficam fora do chat: ${destination.destino}.`;
  return `${base} Se a pessoa perguntar por eles, diga que os detalhes desses itens não podem ser mostrados por aqui.`;
}

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
export const reaches = (contact: ActionLevel, min: ActionLevel) => LEVELS.indexOf(contact) >= LEVELS.indexOf(min);

/** Nível do contato na P1: canal quando a Meta garante quem é (telefone no WhatsApp, Instagram); senão anônimo. */
export function contactLevel(channel: string, waPhone: string | null): ActionLevel {
  if (channel === "whatsapp") return waPhone ? "canal" : "anonimo";
  if (channel === "instagram") return "canal";
  return "anonimo";
}

/** Ações que a IA deste bot pode receber agora (consulta, ativas, sem efeito de pedido). */
export async function loadBotActions(db: SupabaseClient, botId: string): Promise<ActionRow[]> {
  const { data, error } = await db.from("actions").select("*").eq("bot_id", botId).eq("active", true).eq("type", "query").order("name");
  if (error) {
    console.error("ações: não carregaram", error.message);
    return [];
  }
  return ((data ?? []) as ActionRow[]).filter((a) => a.creates_order !== true);
}

export interface ActionToolsInput {
  bot: { id: string };
  /** Canal declarado para bebida e remédio (regulatedDestination): onde ver o que não sai no chat. */
  destination?: { destino: string } | null;
  conversationId: string;
  channel: "widget" | "demo" | "painel" | "whatsapp" | "instagram";
  waPhone: string | null;
  age: AgeStatus;
  /** Quem fala no canal (wa_id ou BSUID no WhatsApp, IGSID no Instagram), para a origem da idade. */
  contactKey?: string | null;
  exempt?: GateCategory[];
  /** Chave da mensagem: forma o call_id (o mesmo no reprocesso). */
  messageKey: string;
  /** A ação devolveu reply: o texto exato vai para o contato e a vez acaba. */
  onReply: (reply: string) => void;
}

/** Ferramentas acao_<nome> para esta resposta (vazio se o bot não tem ações). */
export async function actionToolsFor(db: SupabaseClient, i: ActionToolsInput): Promise<Record<string, Tool>> {
  const level = contactLevel(i.channel, i.waPhone);
  const actions = (await loadBotActions(db, i.bot.id)).filter((a) => a.context_required === "none" && reaches(level, a.min_level));
  if (!actions.length) return {};
  const { data: conv } = await db.from("conversations").select("contact_id, regulated_at").eq("id", i.conversationId).maybeSingle();
  const regulatedAt = (conv?.regulated_at as string | null | undefined) ?? null;
  const gateChannel = i.channel === "whatsapp" || i.channel === "instagram" ? i.channel : "widget";
  const source = i.age !== null && gateChannel !== "widget" && i.contactKey ? await ageSource(db, { botId: i.bot.id, channel: gateChannel, contact: i.contactKey }) : null;
  const contact: CallContact = {
    id: (conv?.contact_id as string | null) ?? null,
    level,
    verified_by: gateChannel === "widget" ? null : "meta",
    phone: i.waPhone,
    whatsapp_user_id: null,
    age_confirmed: i.age === "sim" ? true : i.age === "nao" ? false : null,
    age_confirmed_source: i.age ? (source ?? "chat") : null,
  };

  const tools: Record<string, Tool> = {};
  for (const a of actions) {
    tools[`acao_${a.name}`] = tool({
      description: `${a.description}\n\n${ACTION_RULE}`,
      inputSchema: jsonSchema<Record<string, unknown>>(a.params_schema as Parameters<typeof jsonSchema>[0]),
      execute: async (params: Record<string, unknown>) => {
        // obrigatório ausente ou vazio: o endpoint não é chamado; a IA pede o dado à pessoa
        const missing = paramsProblems(a.params_schema, params);
        if (missing.length) return { ok: false, motivo: "faltam_dados", faltando: missing, instrucao: `Peça à pessoa: ${missing.join(", ")}. Não diga que não tem a informação.` };
        const limited = await firstExceeded(db, [
          { key: `acao:${i.conversationId}:m`, max: 15, windowSeconds: 60, message: "rate_limited" },
          { key: `acao:bot:${i.bot.id}:m`, max: 600, windowSeconds: 60, message: "rate_limited" },
        ]);
        if (limited) return { ok: false, motivo: "rate_limited", instrucao: "Diga que são muitas consultas seguidas e peça para tentar de novo em um minuto." };
        // 5 "não encontrado" desta ação nesta conversa em 1 hora: ninguém varre códigos de pedido ou de cliente
        const { count: misses } = await db.from("action_calls").select("id", { count: "exact", head: true }).eq("action_id", a.id).eq("conversation_id", i.conversationId).eq("status", "not_found").gt("created_at", new Date(Date.now() - 3_600_000).toISOString());
        if ((misses ?? 0) >= 5) return { ok: false, motivo: "indisponivel", instrucao: "Esta consulta não está disponível agora. Não tente de novo; ofereça falar com a equipe." };

        const r = await callAction(db, a, { params, messageKey: i.messageKey, conversation: { id: i.conversationId, channel: gateChannel }, contact });
        if (r.status === "not_found") return { ok: false, motivo: "nao_encontrado", detalhe: r.error ?? null };
        if (r.status !== "ok") return { ok: false, motivo: "falha", instrucao: "Diga que não conseguiu consultar agora e siga a conversa (sem inventar o resultado)." };

        // portão do canal no data (como na base): o que sai entra no mapa de ids da conversa
        const gated = gateActionData(r.data, { channel: gateChannel, contactPhone: i.waPhone, age: i.age, exempt: i.exempt });
        if (Object.keys(gated.ids).length) await saveIdMap(db, i.conversationId, gated.ids);
        // reply nos canais da Meta: conferido aqui, para a IA ainda poder responder com o data se ele cair
        let reply = r.reply;
        if (reply && gateChannel !== "widget") {
          const regulatedConversation = gated.hidden.some((c) => CATEGORIES[c].level === "regulamentado") || (regulatedAt !== null && Date.now() - Date.parse(regulatedAt) < REGULATED_WINDOW_MS);
          const rc = checkActionReply({ text: reply, channel: gateChannel, contactPhone: i.waPhone, age: i.age, regulatedConversation, exempt: i.exempt });
          if (replyOutcome(rc, { age: i.age }) === "descartar") {
            await logGate(db, { botId: i.bot.id, conversationId: i.conversationId, stage: "saida", decision: "reply_descartado", categories: [...rc.prohibited, ...rc.regulated] });
            reply = null;
          }
        }
        if (reply) i.onReply(reply);
        // o que saiu: proibido (com a saída para ver fora do chat) e 18+ (a pergunta de idade)
        const prohibitedHidden = gated.hidden.some((c) => CATEGORIES[c].level === "proibido");
        const notes = [prohibitedHidden ? prohibitedNote(gated.links, i.destination ?? null) : null, hiddenNote(gated.hidden, i.age)].filter(Boolean);
        const hiddenAviso = !gated.hidden.length ? null : notes.length ? notes.join(" ") : "Alguns itens ficaram de fora desta resposta: não cite nem diga que a empresa não tem.";
        // o que saiu, para o histórico: por idade (vale até o "Sim") e proibido (vale sempre)
        const byAge = gated.hidden.filter((c) => CATEGORIES[c].level === "regulamentado");
        return {
          ok: true,
          data: gated.data,
          ...(hiddenAviso ? { aviso: hiddenAviso } : {}),
          ...(byAge.length ? { ocultos_por_idade: byAge } : {}),
          ...(prohibitedHidden ? { ocultos_proibidos: true } : {}),
          // com reply, a resposta exata já vai para o contato: não escreva mais nada
          ...(reply ? { resposta_exata: reply, instrucao: "A resposta exata desta ação já vai para a pessoa. Não escreva nada." } : r.reply ? { instrucao: REPLY_DROPPED_NOTE } : {}),
        };
      },
    });
  }
  return tools;
}
