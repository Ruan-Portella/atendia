import { generateText, stepCountIs } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSystemPrompt, chatModel, chatModelId } from "./ai";
import { CHAT_TEMPERATURE, channelNoteFor, chatTools, retrieveContext, type BotRow } from "./chat";
import { NO_INFO_PHRASE } from "./unanswered";

/*
 * Avaliação (L1, passo 5): roda a mesma pergunta N vezes contra um bot pelo mesmo caminho do
 * chat (busca, prompt e ferramentas), sem gravar nada, para medir quanto ele responde de fato.
 * Mudança de prompt, temperatura ou modelo só vai para produção medida aqui.
 */

export interface EvalOptions {
  runs: number;
  temperature?: number;
  model?: string;
  channel?: "widget" | "whatsapp" | "instagram";
}

export interface EvalRun {
  verdict: "respondeu" | "nao_tenho" | "so_registrou" | "erro";
  text: string;
  tools: string[];
  inputTokens: number;
  outputTokens: number;
}

const ONLY_REGISTERED = /^(registrei|anotei|deixei registrad)/i;

export function verdictOf(text: string, tools: string[]): EvalRun["verdict"] {
  const t = text.trim();
  if (t.startsWith(NO_INFO_PHRASE)) return "nao_tenho";
  if (ONLY_REGISTERED.test(t) && tools.includes("registrar_pergunta_sem_resposta")) return "so_registrou";
  return "respondeu";
}

export async function evaluateQuestion(db: SupabaseClient, bot: BotRow, question: string, opts: EvalOptions) {
  const { context, hits } = await retrieveContext(db, bot.id, question);
  const channelNote = opts.channel === "whatsapp" ? channelNoteFor({ whatsapp: { waId: "5521999990000" } }) : opts.channel === "instagram" ? channelNoteFor({ instagram: { igsid: "teste" } }) : undefined;
  const system = buildSystemPrompt({ assistantName: bot.name, clientName: bot.client_name, persona: bot.persona ?? {}, context, leadCapture: bot.lead_capture?.enabled !== false, agentMessages: [], channelNote });
  const noop = async () => ({ ok: true });

  const one = async (): Promise<EvalRun> => {
    try {
      const r = await generateText({
        model: chatModel(opts.model),
        system,
        messages: [{ role: "user", content: question }],
        temperature: opts.temperature ?? CHAT_TEMPERATURE,
        stopWhen: stepCountIs(3),
        // mesmas ferramentas do chat, sem efeito (nada é gravado nem avisado)
        tools: chatTools({ registrar_lead: noop, chamar_atendente: noop, registrar_pergunta_sem_resposta: noop }),
      });
      const tools = r.steps.flatMap((s) => s.toolCalls.map((c) => c.toolName));
      return { verdict: verdictOf(r.text, tools), text: r.text, tools, inputTokens: r.totalUsage?.inputTokens ?? 0, outputTokens: r.totalUsage?.outputTokens ?? 0 };
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
    summary: { runs: runs.length, respondeu: count("respondeu"), nao_tenho: count("nao_tenho"), so_registrou: count("so_registrou"), erro: count("erro"), chamou_atendente: runs.filter((r) => r.tools.includes("chamar_atendente")).length },
    hits: hits.map((h) => ({ similarity: Math.round(h.similarity * 1000) / 1000, title: h.metadata?.title, preview: h.content.slice(0, 160).replace(/\s+/g, " ") })),
    contextChars: context.length,
    runs,
  };
}

/** Relatório em texto, para ler direto no navegador. */
export function evalReport(r: Awaited<ReturnType<typeof evaluateQuestion>>): string {
  const s = r.summary;
  const pct = (n: number) => `${Math.round((n / s.runs) * 100)}%`;
  return [
    `PERGUNTA: ${r.question}`,
    `MODELO: ${r.model} · TEMPERATURA: ${r.temperature} · RODADAS: ${s.runs}`,
    "",
    `RESPONDEU: ${s.respondeu} (${pct(s.respondeu)}) · "NÃO TENHO": ${s.nao_tenho} (${pct(s.nao_tenho)}) · SÓ REGISTROU: ${s.so_registrou} · ERRO: ${s.erro} · CHAMOU ATENDENTE: ${s.chamou_atendente}`,
    "",
    `TRECHOS QUE A BUSCA TROUXE (${r.hits.length}, ${r.contextChars} caracteres de contexto):`,
    ...r.hits.map((h, i) => `  [${i + 1}] similaridade ${h.similarity} · ${h.title ?? "-"} · ${h.preview}`),
    "",
    "RESPOSTAS:",
    ...r.runs.map((x, i) => `  ${i + 1}. [${x.verdict}]${x.tools.length ? ` ferramentas: ${x.tools.join(", ")}` : ""}\n     ${x.text.replace(/\n+/g, " / ")}`),
  ].join("\n");
}
