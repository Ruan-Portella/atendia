import { generateText, stepCountIs } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSystemPrompt, chatModel, chatModelId, scopeReminder } from "./ai";
import { CHAT_TEMPERATURE, channelNoteFor, chatTools, gatePrompt, handoffPrompt, retrieveContext, withRiskText, type BotRow } from "./chat";
import { handoffNotice } from "./handoff-hours";
import { RISK_TEXT } from "./risk";
import { NO_INFO_PHRASE } from "./unanswered";
import { decideEntrance } from "./gate/entrance";
import { GATE_TEXTS } from "./gate/rules";
import type { AgeStatus } from "./gate/age";

/*
 * Avaliação (L1, passo 5): roda a mesma pergunta N vezes contra um bot pelo mesmo caminho do
 * chat (portão da entrada, busca, prompt e ferramentas), sem gravar nada, para medir quanto ele
 * responde de fato. Mudança de prompt, temperatura ou modelo só vai para produção medida aqui.
 */

export interface EvalOptions {
  runs: number;
  temperature?: number;
  model?: string;
  channel?: "widget" | "whatsapp" | "instagram";
  /** Conversa anterior, alternando contato e assistente (começa pelo contato). */
  history?: string[];
  /** Idade do contato simulada (portão): sim, nao ou não confirmada. */
  age?: AgeStatus;
  /** Contato de fora do Brasil (no WhatsApp, regulamentado vira proibido). */
  foreign?: boolean;
}

export interface EvalRun {
  verdict: "respondeu" | "nao_tenho" | "so_registrou" | "recusou" | "barrou" | "pediu_18" | "erro";
  text: string;
  tools: string[];
  inputTokens: number;
  outputTokens: number;
}

const ONLY_REGISTERED = /^(registrei|anotei|deixei registrad)/i;

export function verdictOf(text: string, tools: string[]): EvalRun["verdict"] {
  const t = text.trim();
  if (tools.includes("pedir_confirmacao_18")) return "pediu_18";
  if (tools.includes("registrar_recusa")) return "recusou";
  if (t.startsWith(NO_INFO_PHRASE)) return "nao_tenho";
  if (ONLY_REGISTERED.test(t) && tools.includes("registrar_pergunta_sem_resposta")) return "so_registrou";
  return "respondeu";
}

export async function evaluateQuestion(db: SupabaseClient, bot: BotRow, question: string, opts: EvalOptions) {
  const retrieval = await retrieveContext(db, bot.id, question);
  const { context, hits } = retrieval;
  const phone = opts.foreign ? "14155550123" : "5521999990000";
  const channelNote = opts.channel === "whatsapp" ? channelNoteFor({ whatsapp: { waId: phone } }) : opts.channel === "instagram" ? channelNoteFor({ instagram: { igsid: "teste" } }) : undefined;
  const scopeLock = opts.channel === "whatsapp" || opts.channel === "instagram";
  const age = opts.age ?? null;
  const noop = async () => ({ ok: true });

  const one = async (): Promise<EvalRun> => {
    let urgent = false;
    try {
      // portão na entrada, como no canal: proibido e pergunta de 18+ nem chegam à IA principal
      const entrance = scopeLock ? await decideEntrance({ text: question, channel: opts.channel as "whatsapp" | "instagram", contactPhone: opts.channel === "whatsapp" ? phone : null, age, context, companyName: bot.client_name }) : null;
      if (entrance?.kind === "proibido") return { verdict: "barrou", text: GATE_TEXTS.prohibited, tools: [`portao:${entrance.categories.join(",")}`], inputTokens: 0, outputTokens: 0 };
      if (entrance?.kind === "pede_18") return { verdict: "pediu_18", text: GATE_TEXTS.ageQuestion, tools: ["portao:pede_18"], inputTokens: 0, outputTokens: 0 };

      // mesmo corte do chat: a base sem os itens barrados para esta pessoa e as linhas do portão
      const remind = entrance?.kind === "ia" && (entrance.regulated.length > 0 || entrance.prohibited.length > 0);
      const gated = scopeLock
        ? gatePrompt(bot, context, { channel: opts.channel as "whatsapp" | "instagram", contactPhone: opts.channel === "whatsapp" ? phone : null, gate: { age, instruction: entrance?.kind === "ia" ? entrance.instruction : undefined, remind } })
        : { context, gateNotes: [], reminder: [] };
      const system = buildSystemPrompt({
        assistantName: bot.name,
        clientName: bot.client_name,
        persona: bot.persona ?? {},
        context: gated.context,
        leadCapture: bot.lead_capture?.enabled !== false,
        agentMessages: [],
        channelNote,
        ...handoffPrompt(bot),
        scopeLock,
        businessTopics: bot.business_topics,
        gateChannel: scopeLock ? (opts.channel as "whatsapp" | "instagram") : null,
        gateNotes: gated.gateNotes,
      });
      const r = await generateText({
        model: chatModel(opts.model),
        system,
        allowSystemInMessages: true,
        messages: [
          ...(opts.history ?? []).map((content, i) => ({ role: i % 2 === 0 ? ("user" as const) : ("assistant" as const), content })),
          { role: "user" as const, content: question },
          ...(scopeLock ? [{ role: "system" as const, content: scopeReminder(bot.client_name, gated.reminder) }] : []),
        ],
        temperature: opts.temperature ?? CHAT_TEMPERATURE,
        stopWhen: stepCountIs(3),
        maxRetries: 6,
        // mesmas ferramentas do chat, sem efeito (nada é gravado nem avisado)
        tools: chatTools({
          registrar_lead: noop,
          chamar_atendente: async ({ urgente }) => {
            if (urgente) urgent = true;
            return { ok: true, aviso: urgente ? RISK_TEXT : handoffNotice(bot.human_handoff?.hours) };
          },
          registrar_pergunta_sem_resposta: noop,
          registrar_recusa: noop,
          pedir_confirmacao_18: noop,
        }),
      });
      const tools = r.steps.flatMap((s) => s.toolCalls.map((c) => c.toolName));
      // o que o contato recebe no WhatsApp e no Instagram: a pergunta fixa de 18+ no lugar da
      // resposta; o texto fixo de risco garantido; o aviso do item proibido antes da resposta
      if (scopeLock && age === null && tools.includes("pedir_confirmacao_18")) return { verdict: "pediu_18", text: GATE_TEXTS.ageQuestion, tools, inputTokens: r.totalUsage?.inputTokens ?? 0, outputTokens: r.totalUsage?.outputTokens ?? 0 };
      let text = scopeLock ? withRiskText(r.text, urgent) : r.text;
      if (entrance?.kind === "ia" && entrance.prefix) text = `${entrance.prefix}\n\n${text}`;
      return { verdict: verdictOf(text, tools.filter((t) => t !== "pedir_confirmacao_18")), text, tools, inputTokens: r.totalUsage?.inputTokens ?? 0, outputTokens: r.totalUsage?.outputTokens ?? 0 };
    } catch (e) {
      return { verdict: "erro", text: (e as Error).message, tools: [], inputTokens: 0, outputTokens: 0 };
    }
  };

  const runs: EvalRun[] = [];
  const n = Math.min(Math.max(opts.runs, 1), 20);
  for (let i = 0; i < n; i += 5) runs.push(...(await Promise.all(Array.from({ length: Math.min(5, n - i) }, one))));

  const count = (v: EvalRun["verdict"]) => runs.filter((r) => r.verdict === v).length;
  return {
    question,
    model: opts.model ?? `${chatModelId()} (padrão)`,
    temperature: opts.temperature ?? CHAT_TEMPERATURE,
    channel: opts.channel ?? "widget",
    age,
    summary: {
      runs: runs.length,
      respondeu: count("respondeu"),
      nao_tenho: count("nao_tenho"),
      so_registrou: count("so_registrou"),
      recusou: count("recusou"),
      barrou: count("barrou"),
      pediu_18: count("pediu_18"),
      erro: count("erro"),
      chamou_atendente: runs.filter((r) => r.tools.includes("chamar_atendente")).length,
    },
    hits: hits.map((h) => ({ similarity: Math.round(h.similarity * 1000) / 1000, title: h.metadata?.title, preview: h.content.slice(0, 160).replace(/\s+/g, " ") })),
    contextChars: context.length,
    // texto da base que chegou ao modelo (o conjunto fixo confere se preço e prazo vieram dela)
    context,
    runs,
  };
}

/** Relatório em texto, para ler direto no navegador. */
export function evalReport(r: Awaited<ReturnType<typeof evaluateQuestion>>): string {
  const s = r.summary;
  const pct = (n: number) => `${Math.round((n / s.runs) * 100)}%`;
  return [
    `PERGUNTA: ${r.question}`,
    `MODELO: ${r.model} · TEMPERATURA: ${r.temperature} · RODADAS: ${s.runs} · CANAL: ${r.channel} · IDADE: ${r.age ?? "não confirmada"}`,
    "",
    `RESPONDEU: ${s.respondeu} (${pct(s.respondeu)}) · "NÃO TENHO": ${s.nao_tenho} (${pct(s.nao_tenho)}) · RECUSOU (escopo): ${s.recusou} (${pct(s.recusou)}) · BARROU (portão): ${s.barrou} · PEDIU 18+: ${s.pediu_18} · SÓ REGISTROU: ${s.so_registrou} · ERRO: ${s.erro} · CHAMOU ATENDENTE: ${s.chamou_atendente}`,
    "",
    `TRECHOS QUE A BUSCA TROUXE (${r.hits.length}, ${r.contextChars} caracteres de contexto):`,
    ...r.hits.map((h, i) => `  [${i + 1}] similaridade ${h.similarity} · ${h.title ?? "-"} · ${h.preview}`),
    "",
    "RESPOSTAS:",
    ...r.runs.map((x, i) => `  ${i + 1}. [${x.verdict}]${x.tools.length ? ` ferramentas: ${x.tools.join(", ")}` : ""}\n     ${x.text.replace(/\n+/g, " / ")}`),
  ].join("\n");
}
