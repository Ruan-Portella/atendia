import { describe, expect, it } from "vitest";
import { consentStateOf, isClosingMessage, offerDue, optInOfferText, typedOptInAnswer } from "../marketing-consent";

const now = Date.parse("2026-10-06T15:00:00Z");
const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString();

describe("oferta de novidades", () => {
  it("texto da oferta diz como parar", () => {
    expect(optInOfferText("Bar do Zé")).toContain("Bar do Zé");
    expect(optInOfferText("Bar do Zé")).toContain("SAIR");
  });

  it("sim e não digitados valem até 24 h depois da oferta", () => {
    expect(typedOptInAnswer("Sim!", hoursAgo(1), now)).toBe("sim");
    expect(typedOptInAnswer("sim, quero", hoursAgo(1), now)).toBe("sim");
    expect(typedOptInAnswer("pode mandar", hoursAgo(1), now)).toBe("sim");
    expect(typedOptInAnswer("Não, obrigado", hoursAgo(1), now)).toBe("nao");
    expect(typedOptInAnswer("nao quero", hoursAgo(1), now)).toBe("nao");
    // depois de 24 h ou sem oferta, é conversa normal
    expect(typedOptInAnswer("sim", hoursAgo(25), now)).toBeNull();
    expect(typedOptInAnswer("sim", null, now)).toBeNull();
    // frase com mais coisa vai para a IA
    expect(typedOptInAnswer("sim, e qual o horário de vocês?", hoursAgo(1), now)).toBeNull();
  });

  it("despedida ou agradecimento curto é o fim natural da conversa", () => {
    for (const t of ["obrigado!", "Muito obrigada", "valeu", "vlw", "ok, obrigado", "beleza, valeu", "tchau", "era só isso, obrigado", "até mais", "obrigado pela ajuda"]) expect(isClosingMessage(t), t).toBe(true);
    for (const t of ["quero uma pizza", "obrigado, e qual o preço da calabresa?", "não", "", "sim"]) expect(isClosingMessage(t), t).toBe(false);
  });

  it("oferece uma vez, só com a opção ligada, sem resposta, sem descadastro e nunca para menor", () => {
    const base = { enabled: true, state: "none" as const, offeredAt: null, suppressed: false, under18: false, leadSaved: true, closing: false };
    expect(offerDue(base)).toBe(true);
    expect(offerDue({ ...base, leadSaved: false, closing: true })).toBe(true);
    expect(offerDue({ ...base, leadSaved: false, closing: false })).toBe(false);
    expect(offerDue({ ...base, enabled: false })).toBe(false);
    expect(offerDue({ ...base, offeredAt: hoursAgo(1) })).toBe(false);
    expect(offerDue({ ...base, state: "declined" })).toBe(false);
    expect(offerDue({ ...base, state: "revoked" })).toBe(false);
    expect(offerDue({ ...base, suppressed: true })).toBe(false);
    expect(offerDue({ ...base, under18: true })).toBe(false);
  });

  it("estado pelo registro mais recente", () => {
    expect(consentStateOf([])).toBe("none");
    expect(consentStateOf([{ granted: true, revoked_at: null }])).toBe("granted");
    expect(consentStateOf([{ granted: true, revoked_at: hoursAgo(1) }])).toBe("revoked");
    expect(consentStateOf([{ granted: false, revoked_at: null }, { granted: true, revoked_at: null }])).toBe("declined");
    // "Foi engano" grava um sim novo por cima do revogado
    expect(consentStateOf([{ granted: true, revoked_at: null }, { granted: true, revoked_at: hoursAgo(2) }])).toBe("granted");
  });
});
