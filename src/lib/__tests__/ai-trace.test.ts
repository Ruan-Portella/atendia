import { describe, expect, it } from "vitest";
import { aiTrace, durationLabel, traceInput } from "@/lib/ai-trace";

describe("O que a IA fez", () => {
  it("a base, a ação e a equipe, na ordem, com o tempo da resposta", () => {
    const t = aiTrace({
      message: {
        sources: [{ title: "Pagamentos e estornos" }, { title: "Pagamentos e estornos" }, { url: "https://bardoze.com/faq" }],
        tool_results: [
          { name: "acao_buscar_pedido", input: { pedido: "4821" }, output: { ok: true, data: { cobrancas: 2 } } },
          { name: "chamar_atendente", input: { setor: "Financeiro", motivo: "cobrança em dobro" }, output: { ok: true, aviso: "..." } },
        ],
        created_at: "2026-10-22T14:02:04Z",
      },
      before: { content: "Veio cobrado duas vezes", created_at: "2026-10-22T14:02:00Z" },
    });
    expect(t.steps.map((s) => s.title)).toEqual(["Procurou na base de conhecimento", "Usou a ação “buscar pedido”", "Chamou o setor Financeiro"]);
    expect(t.steps[0].detail).toBe("Pagamentos e estornos · https://bardoze.com/faq");
    expect(t.steps[1].detail).toBe("pedido: 4821 · deu certo");
    expect(t.steps[2].detail).toBe("cobrança em dobro");
    expect(t.seconds).toBe(4);
  });

  it("foto e áudio do contato entram antes", () => {
    const t = aiTrace({ message: { tool_results: [{ name: "registrar_lead", input: { interesse: "orçamento" }, output: { ok: true } }] }, before: { content: "🎤 quero um orçamento", hasPhoto: true } });
    expect(t.steps.map((s) => s.kind)).toEqual(["photo", "audio", "lead"]);
    expect(t.steps[2].detail).toBe("orçamento");
  });

  it("ferramenta recusada aparece como não feita", () => {
    const t = aiTrace({ message: { tool_results: [{ name: "mostrar_opcoes", output: { ok: false, instrucao: "x" } }, { name: "acao_emitir_boleto", input: {}, output: { ok: false, motivo: "fora do ar" } }] } });
    expect(t.steps.map((s) => [s.title, s.ok])).toEqual([["Ia mostrar opções", false], ["Usou a ação “emitir boleto”", false]]);
    expect(t.steps[1].detail).toBe("não deu: fora do ar");
  });

  it("resumo com Confirmar e a execução depois", () => {
    const sent = aiTrace({ message: { tool_results: [{ name: "acao_cancelar_pedido", input: { pedido: "9" }, output: { ok: true, confirmacao: "enviada" } }] } });
    expect(sent.steps[0].detail).toBe("pedido: 9 · mandou o resumo com Confirmar");
    const done = aiTrace({ message: { tool_results: [{ name: "acao_cancelar_pedido", input: { pedido: "9" }, output: { ok: true, confirmada: true } }] } });
    expect(done.steps[0].detail).toBe("pedido: 9 · feita depois do Confirmar");
  });

  it("sem base e sem ferramenta: respondeu pela conversa; sem a mensagem antes, sem tempo", () => {
    const t = aiTrace({ message: { sources: null, tool_results: null, created_at: "2026-10-22T14:00:00Z" } });
    expect(t.steps).toEqual([{ kind: "base", title: "Respondeu pela conversa", detail: "sem precisar buscar na base", ok: true }]);
    expect(t.seconds).toBeNull();
  });

  it("roteiro, conta e memória", () => {
    const t = aiTrace({ message: { tool_results: [{ name: "iniciar_roteiro", input: { nome: "Segunda via" }, output: { ok: true } }, { name: "informar_dado", output: { ok: false } }, { name: "trocar_contexto", input: { conta: "Casa" }, output: { ok: true } }, { name: "esquecer_memoria", output: { ok: true } }] } });
    expect(t.steps.map((s) => s.title)).toEqual(["Começou o roteiro Segunda via", "O dado do roteiro não conferiu", "Trocou para a conta Casa", "Esqueceu o que lembrava desta pessoa"]);
  });

  it("guarda só os parâmetros que explicam o passo", () => {
    expect(traceInput("chamar_atendente", { setor: "Financeiro", motivo: "estorno", urgente: false })).toEqual({ setor: "Financeiro", urgente: false, motivo: "estorno" });
    // o lead guarda o interesse, nunca o nome nem o telefone
    expect(traceInput("registrar_lead", { nome: "Ana", whatsapp: "21999990000", interesse: "orçamento" })).toEqual({ interesse: "orçamento" });
    expect(traceInput("registrar_lead", { nome: "Ana" })).toBeNull();
    expect(traceInput("concluir_passo", {})).toBeNull();
    expect(traceInput("acao_x", { a: 1 })).toBeNull();
  });

  it("tempo curto e longo", () => {
    expect(durationLabel(4)).toBe("4 s");
    expect(durationLabel(72)).toBe("1 min 12 s");
    expect(durationLabel(120)).toBe("2 min");
  });
});
