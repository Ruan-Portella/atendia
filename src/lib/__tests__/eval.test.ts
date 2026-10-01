import { describe, expect, it } from "vitest";
import { verdictOf } from "../eval";

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
  });
});
