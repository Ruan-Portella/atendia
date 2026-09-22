import { convertToModelMessages, stepCountIs, streamText, tool, type UIMessage } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSystemPrompt, chatModel, embedText, type Persona } from "./ai";
import { currentPeriod, getPlan } from "./plans";
import { notifyHandoff, notifyLead } from "./notify";

export interface BotRow {
  id: string;
  agency_id: string;
  name: string;
  client_name: string;
  client_site: string | null;
  public_key: string;
  is_demo: boolean;
  status: string;
  persona: Persona;
  appearance: { color?: string; avatar_text?: string; suggested_questions?: string[] };
  lead_capture: { enabled?: boolean; notify_email?: string | null; notify_whatsapp?: string | null };
}

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function lastUserText(messages: UIMessage[]): string {
  const last = [...messages].reverse().find((m) => m.role === "user");
  if (!last) return "";
  return last.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join(" ")
    .trim();
}

/**
 * Executa uma rodada de chat para um bot: recupera contexto (RAG), responde em streaming,
 * registra lead/pergunta sem resposta/pedido de atendente via ferramentas e persiste as mensagens.
 */
export async function runChat(opts: {
  db: SupabaseClient;
  bot: BotRow;
  messages: UIMessage[];
  conversationId: string | null;
  visitorId: string | null;
  channel: "widget" | "demo" | "painel";
}) {
  const { db, bot, messages, channel } = opts;

  // 1. Conversa (cria na primeira mensagem) + cota mensal da agência
  let conversationId = opts.conversationId;
  if (!conversationId) {
    const { data: agency } = await db.from("agencies").select("plan, trial_ends_at").eq("id", bot.agency_id).single();
    const plan = getPlan(agency?.plan ?? "trial");
    if (plan.id === "trial" && agency?.trial_ends_at && new Date(agency.trial_ends_at) < new Date()) {
      throw new Error("trial_expired");
    }
    const { data: used } = await db.rpc("increment_usage", { p_agency_id: bot.agency_id, p_period: currentPeriod() });
    if (typeof used === "number" && used > plan.conversations) throw new Error("quota_exceeded");

    const { data: conv, error } = await db
      .from("conversations")
      .insert({ bot_id: bot.id, visitor_id: opts.visitorId, channel })
      .select("id")
      .single();
    if (error || !conv) throw new Error("Não foi possível abrir a conversa.");
    conversationId = conv.id as string;
  }

  // 2. Recuperação de contexto
  const question = lastUserText(messages);
  let context = "";
  const used: Array<{ title?: string; url?: string }> = [];
  if (question) {
    const embedding = await embedText(question);
    const { data: hits } = await db.rpc("match_chunks", { p_bot_id: bot.id, p_query: JSON.stringify(embedding), p_count: 6, p_min_similarity: 0.15 });
    const rows = (hits ?? []) as Array<{ content: string; metadata: { title?: string; url?: string }; similarity: number }>;
    context = rows.map((r, i) => `[${i + 1}] ${r.metadata?.title ? r.metadata.title + "\n" : ""}${r.content}`).join("\n\n---\n\n");
    for (const r of rows) {
      const key = r.metadata?.url ?? r.metadata?.title;
      if (key && !used.some((u) => (u.url ?? u.title) === key)) used.push({ title: r.metadata?.title, url: r.metadata?.url });
    }
  }

  const leadEnabled = bot.lead_capture?.enabled !== false;
  // o que um atendente humano já escreveu (quando a conversa volta para o assistente)
  const { data: agentRows } = opts.conversationId
    ? await db.from("messages").select("content").eq("conversation_id", conversationId).eq("role", "agent").order("id", { ascending: false }).limit(6)
    : { data: [] };
  const agentMessages = (agentRows ?? []).map((r) => String(r.content).slice(0, 500)).reverse();
  const system = buildSystemPrompt({ assistantName: bot.name, clientName: bot.client_name, persona: bot.persona ?? {}, context, leadCapture: leadEnabled, agentMessages });
  const convId = conversationId;

  // 3. Persiste a pergunta do visitante
  if (question) {
    await db.from("messages").insert({ conversation_id: convId, role: "user", content: question });
  }

  const result = streamText({
    model: chatModel(),
    system,
    messages: await convertToModelMessages(messages.slice(-12)),
    temperature: 0.3,
    stopWhen: stepCountIs(3),
    tools: {
      registrar_lead: tool({
        description: "Registra o contato de um visitante interessado (nome e WhatsApp ou e-mail) para a equipe retornar.",
        inputSchema: z.object({
          nome: z.string().min(2),
          whatsapp: z.string().optional(),
          email: z.string().optional(),
          interesse: z.string().optional().describe("o que a pessoa quer: agendar, orçamento, etc."),
        }),
        execute: async (input) => {
          if (!leadEnabled) return { ok: false };
          const { data: lead } = await db
            .from("leads")
            .insert({ bot_id: bot.id, conversation_id: convId, name: input.nome, phone: input.whatsapp ?? null, email: input.email ?? null, notes: input.interesse ?? null })
            .select("id")
            .single();
          notifyLead({ db, bot, lead: { id: lead?.id, ...input } }).catch(() => {});
          return { ok: true };
        },
      }),
      chamar_atendente: tool({
        description: "Avisa a equipe que o visitante quer falar com uma pessoa. Use quando ele pedir atendente, humano ou alguém da equipe.",
        inputSchema: z.object({ motivo: z.string().optional().describe("resumo curto do que a pessoa precisa") }),
        execute: async ({ motivo }) => {
          const { data: updated } = await db
            .from("conversations")
            .update({ needs_human: true, handoff_requested_at: new Date().toISOString(), handled_at: null })
            .eq("id", convId)
            .or("handoff_requested_at.is.null,handled_at.not.is.null")
            .select("id");
          // avisa na primeira vez (ou de novo, se o atendimento anterior já tinha sido encerrado)
          if (updated?.length) notifyHandoff({ db, bot, conversationId: convId, reason: motivo ?? question }).catch(() => {});
          else await db.from("conversations").update({ needs_human: true, handled_at: null }).eq("id", convId);
          return { ok: true };
        },
      }),
      registrar_pergunta_sem_resposta: tool({
        description: "Registra uma pergunta que não pôde ser respondida com o conteúdo disponível, para a empresa completar depois.",
        inputSchema: z.object({ pergunta: z.string().min(3) }),
        execute: async ({ pergunta }) => {
          await db.from("unanswered").insert({ bot_id: bot.id, question: pergunta.slice(0, 500) });
          await db.from("conversations").update({ needs_human: true }).eq("id", convId);
          return { ok: true };
        },
      }),
    },
    onFinish: async ({ text }) => {
      if (text) {
        await db.from("messages").insert({ conversation_id: convId, role: "assistant", content: text, sources: used.length ? used : null });
      }
      const { count } = await db.from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", convId);
      await db.from("conversations").update({ last_message_at: new Date().toISOString(), message_count: count ?? 0 }).eq("id", convId);
    },
  });

  return { result, conversationId: convId, sources: used };
}
