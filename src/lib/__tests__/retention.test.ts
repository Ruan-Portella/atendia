import { describe, expect, it } from "vitest";
import { effectiveRetention, planAgencyRetention, retentionLabel, retentionReduced } from "../retention";

const base = { isDemo: false, sensitiveMode: false, sensitiveDays: 30, clientMonths: null, agencyMonths: null };

describe("prazo efetivo do chatbot", () => {
  it("modo sensível, senão o do cliente, senão o da agência", () => {
    expect(effectiveRetention({ ...base, agencyMonths: 12 })).toEqual({ days: 360, source: "agencia" });
    expect(effectiveRetention({ ...base, agencyMonths: 12, clientMonths: 6 })).toEqual({ days: 180, source: "cliente" });
    expect(effectiveRetention({ ...base, agencyMonths: 12, clientMonths: 24, sensitiveMode: true, sensitiveDays: 15 })).toEqual({ days: 15, source: "sensivel" });
  });

  it("modo sensível fica entre 7 e 90 dias", () => {
    expect(effectiveRetention({ ...base, sensitiveMode: true, sensitiveDays: 3 }).days).toBe(7);
    expect(effectiveRetention({ ...base, sensitiveMode: true, sensitiveDays: 400 }).days).toBe(90);
  });

  it("demonstração: 30 dias; sem prazo nenhum: não apaga", () => {
    expect(effectiveRetention({ ...base, isDemo: true, agencyMonths: 24 })).toEqual({ days: 30, source: "demo" });
    expect(effectiveRetention(base)).toEqual({ days: null, source: "nenhum" });
  });

  it("texto e redução", () => {
    expect(retentionLabel(360)).toBe("12 meses");
    expect(retentionLabel(30)).toBe("30 dias");
    expect(retentionLabel(null)).toBe("sem prazo");
    expect(retentionReduced(null, 360)).toBe(true);
    expect(retentionReduced(360, 180)).toBe(true);
    expect(retentionReduced(180, 360)).toBe(false);
    expect(retentionReduced(360, null)).toBe(false);
  });
});

describe("prazo da agência", () => {
  const now = new Date("2026-10-04T12:00:00Z");
  const in30 = "2026-11-03T12:00:00.000Z";

  it("aumento vale na hora", () => {
    expect(planAgencyRetention({ months: 6, pendingMonths: null, effectiveAt: null }, 12, now)).toEqual({ kind: "aumento", patch: { retention_months: 12, retention_pending_months: null, retention_effective_at: null } });
  });

  it("redução espera 30 dias", () => {
    expect(planAgencyRetention({ months: 24, pendingMonths: null, effectiveAt: null }, 6, now)).toEqual({ kind: "reducao", patch: { retention_pending_months: 6, retention_effective_at: in30 } });
  });

  it("sair do “Não apagar” é redução; a pendência já avisada mantém a data se o prazo não diminuir", () => {
    expect(planAgencyRetention({ months: null, pendingMonths: null, effectiveAt: null }, 12, now)).toEqual({ kind: "reducao", patch: { retention_pending_months: 12, retention_effective_at: in30 } });
    const avisada = { months: null, pendingMonths: 12, effectiveAt: "2026-10-20T00:00:00.000Z" };
    expect(planAgencyRetention(avisada, 12, now)).toEqual({ kind: "sem_mudanca" });
    expect(planAgencyRetention(avisada, 24, now)).toEqual({ kind: "reducao", patch: { retention_pending_months: 24, retention_effective_at: "2026-10-20T00:00:00.000Z" } });
    // menor que o avisado: novo prazo de 30 dias
    expect(planAgencyRetention(avisada, 6, now)).toEqual({ kind: "reducao", patch: { retention_pending_months: 6, retention_effective_at: in30 } });
  });

  it("escolher o prazo atual desfaz a pendência", () => {
    expect(planAgencyRetention({ months: 12, pendingMonths: 6, effectiveAt: in30 }, 12, now)).toEqual({ kind: "desfazer", patch: { retention_months: 12, retention_pending_months: null, retention_effective_at: null } });
    expect(planAgencyRetention({ months: 12, pendingMonths: null, effectiveAt: null }, 12, now)).toEqual({ kind: "sem_mudanca" });
  });
});
