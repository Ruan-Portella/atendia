import { describe, expect, it } from "vitest";
import { allowance, decideSend, nextSendStatus, sendErrorOutcome, templateProblem, tierLimit } from "../campaigns";

const base: Parameters<typeof decideSend>[0] = { templateCategory: "MARKETING", suppressed: [], consent: "granted", regulated: false, age: null, contactGone: false };
const approved = (category: string, components: Array<{ type: string; format?: string; text?: string }> = [{ type: "BODY", text: "Oi {{1}}" }]) => ({ status: "APPROVED", category, components });

describe("campanhas: limite do portfólio", () => {
  it("nível da Meta em contatos únicos por 24 h", () => {
    expect(tierLimit("TIER_250")).toBe(250);
    expect(tierLimit("TIER_1K")).toBe(1000);
    expect(tierLimit("tier_10k")).toBe(10_000);
    expect(tierLimit("TIER_UNLIMITED")).toBe(Number.POSITIVE_INFINITY);
    // sem a informação, o menor nível
    expect(tierLimit(null)).toBe(250);
    expect(tierLimit("TIER_NOVO")).toBe(250);
  });

  it("saldo: o que falta nas 24 h, com o teto do tique", () => {
    expect(allowance({ limit: 250, recent: 0 })).toBe(150);
    expect(allowance({ limit: 250, recent: 200 })).toBe(50);
    expect(allowance({ limit: 250, recent: 300 })).toBe(0);
    expect(allowance({ limit: Number.POSITIVE_INFINITY, recent: 10_000, perTick: 40 })).toBe(40);
  });
});

describe("campanhas: conferência antes de cada envio", () => {
  it("marketing só com o aceite de novidades", () => {
    expect(decideSend(base)).toBe("send");
    expect(decideSend({ ...base, consent: "none" })).toBe("skipped_no_consent");
    expect(decideSend({ ...base, consent: "revoked" })).toBe("skipped_no_consent");
    expect(decideSend({ ...base, consent: "declined" })).toBe("skipped_no_consent");
  });

  it("lembrete de utilidade não pede o aceite de novidades", () => {
    expect(decideSend({ ...base, templateCategory: "UTILITY", consent: "none" })).toBe("send");
  });

  it("SAIR vale pela categoria do modelo", () => {
    expect(decideSend({ ...base, suppressed: ["marketing"] })).toBe("skipped_suppressed");
    expect(decideSend({ ...base, templateCategory: "UTILITY", consent: "none", suppressed: ["marketing"] })).toBe("send");
    expect(decideSend({ ...base, templateCategory: "UTILITY", consent: "none", suppressed: ["utility"] })).toBe("skipped_suppressed");
    expect(decideSend({ ...base, suppressed: ["all"] })).toBe("skipped_suppressed");
  });

  it("bebida ou remédio: só com 18+ confirmado", () => {
    expect(decideSend({ ...base, regulated: true, age: "sim" })).toBe("send");
    expect(decideSend({ ...base, regulated: true, age: null })).toBe("skipped_no_age");
    expect(decideSend({ ...base, regulated: true, age: "nao" })).toBe("skipped_no_age");
  });

  it("contato apagado vem antes de tudo", () => {
    expect(decideSend({ ...base, contactGone: true })).toBe("skipped_contact_deleted");
  });
});

describe("campanhas: erros e status da Meta", () => {
  it("131050 é descadastro; ritmo volta para a fila; o resto é falha", () => {
    expect(sendErrorOutcome(131050)).toBe("opted_out");
    expect(sendErrorOutcome(130429)).toBe("retry");
    expect(sendErrorOutcome(131056)).toBe("retry");
    expect(sendErrorOutcome(131026)).toBe("failed");
    expect(sendErrorOutcome(undefined)).toBe("failed");
  });

  it("status só avança", () => {
    expect(nextSendStatus("sending", "sent")).toBe("sent");
    expect(nextSendStatus("uncertain", "delivered")).toBe("delivered");
    expect(nextSendStatus("sent", "read")).toBe("read");
    expect(nextSendStatus("read", "delivered")).toBeNull();
    expect(nextSendStatus("delivered", "sent")).toBeNull();
    // pulado nas conferências não muda por status (nem deveria ter status)
    expect(nextSendStatus("skipped_no_consent", "sent")).toBeNull();
  });

  it("falha depois do envio: com erro ou descadastro", () => {
    expect(nextSendStatus("sent", "failed", 131026)).toBe("failed");
    expect(nextSendStatus("uncertain", "failed", 131050)).toBe("opted_out");
    expect(nextSendStatus("delivered", "failed")).toBeNull();
  });
});

describe("campanhas: o modelo na hora de enviar", () => {
  it("aprovado e na categoria certa", () => {
    expect(templateProblem("marketing", approved("MARKETING"))).toBeNull();
    expect(templateProblem("utility_reminder", approved("UTILITY"))).toBeNull();
  });

  it("pausa quando some, deixa de estar aprovado ou a Meta reclassifica o lembrete", () => {
    expect(templateProblem("marketing", null)).toMatch(/não existe/);
    expect(templateProblem("marketing", { ...approved("MARKETING"), status: "PAUSED" })).toMatch(/não está aprovado/);
    expect(templateProblem("utility_reminder", approved("MARKETING"))).toMatch(/utilidade para marketing/);
  });

  it("recurso que o BoaVoz ainda não envia", () => {
    expect(templateProblem("marketing", approved("MARKETING", [{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: "Oi" }]))).toMatch(/imagem/);
  });
});
