/*
 * "O que a IA fez" (redesenho, etapa 2): os passos de cada resposta da IA na conversa do painel,
 * tirados do que a resposta já grava (as fontes da base e as ferramentas chamadas, em
 * messages.tool_results) e da mensagem do contato antes dela (foto, áudio). Não é o raciocínio do
 * modelo: é o que ele consultou e fez. Sem custo de IA. Puro.
 */

export type TraceKind = "photo" | "audio" | "base" | "action" | "handoff" | "lead" | "question" | "refusal" | "age" | "options" | "link" | "phone" | "routine" | "context" | "memory" | "tool";

export interface TraceStep {
  kind: TraceKind;
  title: string;
  detail?: string;
  /** false: a ferramenta recusou ou falhou (o passo aparece apagado) */
  ok: boolean;
}

export interface AiTrace {
  steps: TraceStep[];
  /** quanto a resposta levou desde a mensagem do contato, em segundos (null sem ela) */
  seconds: number | null;
}

interface ToolRow {
  name?: string;
  input?: unknown;
  output?: unknown;
}

/** O que fica gravado dos parâmetros das ferramentas que não são ação: só o que explica o passo. */
export const TRACE_INPUT: Record<string, readonly string[]> = {
  chamar_atendente: ["setor", "urgente", "motivo"],
  registrar_lead: ["interesse"],
  registrar_pergunta_sem_resposta: ["pergunta"],
  registrar_recusa: ["nivel"],
  mostrar_opcoes: ["opcoes"],
  mostrar_link: ["rotulo"],
  iniciar_roteiro: ["nome"],
  trocar_contexto: ["conta"],
};

/** Os parâmetros que ficam para o passo (os outros saem antes de gravar). */
export function traceInput(name: string, input: unknown): Record<string, unknown> | null {
  const keys = TRACE_INPUT[name];
  if (!keys || !input || typeof input !== "object") return null;
  const out = Object.fromEntries(keys.flatMap((k) => ((input as Record<string, unknown>)[k] === undefined ? [] : [[k, (input as Record<string, unknown>)[k]]])));
  return Object.keys(out).length ? out : null;
}

const clip = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" || typeof v === "boolean" ? String(v) : "");
const humanize = (name: string) => name.replace(/^acao_/, "").replace(/_/g, " ");

function paramsText(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  return Object.entries(input as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");
}

function stepOf(t: ToolRow): TraceStep | null {
  const name = t.name ?? "";
  const out = (t.output ?? null) as { ok?: boolean; motivo?: string; confirmacao?: string; confirmada?: boolean } | null;
  const failed = out?.ok === false;
  const input = (t.input ?? {}) as Record<string, unknown>;
  if (name.startsWith("acao_")) {
    const how = out?.confirmacao === "enviada" ? "mandou o resumo com Confirmar" : out?.confirmada ? "feita depois do Confirmar" : failed ? `não deu${out?.motivo ? `: ${out.motivo}` : ""}` : "deu certo";
    return { kind: "action", title: `Usou a ação “${humanize(name)}”`, detail: clip([paramsText(t.input), how].filter(Boolean).join(" · "), 140), ok: !failed };
  }
  switch (name) {
    case "chamar_atendente": {
      const setor = str(input.setor);
      return { kind: "handoff", title: setor ? `Chamou o setor ${setor}` : "Chamou a equipe", detail: [input.urgente === true ? "urgente" : "", clip(str(input.motivo))].filter(Boolean).join(" · ") || undefined, ok: !failed };
    }
    case "registrar_lead":
      return { kind: "lead", title: "Registrou o contato para a equipe retornar", detail: str(input.interesse) ? clip(str(input.interesse)) : undefined, ok: !failed };
    case "registrar_pergunta_sem_resposta":
      return { kind: "question", title: "Anotou uma pergunta que a base não responde", detail: str(input.pergunta) ? `“${clip(str(input.pergunta))}”` : "vai para Perguntas sem resposta", ok: !failed };
    case "registrar_recusa":
      return { kind: "refusal", title: "Recusou um pedido fora do assunto", detail: input.nivel === "fixo" ? "fora do que a empresa atende" : input.nivel === "flexivel" ? "assunto distante do negócio" : undefined, ok: true };
    case "pedir_confirmacao_18":
      return { kind: "age", title: failed ? "Ia pedir a confirmação de 18+" : "Pediu a confirmação de 18+", detail: failed ? "não precisou" : "botões Sim e Não", ok: !failed };
    case "mostrar_opcoes": {
      const opcoes = Array.isArray(input.opcoes) ? (input.opcoes as unknown[]).map(str).filter(Boolean) : [];
      return { kind: "options", title: failed ? "Ia mostrar opções" : "Mostrou opções para tocar", detail: opcoes.length ? clip(opcoes.join(" · "), 120) : undefined, ok: !failed };
    }
    case "mostrar_link":
      return { kind: "link", title: failed ? "Ia mostrar um link" : "Mostrou um botão com link", detail: str(input.rotulo) || undefined, ok: !failed };
    case "pedir_telefone":
      return { kind: "phone", title: "Pediu o telefone pelo botão do WhatsApp", ok: !failed };
    case "iniciar_roteiro":
      return { kind: "routine", title: str(input.nome) ? `Começou o roteiro ${str(input.nome)}` : "Começou um roteiro", ok: !failed };
    case "concluir_passo":
      return { kind: "routine", title: "Concluiu um passo do roteiro", ok: !failed };
    case "informar_dado":
      return { kind: "routine", title: failed ? "O dado do roteiro não conferiu" : "Conferiu um dado do roteiro", ok: !failed };
    case "cancelar_roteiro":
      return { kind: "routine", title: "Cancelou o roteiro", ok: !failed };
    case "trocar_contexto":
      return { kind: "context", title: str(input.conta) ? `Trocou para a conta ${str(input.conta)}` : "Trocou a conta da conversa", ok: !failed };
    case "esquecer_memoria":
      return { kind: "memory", title: "Esqueceu o que lembrava desta pessoa", detail: "a pedido dela", ok: !failed };
    default:
      return name ? { kind: "tool", title: `Usou ${humanize(name)}`, ok: !failed } : null;
  }
}

/**
 * Os passos de uma resposta da IA, na ordem: o que leu do contato (foto, áudio), o que buscou na
 * base e as ferramentas, na ordem em que chamou. Resposta sem nada disso: "Respondeu pela conversa".
 */
export function aiTrace(o: {
  message: { sources?: unknown; tool_results?: unknown; created_at?: string | null };
  /** a mensagem do contato logo antes (null quando a IA começou, ex.: o primeiro oi) */
  before?: { content?: string | null; created_at?: string | null; hasPhoto?: boolean } | null;
}): AiTrace {
  const steps: TraceStep[] = [];
  const b = o.before;
  if (b?.hasPhoto) steps.push({ kind: "photo", title: "Leu a foto que a pessoa mandou", ok: true });
  if (b?.content?.startsWith("🎤")) steps.push({ kind: "audio", title: "Ouviu o áudio", detail: "transcrito antes de responder", ok: true });
  const sources = Array.isArray(o.message.sources) ? (o.message.sources as Array<{ title?: string; url?: string }>) : [];
  const names = [...new Set(sources.map((s) => (s.title || s.url || "").trim()).filter(Boolean))];
  if (names.length) steps.push({ kind: "base", title: "Procurou na base de conhecimento", detail: clip(names.slice(0, 2).join(" · ") + (names.length > 2 ? ` e mais ${names.length - 2}` : ""), 120), ok: true });
  const tools = Array.isArray(o.message.tool_results) ? (o.message.tool_results as ToolRow[]) : [];
  for (const t of tools) {
    const s = stepOf(t);
    if (s) steps.push(s);
  }
  if (!steps.length) steps.push({ kind: "base", title: "Respondeu pela conversa", detail: "sem precisar buscar na base", ok: true });
  const from = b?.created_at ? Date.parse(b.created_at) : NaN;
  const to = o.message.created_at ? Date.parse(o.message.created_at) : NaN;
  const seconds = Number.isFinite(from) && Number.isFinite(to) && to >= from ? Math.round((to - from) / 1000) : null;
  return { steps, seconds };
}

/** "4 s", "1 min 12 s". Pura. */
export function durationLabel(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m} min ${s} s` : `${m} min`;
}
