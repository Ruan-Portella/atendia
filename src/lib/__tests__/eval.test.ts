import { describe, expect, it } from "vitest";
import { costLine, costSummary, verdictOf, type EvalRun } from "../eval";

describe("classificação das respostas na avaliação", () => {
  it("separa resposta, \"não tenho\" e o \"só registrei\"", () => {
    expect(verdictOf("Ruan é desenvolvedor full stack e trabalhou na Resoluti.", [])).toBe("respondeu");
    expect(verdictOf("Não tenho essa informação. Posso registrar seu contato?", ["registrar_pergunta_sem_resposta"])).toBe("nao_tenho");
    expect(verdictOf("Registrei sua pergunta para que a equipe responda depois.", ["registrar_pergunta_sem_resposta"])).toBe("so_registrou");
    // registrou a parte que faltou, mas respondeu o resto: conta como resposta
    expect(verdictOf("Ruan trabalhou na Resoluti. Não tenho a história completa dele, registrei para a equipe.", ["registrar_pergunta_sem_resposta"])).toBe("respondeu");
    // trava de escopo
    expect(verdictOf("Não consigo fazer sua redação, mas posso te contar sobre os nossos cursos!", ["registrar_recusa"])).toBe("recusou");
    // portão: a IA pediu a confirmação de 18+
    expect(verdictOf("", ["pedir_confirmacao_18"])).toBe("pediu_18");
    // "não tenho" com registrar_recusa junto é lacuna da base (o chat desfaz a recusa)
    expect(verdictOf("Não tenho essa informação sobre o prazo. Posso anotar seu contato?", ["registrar_recusa"])).toBe("nao_tenho");
  });

  it("custo médio por resposta: só o que passou pela IA (texto fixo do portão não conta)", () => {
    const run = (o: Partial<EvalRun>): EvalRun => ({ verdict: "respondeu", text: "", tools: [], inputTokens: 0, outputTokens: 0, ...o });
    const c = costSummary([
      run({ inputTokens: 4000, cachedInputTokens: 3000, outputTokens: 50, costUsd: 0.001 }),
      run({ inputTokens: 2000, cachedInputTokens: 0, outputTokens: 30, costUsd: 0.003 }),
      run({ verdict: "barrou", costUsd: 0 }),
    ]);
    expect(c).toEqual({ respostasIa: 2, entradaMedia: 3000, cachePct: 50, saidaMedia: 40, custoMedioUsd: 0.002 });
    expect(costLine(c)).toContain("US$ 0.00200");
    expect(costLine(costSummary([run({ verdict: "barrou" })]))).toContain("nenhuma resposta passou pela IA");
  });
});
