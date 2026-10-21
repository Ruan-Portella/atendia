import { describe, expect, it } from "vitest";
import {
  ROUTINE_TEMPLATES,
  STEPS_PER_ROUTINE,
  defaultResults,
  destinationLabel,
  normalizeKeyword,
  parseKeywords,
  routineInputFromJson,
  routineProblem,
  routinesSummary,
  routineUsesActions,
  templateFor,
  type Destination,
  type RoutineContext,
  type RoutineInput,
  type RoutineStep,
} from "../routines";
import { analysisPrompt } from "../bot-analysis";

const ctx = (over: Partial<RoutineContext> = {}): RoutineContext => ({ actions: [], others: [], integrations: false, ...over });
const step = (over: Partial<RoutineStep> & { type?: RoutineStep["type"] } = {}): RoutineStep => ({ id: "passo001", type: "instrucao", text: "Pergunte o que a pessoa precisa.", next: { to: "proximo" }, ...over }) as RoutineStep;
const routine = (over: Partial<RoutineInput> = {}): RoutineInput => ({ name: "Orçamento", when_to_use: "O cliente pede orçamento de um serviço.", keywords: [], steps: [step()], active: true, template: null, ...over });

describe("roteiros: leitura do editor", () => {
  it("monta o roteiro a partir do JSON e descarta o que não existe", () => {
    const r = routineInputFromJson(
      JSON.stringify({
        name: "  Segunda   via ",
        when_to_use: "Pede segunda via de boleto",
        keywords: ["2VIA", "Segunda Via", "2via"],
        extra: "x",
        steps: [{ id: "abc12345", type: "dado", text: "Peça o CPF", kind: "cpf", variable: "cpf", pattern: "ignorado", next: { to: "passo", step: "zzz" }, lixo: 1 }],
      }),
    );
    expect(r).toEqual({
      name: "Segunda via",
      when_to_use: "Pede segunda via de boleto",
      keywords: ["2via", "segunda via"],
      steps: [{ id: "abc12345", type: "dado", text: "Peça o CPF", kind: "cpf", variable: "cpf", pattern: null, next: { to: "passo", step: "zzz" } }],
      active: true,
      template: null,
      handoff_sector: null,
    });
  });

  it("recusa JSON quebrado, tipo de passo desconhecido e roteiro grande demais", () => {
    expect(routineInputFromJson("{")).toEqual({ error: expect.stringMatching(/Não foi possível ler/) });
    expect(routineInputFromJson(JSON.stringify({ steps: [{ id: "abc12345", type: "voar", text: "x" }] }))).toEqual({ error: "Tipo de passo desconhecido." });
    expect(routineInputFromJson("x".repeat(30_001))).toEqual({ error: expect.stringMatching(/grande demais/) });
  });

  it("palavra-chave: minúsculas, sem acento nem pontuação", () => {
    expect(normalizeKeyword("  Devolução! ")).toBe("devolucao");
    expect(normalizeKeyword("2ª-VIA")).toBe("2a via");
    expect(parseKeywords("QUERO, quero; Orçamento\nORCAMENTO")).toEqual(["quero", "orcamento"]);
  });
});

describe("roteiros: conferência antes de salvar", () => {
  it("um roteiro simples passa", () => {
    expect(routineProblem(routine(), ctx())).toBeNull();
  });

  it("nome, quando usar e nome repetido", () => {
    expect(routineProblem(routine({ name: "A" }), ctx())).toMatch(/nome do roteiro/);
    expect(routineProblem(routine({ when_to_use: "curto" }), ctx())).toMatch(/Quando usar/);
    expect(routineProblem(routine(), ctx({ others: [{ id: "x", name: "orçamento", keywords: [] }] }))).toMatch(/Já existe um roteiro/);
  });

  it("palavras-chave: reservadas, só números, repetidas em outro roteiro e limite", () => {
    expect(routineProblem(routine({ keywords: ["sair"] }), ctx())).toMatch(/não pode ser palavra-chave/);
    expect(routineProblem(routine({ keywords: ["sim"] }), ctx())).toMatch(/não pode ser palavra-chave/);
    expect(routineProblem(routine({ keywords: ["123"] }), ctx())).toMatch(/só números/);
    expect(routineProblem(routine({ keywords: ["quero"] }), ctx({ others: [{ id: "x", name: "Promo", keywords: ["quero"] }] }))).toMatch(/já começa o roteiro "Promo"/);
    expect(routineProblem(routine({ keywords: ["a1", "b2", "c3", "d4", "e5", "f6"] }), ctx())).toMatch(/Até 5/);
    expect(routineProblem(routine({ keywords: ["uma duas tres quatro"] }), ctx())).toMatch(/até 3 palavras/);
  });

  it("passos: quantidade, id e texto", () => {
    expect(routineProblem(routine({ steps: [] }), ctx())).toMatch(/pelo menos um passo/);
    const many = Array.from({ length: STEPS_PER_ROUTINE + 1 }, (_, i) => step({ id: `passo${String(i).padStart(3, "0")}` }));
    expect(routineProblem(routine({ steps: many }), ctx())).toMatch(/Até 12 passos/);
    expect(routineProblem(routine({ steps: [step(), step()] }), ctx())).toMatch(/identificador inválido/);
    expect(routineProblem(routine({ steps: [step({ text: "oi" })] }), ctx())).toMatch(/de 3 a 500/);
  });

  it("pedir um dado: variável, senha e regex", () => {
    const dado = (over: Record<string, unknown>) => step({ type: "dado", kind: "cpf", variable: "cpf", pattern: null, ...over } as Partial<RoutineStep>);
    expect(routineProblem(routine({ steps: [dado({})] }), ctx())).toBeNull();
    expect(routineProblem(routine({ steps: [dado({ variable: "Meu CPF" })] }), ctx())).toMatch(/nome da variável/);
    expect(routineProblem(routine({ steps: [dado({}), dado({ id: "passo002" })] }), ctx())).toMatch(/já é usada/);
    expect(routineProblem(routine({ steps: [dado({ text: "Peça a senha do aplicativo" })] }), ctx())).toMatch(/nunca pede senha/);
    expect(routineProblem(routine({ steps: [dado({ kind: "regex", pattern: null, variable: "codigo" })] }), ctx())).toMatch(/escreva a regex/);
    expect(routineProblem(routine({ steps: [dado({ kind: "regex", pattern: "([a-z", variable: "codigo" })] }), ctx())).toMatch(/não é válida/);
    expect(routineProblem(routine({ steps: [dado({ kind: "regex", pattern: "[0-9 ]{13,19}", variable: "codigo" })] }), ctx())).toMatch(/aceita número de cartão/);
    expect(routineProblem(routine({ steps: [dado({ kind: "regex", pattern: "[A-Za-z0-9-]{4,20}", variable: "pedido" })] }), ctx())).toBeNull();
  });

  it("botões: quantidade, tamanho, repetidos e destino", () => {
    const botoes = (options: Array<{ title: string; next: Destination }>) => step({ type: "botoes", variable: null, options } as Partial<RoutineStep>);
    expect(routineProblem(routine({ steps: [botoes([{ title: "Sim", next: { to: "proximo" } }])] }), ctx())).toMatch(/de 2 a 10 botões/);
    expect(routineProblem(routine({ steps: [botoes([{ title: "Sim", next: { to: "proximo" } }, { title: "x".repeat(21), next: { to: "proximo" } }])] }), ctx())).toMatch(/de 1 a 20 caracteres/);
    expect(routineProblem(routine({ steps: [botoes([{ title: "Sim", next: { to: "proximo" } }, { title: "SIM", next: { to: "atendente" } }])] }), ctx())).toMatch(/mesmo texto/);
    expect(routineProblem(routine({ steps: [botoes([{ title: "Sim", next: { to: "proximo" } }, { title: "Não", next: { to: "passo", step: "naoexiste" } }])] }), ctx())).toMatch(/não existe mais/);
    // botão pode repetir o próprio passo ("Tentar de novo")
    expect(routineProblem(routine({ steps: [botoes([{ title: "De novo", next: { to: "passo", step: "passo001" } }, { title: "Equipe", next: { to: "atendente" } }])] }), ctx())).toBeNull();
  });

  it("instrução não volta para ela mesma", () => {
    expect(routineProblem(routine({ steps: [step({ next: { to: "passo", step: "passo001" } })] }), ctx())).toMatch(/próprio passo/);
  });

  it("ação: pacote, ação existente, resultados declarados e linhas fixas", () => {
    const acao = (over: Record<string, unknown> = {}) => step({ type: "acao", action: "buscar_unidades", results: defaultResults(), ...over } as Partial<RoutineStep>);
    const withAction = ctx({ integrations: true, actions: [{ name: "buscar_unidades", outcomes: ["sem_debito"] }] });
    expect(routineProblem(routine({ steps: [acao()] }), ctx({ actions: withAction.actions }))).toMatch(/pacote Integrações/);
    expect(routineProblem(routine({ steps: [acao({ action: "outra" })] }), withAction)).toMatch(/escolha uma ação/);
    expect(routineProblem(routine({ steps: [acao()] }), withAction)).toBeNull();
    expect(routineProblem(routine({ steps: [acao({ results: { ...defaultResults(), sem_debito: { to: "encerrar" } } })] }), withAction)).toBeNull();
    expect(routineProblem(routine({ steps: [acao({ results: { ...defaultResults(), inventado: { to: "encerrar" } } })] }), withAction)).toMatch(/não declara o resultado "inventado"/);
    expect(routineProblem(routine({ steps: [acao({ results: { ok: { to: "proximo" }, erro: { to: "atendente" } } })] }), withAction)).toMatch(/não encontrou/);
    expect(routineProblem(routine({ steps: [acao({ results: { ...defaultResults(), erro: { to: "passo", step: "passo001" } } })] }), withAction)).toMatch(/próprio passo/);
  });

  it("recusa pedido de cartão, conta bancária e código de verificação; aceita conta de luz e senha do wi-fi", () => {
    expect(routineProblem(routine({ steps: [step({ text: "Peça o número do cartão para pagar" })] }), ctx())).toMatch(/política do WhatsApp/);
    expect(routineProblem(routine({ steps: [step({ text: "Peça a agência e a conta bancária" })] }), ctx())).toMatch(/política do WhatsApp/);
    expect(routineProblem(routine({ steps: [step({ text: "Peça o código que chegou por SMS" })] }), ctx())).toMatch(/política do WhatsApp/);
    expect(routineProblem(routine({ steps: [step({ text: "Peça o número da conta de luz que está no boleto" })] }), ctx())).toBeNull();
    expect(routineProblem(routine({ steps: [step({ text: "Diga que a senha do wi-fi é cafe123" })] }), ctx())).toBeNull();
  });
});

describe("roteiros: modelos prontos", () => {
  const actionFor = (hint?: string) => (hint ? [{ name: hint, outcomes: [] }] : []);

  it("são os 5 decididos e passam na conferência (com a ação, quando têm passo de ação)", () => {
    expect(ROUTINE_TEMPLATES.map((t) => t.id)).toEqual(["orcamento", "agendamento", "troca", "segunda_via", "rastreio"]);
    for (const t of ROUTINE_TEMPLATES) {
      const actions = actionFor(t.actionHint);
      const r = templateFor(t.id, actions);
      expect(routineProblem(r, ctx({ actions, integrations: Boolean(t.actionHint) })), t.id).toBeNull();
      expect(routineUsesActions(r), t.id).toBe(Boolean(t.actionHint));
    }
  });

  it("sem a ação, o modelo com passo de ação pede para escolher", () => {
    const r = templateFor("segunda_via", []);
    expect(r.steps[1]).toMatchObject({ type: "acao", action: "" });
    expect(routineProblem(r, ctx({ integrations: true }))).toMatch(/escolha uma ação/);
  });

  it("escolhe a única ação do chatbot e acrescenta os resultados que ela declara", () => {
    const r = templateFor("rastreio", [{ name: "consultar_pedido", outcomes: ["cancelado"] }]);
    const s = r.steps.find((x) => x.type === "acao") as Extract<RoutineStep, { type: "acao" }>;
    expect(s.action).toBe("consultar_pedido");
    expect(s.results.cancelado).toEqual({ to: "atendente" });
    expect(destinationLabel(s.results.nao_encontrado, r.steps)).toBe("passo 3");
  });

  it("modelo não muda o original", () => {
    const a = templateFor("troca", []);
    a.steps[0].text = "mudado";
    expect(templateFor("troca", []).steps[0].text).not.toBe("mudado");
  });
});

describe("roteiros na análise do bot", () => {
  const base = { company: "Loja", instructions: "Atenda bem", topics: "roupas", sources: ["Site"], found: [], sample: "Camisa R$ 50" };

  it("sem roteiro, o texto analisado não muda (o hash continua o mesmo)", () => {
    expect(analysisPrompt({ ...base, routines: "" })).toBe(analysisPrompt(base));
  });

  it("com roteiro, entra o resumo dos passos e dos botões", () => {
    const summary = routinesSummary([templateFor("troca", [])]);
    expect(summary).toMatch(/^Troca e devolução \(quando usar: .+\): 1\. Peça o número do pedido/);
    expect(summary).toContain("[Veio com defeito / Produto errado / Não serviu / Desisti da compra]");
    expect(analysisPrompt({ ...base, routines: summary })).toContain("Roteiros que o assistente segue (escritos pela agência):\nTroca e devolução");
  });
});
