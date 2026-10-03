import { describe, expect, it } from "vitest";
import { DEFAULT_AI_NOTICE, NO_DATE_NOTICE, aiNoticeProblem, awayMessageProblem, handoffNotice, renderAiNotice } from "../handoff-hours";

const bot = { name: "Lia", client_name: "Clínica Sorriso" };

describe("aviso de IA editável", () => {
  it("o padrão passa e vira o texto com nome e empresa", () => {
    expect(aiNoticeProblem(DEFAULT_AI_NOTICE)).toBeNull();
    expect(renderAiNotice(null, bot)).toBe("Sou Lia, assistente virtual de Clínica Sorriso.");
    expect(renderAiNotice("Oi! Aqui é a {nome}, a IA da {empresa}.", bot)).toBe("Oi! Aqui é a Lia, a IA da Clínica Sorriso.");
  });

  it("só salva se disser que é assistente virtual", () => {
    expect(aiNoticeProblem("Oi! Aqui é a Lia, da Clínica Sorriso.")).toMatch(/assistente virtual/);
    expect(aiNoticeProblem("Sou a Lia, inteligência artificial da clínica.")).toBeNull();
    expect(aiNoticeProblem("Sou um robô de atendimento.")).toBeNull();
    expect(aiNoticeProblem("")).toBeNull(); // vazio = volta ao padrão
  });

  it("variável desconhecida e texto longo não passam", () => {
    expect(aiNoticeProblem("Sou {nome}, assistente virtual de {loja}.")).toMatch(/\{loja\}/);
    expect(aiNoticeProblem(`assistente virtual ${"x".repeat(300)}`)).toMatch(/300/);
  });
});

describe("mensagem de fora do horário editável", () => {
  const hours = { "1": ["09:00", "18:00"] as [string, string] };
  // domingo, 4 de outubro de 2026, meio-dia em Brasília
  const sunday = new Date("2026-10-04T15:00:00Z");

  it("com horário, precisa dizer quando a equipe volta ({volta})", () => {
    expect(awayMessageProblem("A equipe responde em breve.", true)).toMatch(/\{volta\}/);
    expect(awayMessageProblem("A equipe responde em breve.", false)).toBeNull();
    expect(awayMessageProblem("Voltamos {volta}!", true)).toBeNull();
    expect(awayMessageProblem("Voltamos {quando}!", true)).toMatch(/\{quando\}/);
  });

  it("fora do horário usa o texto editado; sem horário, o texto fixo sem data", () => {
    expect(handoffNotice(hours, sunday, "Voltamos {volta}. Pedido anotado!")).toBe("Voltamos amanhã, das 9h às 18h. Pedido anotado!");
    expect(handoffNotice(hours, sunday)).toBe("Nossa equipe volta amanhã, das 9h às 18h. Deixei seu pedido registrado e respondemos assim que possível.");
    expect(handoffNotice(null, sunday, "Voltamos {volta}.")).toBe(NO_DATE_NOTICE);
  });
});
