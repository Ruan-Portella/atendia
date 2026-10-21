import type { SupabaseClient } from "@supabase/supabase-js";
import { MAX_ATTEMPTS, type EndReason } from "./routine-run";
import { loadActiveRun } from "./routine-engine";
import { stepLabel, type RoutineTestView } from "./routine-test-view";

/*
 * O roteiro no teste ao vivo (itens menores da conferência de 20/10, parte 5): ao lado do chat de
 * teste do chatbot, o passo em que a conversa está, o que ele pede, as tentativas e os dados que já
 * chegaram (só os nomes: o valor fica na conversa). Depois do fim, como terminou.
 */

/** O roteiro em andamento na conversa de teste ou, sem ele, o último que passou por ela. */
export async function routineTestView(db: SupabaseClient, conversationId: string): Promise<RoutineTestView | null> {
  const run = await loadActiveRun(db, conversationId);
  if (run) {
    const steps = run.routine.steps ?? [];
    const at = Math.max(0, steps.findIndex((s) => s.id === run.stepId));
    const step = steps[at] ?? null;
    return {
      name: run.routine.name,
      status: "active",
      endReason: null,
      stepIndex: at + 1,
      stepsTotal: steps.length,
      stepLabel: step ? stepLabel(step) : null,
      stepText: step?.text ? step.text.slice(0, 300) : null,
      attempts: run.attempts,
      maxAttempts: MAX_ATTEMPTS,
      failing: run.failing,
      collected: Object.keys(run.variables),
    };
  }
  const { data } = await db.from("routine_runs").select("routine_name, status, end_reason, step_index, steps_total").eq("conversation_id", conversationId).neq("status", "active").order("started_at", { ascending: false }).limit(1);
  const last = data?.[0] as { routine_name: string; status: "completed" | "abandoned"; end_reason: EndReason | null; step_index: number; steps_total: number } | undefined;
  if (!last) return null;
  return { name: last.routine_name, status: last.status, endReason: last.end_reason, stepIndex: last.step_index, stepsTotal: last.steps_total, stepLabel: null, stepText: null, attempts: 0, maxAttempts: MAX_ATTEMPTS, failing: false, collected: [] };
}
