import { describe, expect, it } from "vitest";
import { disconnectNextStep, disconnectionDetail, nameLine, qualityLine, restrictionLines, statusLine } from "../whatsapp-diagnostics";
import { ACCESS_LOST_EVENTS, TOKEN_REJECTED } from "../whatsapp-access";

describe("diagnóstico do número", () => {
  it("nota de qualidade: alta, média e baixa, com o que fazer", () => {
    expect(qualityLine("GREEN")).toMatchObject({ value: "Alta", tone: "ok" });
    expect(qualityLine("YELLOW").tone).toBe("atencao");
    expect(qualityLine("RED")).toMatchObject({ value: "Baixa", tone: "problema" });
    expect(qualityLine("RED").hint).toBeTruthy();
    expect(qualityLine(undefined).tone).toBe("ok");
  });

  it("nome de exibição: aprovado, em análise e recusado", () => {
    expect(nameLine("APPROVED", "Fintra")).toMatchObject({ value: "“Fintra”, aprovado", tone: "ok" });
    expect(nameLine("PENDING_REVIEW", "Fintra").tone).toBe("atencao");
    expect(nameLine("DECLINED", "Loja")).toMatchObject({ tone: "problema" });
    expect(nameLine("DECLINED", "Loja").hint).toMatch(/peça de novo/);
  });

  it("situação na Meta: conectado não aparece; o resto aparece com o próximo passo", () => {
    expect(statusLine("CONNECTED")).toBeNull();
    expect(statusLine(undefined)).toBeNull();
    expect(statusLine("FLAGGED")?.tone).toBe("problema");
    expect(statusLine("ALGO_NOVO")).toMatchObject({ value: "algo_novo", tone: "atencao" });
  });

  it("restrição de conta: tipo e validade (segundos ou data)", () => {
    const [a] = restrictionLines([{ restriction_type: "RESTRICTED_BIZ_INITIATED_MESSAGING", expiration: 1767225600 }]);
    expect(a.value).toBe("não pode iniciar conversas (modelos), até 31/12/2025");
    const [b] = restrictionLines([{ restriction_type: "OUTRA", expiration: "não é data" }]);
    expect(b.value).toBe("outra");
    expect(restrictionLines(undefined)).toEqual([]);
  });

  it("próximo passo depois da desconexão, pelo motivo", () => {
    expect(disconnectNextStep(ACCESS_LOST_EVENTS.ACCOUNT_DELETED, false)).toMatch(/número novo/);
    expect(disconnectNextStep(TOKEN_REJECTED, false)).toMatch(/acesso do BoaVoz/);
    // coexistência: o app parado desconecta o número
    expect(disconnectNextStep(ACCESS_LOST_EVENTS.PARTNER_REMOVED, true)).toMatch(/abrir o app WhatsApp Business/);
    expect(disconnectNextStep(null, false)).toMatch(/link de conexão/);
  });

  it("motivo e quem iniciou a remoção (PARTNER_REMOVED)", () => {
    expect(disconnectionDetail({ reason: "INACTIVITY", initiated_by: "META" })).toBe("motivo informado pela Meta: INACTIVITY, iniciado pela Meta");
    expect(disconnectionDetail({ initiated_by: "BUSINESS" })).toBe("iniciado pelo negócio");
    expect(disconnectionDetail(undefined)).toBeNull();
  });
});
