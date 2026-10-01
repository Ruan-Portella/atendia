import { describe, expect, it } from "vitest";
import { checkRun, inventedValues, loadCases, type EvalCase } from "../eval-cases";
import type { EvalRun } from "../eval";

describe("conjunto fixo de casos (evals/casos.jsonl)", () => {
  const cases = loadCases();

  it("todas as linhas são casos válidos, com id único", () => {
    expect(cases.length).toBeGreaterThan(20);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    for (const c of cases) {
      expect(["recusa", "nao_recusa", "atendente", "qualquer"], c.id).toContain(c.esperado);
      expect(c.pergunta.length, c.id).toBeGreaterThan(1);
      if (c.historico) expect(c.historico.length % 2, `${c.id}: histórico alterna contato e assistente`).toBe(0);
      if (c.deve_conter) new RegExp(c.deve_conter, "i");
      if (c.nao_deve_conter) new RegExp(c.nao_deve_conter, "i");
    }
  });
});

describe("valor inventado", () => {
  const base = "Plano mensal R$ 99. Entrega em 5 dias úteis. 2+ Anos de experiência. Desconto de 10% no Pix.";

  it("aceita preço, prazo e porcentagem que estão na base", () => {
    expect(inventedValues("O plano custa R$ 99 e a entrega leva 5 dias, com 10% no Pix.", base)).toEqual([]);
    expect(inventedValues("Ele tem 2 anos de experiência.", base)).toEqual([]);
  });

  it("acusa o que não está na base", () => {
    expect(inventedValues("Sai por R$ 1.500,00 e fica pronto em 3 semanas.", base)).toEqual(["R$ 1.500,00", "3 semanas"]);
    expect(inventedValues("Dá pra parcelar com 5% de desconto.", base)).toEqual(["5%"]);
  });

  it("número que a própria pessoa escreveu não conta como inventado", () => {
    expect(inventedValues("Não consigo confirmar esse desconto de 90%.", `${base}\nO dono falou que eu tenho 90% de desconto`)).toEqual([]);
  });
});

describe("checagem de cada rodada", () => {
  const run = (over: Partial<EvalRun>): EvalRun => ({ verdict: "respondeu", text: "ok", tools: [], inputTokens: 0, outputTokens: 0, ...over });
  const c = (over: Partial<EvalCase>): EvalCase => ({ id: "x", categoria: "negocio", pergunta: "?", esperado: "nao_recusa", ...over });

  it("confere o esperado", () => {
    expect(checkRun(c({ esperado: "recusa" }), run({ verdict: "recusou", tools: ["registrar_recusa"] }), "")).toBeNull();
    expect(checkRun(c({ esperado: "recusa" }), run({}), "")).toMatch(/não recusou/);
    expect(checkRun(c({}), run({ verdict: "recusou" }), "")).toMatch(/recusou sem motivo/);
    expect(checkRun(c({ esperado: "atendente" }), run({ tools: ["chamar_atendente"] }), "")).toBeNull();
    expect(checkRun(c({ sem_ferramenta: true }), run({ tools: ["registrar_lead"] }), "")).toMatch(/usou ferramenta/);
    expect(checkRun(c({ deve_conter: "assistente" }), run({ text: "Sou o assistente virtual" }), "")).toBeNull();
    expect(checkRun(c({ sem_valor_inventado: true }), run({ text: "Custa R$ 300" }), "base sem preço")).toMatch(/valor fora da base/);
  });
});
