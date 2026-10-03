import { jsonSchema, tool, type Tool } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { callAction, type ActionLevel, type ActionRow, type CallContact } from "./actions";
import { gateActionData, saveIdMap } from "./action-gate";
import { firstExceeded } from "./rate-limit";
import { hiddenNote } from "./gate/context";
import { ageSource, type AgeStatus } from "./gate/age";
import type { GateCategory } from "./gate/rules";

/*
 * As ações do bot como ferramentas da IA (spec "Peça 1"): acao_<nome>, só as de consulta ativas
 * que o contato pode usar (nível mínimo; as que exigem contexto ficam para a P2). A lista sai em
 * ordem fixa (cache do provedor). Cada chamada respeita os tetos (15 por minuto na conversa, 600
 * por minuto no bot) e o limite de "não encontrado" (5 em 1 hora tiram a ação da conversa).
 */

const LEVELS: ActionLevel[] = ["anonimo", "canal", "usuario"];
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
  const { data: conv } = await db.from("conversations").select("contact_id").eq("id", i.conversationId).maybeSingle();
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
      description: a.description,
      inputSchema: jsonSchema<Record<string, unknown>>(a.params_schema as Parameters<typeof jsonSchema>[0]),
      execute: async (params: Record<string, unknown>) => {
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
        if (r.reply) i.onReply(r.reply);
        return {
          ok: true,
          data: gated.data,
          ...(gated.hidden.length ? { aviso: hiddenNote(gated.hidden, i.age) ?? "Alguns itens ficaram de fora desta resposta: não cite nem diga que a empresa não tem." } : {}),
          // com reply, a resposta exata já vai para o contato: não escreva mais nada
          ...(r.reply ? { resposta_exata: r.reply, instrucao: "A resposta exata desta ação já vai para a pessoa. Não escreva nada." } : {}),
        };
      },
    });
  }
  return tools;
}
