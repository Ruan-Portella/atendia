import { describe, expect, it } from "vitest";
import { RISK_TEXT, riskHits } from "../risk";
import { withRiskText } from "../chat";
import { buildSystemPrompt } from "../ai";

describe("risco à vida", () => {
  it("dicionário acusa frases de risco, sem acento e sem diferença de caixa", () => {
    expect(riskHits("Não aguento mais, QUERO MORRER")).toContain("quero morrer");
    expect(riskHits("meu pai desmaiou e não está respirando")).toEqual(expect.arrayContaining(["desmaiou", "nao esta respirando"]));
    expect(riskHits("estou sendo agredida em casa")).toContain("estou sendo agredida");
  });

  it("frase comum de atendimento não acusa", () => {
    expect(riskHits("quero agendar uma consulta")).toEqual([]);
    expect(riskHits("qual o preço?")).toEqual([]);
  });

  it("texto fixo com SAMU, Polícia e CVV, sem prometer resposta rápida", () => {
    expect(RISK_TEXT).toMatch(/192/);
    expect(RISK_TEXT).toMatch(/190/);
    expect(RISK_TEXT).toMatch(/188/);
    expect(RISK_TEXT).not.toMatch(/em breve|rapidamente|já já/i);
  });

  it("o canal garante o texto fixo quando a IA chamou atendente com urgência", () => {
    expect(withRiskText("Sinto muito. Avisei a equipe.", true)).toBe(`Sinto muito. Avisei a equipe.\n\n${RISK_TEXT}`);
    expect(withRiskText("Ligue 188, o CVV atende 24h.", true)).toBe("Ligue 188, o CVV atende 24h.");
    expect(withRiskText("", true)).toBe(RISK_TEXT);
    expect(withRiskText("Olá!", false)).toBe("Olá!");
  });
});

describe("prompt: saúde, risco e portão", () => {
  const base = { assistantName: "Lia", clientName: "Clínica X", persona: {}, context: "", leadCapture: true };

  it("saúde e risco à vida valem em todos os canais", () => {
    const p = buildSystemPrompt(base);
    expect(p).toContain("Saúde (vale para qualquer empresa)");
    expect(p).toContain("urgente=true");
  });

  it("instrução fixa do portão só nos canais da Meta, com os proibidos do arquivo de regras", () => {
    const wa = buildSystemPrompt({ ...base, gateChannel: "whatsapp" });
    expect(wa).toContain("ITENS PROIBIDOS E REGULAMENTADOS");
    expect(wa).toContain("tabaco e cigarro eletrônico");
    expect(wa).toContain("sistemas de votação"); // só no WhatsApp
    expect(wa).toMatch(/Pix/);
    const ig = buildSystemPrompt({ ...base, gateChannel: "instagram" });
    expect(ig).not.toContain("sistemas de votação");
    expect(ig).toContain("não faça atendimento clínico");
    expect(buildSystemPrompt(base)).not.toContain("ITENS PROIBIDOS E REGULAMENTADOS");
  });

  it("site de bot com WhatsApp: nunca mandar pedir item 18+ por lá", () => {
    expect(buildSystemPrompt({ ...base, widgetWithWhatsapp: true })).toMatch(/pelo WhatsApp: indique o site/);
  });
});
