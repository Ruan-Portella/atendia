import { describe, expect, it } from "vitest";
import { memoryDb, type MemRow } from "../memory-db";
import { routineTestView } from "../routine-test";
import { routineTestTitle, stepLabel } from "../routine-test-view";
import type { RoutineStep } from "../routines";

/* O passo do roteiro ao lado do teste ao vivo (itens menores da conferência de 20/10, parte 5). */

const steps: RoutineStep[] = [
  { id: "s1", type: "instrucao", text: "Explique que vamos buscar a segunda via.", next: { to: "proximo" } },
  { id: "s2", type: "dado", text: "Peça o CPF do titular da conta.", kind: "cpf", variable: "cpf", pattern: null, next: { to: "proximo" } },
  { id: "s3", type: "botoes", text: "Pergunte o mês.", variable: "mes", options: [{ title: "Este mês", next: { to: "proximo" } }, { title: "Outro", next: { to: "proximo" } }] },
  { id: "s4", type: "acao", text: "Busque a fatura.", action: "buscar_fatura", results: {} },
];

describe("a faixa do roteiro no teste ao vivo", () => {
  it("o tipo do passo e o título", () => {
    expect(steps.map(stepLabel)).toEqual(["Instrução", "Pedir dado (CPF)", "Botões (2 opções)", "Ação buscar_fatura"]);
    expect(routineTestTitle({ name: "Fatura", status: "active", endReason: null, stepIndex: 2, stepsTotal: 4 })).toBe("Fatura · passo 2 de 4");
    expect(routineTestTitle({ name: "Fatura", status: "completed", endReason: null, stepIndex: 4, stepsTotal: 4 })).toBe("Fatura: concluído");
    expect(routineTestTitle({ name: "Fatura", status: "abandoned", endReason: "handoff", stepIndex: 3, stepsTotal: 4 })).toBe("Fatura: encerrado no passo 3 de 4 (foi para a equipe)");
  });

  it("em andamento: o passo atual, o que ele pede e as tentativas; depois do fim, como terminou", async () => {
    const t: Record<string, MemRow[]> = {
      routines: [{ id: "r1", bot_id: "b1", name: "Fatura", steps, active: true, updated_at: "2026-10-21T10:00:00Z" }],
      routine_runs: [{ id: "run1", conversation_id: "c1", bot_id: "b1", routine_id: "r1", routine_name: "Fatura", routine_version: "2026-10-21T10:00:00Z", step_id: "s2", step_index: 2, steps_total: 4, status: "active", attempts: 1, failing: false, variables_enc: null, started_at: "2026-10-21T11:00:00Z", last_contact_at: "2026-10-21T11:00:00Z", updated_at: "2026-10-21T11:00:00Z" }],
    };
    const db = memoryDb(t);
    expect(await routineTestView(db, "c1")).toEqual({ name: "Fatura", status: "active", endReason: null, stepIndex: 2, stepsTotal: 4, stepLabel: "Pedir dado (CPF)", stepText: "Peça o CPF do titular da conta.", attempts: 1, maxAttempts: 3, failing: false, collected: [] });

    t.routine_runs[0].status = "abandoned";
    t.routine_runs[0].end_reason = "handoff";
    t.routine_runs[0].step_index = 3;
    expect(await routineTestView(db, "c1")).toMatchObject({ name: "Fatura", status: "abandoned", endReason: "handoff", stepIndex: 3, stepsTotal: 4, stepLabel: null });
    expect(await routineTestView(db, "outra")).toBeNull();
  });
});
