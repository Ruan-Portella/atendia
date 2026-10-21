import { DATA_KIND_LABEL, type RoutineStep } from "./routines";
import { END_REASON_LABEL, type EndReason } from "./routine-run";

/* O roteiro no teste ao vivo, a parte pura (vai também para o navegador): o que a faixa mostra. A leitura fica em routine-test.ts. */

export interface RoutineTestView {
  name: string;
  status: "active" | "completed" | "abandoned";
  endReason: EndReason | null;
  stepIndex: number;
  stepsTotal: number;
  /** "Pedir dado (CPF)", "Botões", "Ação consultar_fatura"… */
  stepLabel: string | null;
  stepText: string | null;
  attempts: number;
  maxAttempts: number;
  failing: boolean;
  collected: string[];
}

/** O tipo do passo, para a faixa. Pura. */
export function stepLabel(s: RoutineStep): string {
  switch (s.type) {
    case "instrucao":
      return "Instrução";
    case "dado":
      return `Pedir dado (${s.kind === "regex" ? "formato próprio" : DATA_KIND_LABEL[s.kind]})`;
    case "botoes":
      return `Botões (${s.options.length} ${s.options.length === 1 ? "opção" : "opções"})`;
    case "acao":
      return `Ação ${s.action || "(sem ação)"}`;
    case "foto":
      return "Pedir foto";
  }
}

/** A faixa: "Fatura · passo 2 de 4" ou "Fatura: concluído". Pura. */
export function routineTestTitle(v: Pick<RoutineTestView, "name" | "status" | "endReason" | "stepIndex" | "stepsTotal">): string {
  if (v.status === "active") return `${v.name} · passo ${v.stepIndex} de ${v.stepsTotal}`;
  if (v.status === "completed") return `${v.name}: concluído`;
  return `${v.name}: encerrado no passo ${v.stepIndex} de ${v.stepsTotal} (${v.endReason ? END_REASON_LABEL[v.endReason] : "encerrado"})`;
}
