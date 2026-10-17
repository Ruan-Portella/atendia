import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { botOverageEmail, botQuotaEmail, openAtendimento, spikeEmail } from "../atendimentos";
import { creditAlert, creditEmail, parseAutoRecharge, parseCreditBrl, rechargeDecision } from "../billing-credit";
import { overageAlertLevel, overageMax, parseCapBrl, quotaPhase, suggestSize } from "../quota";
import { OVERAGE_PRICE_BRL } from "../plans";

process.env.CONTACT_HASH_KEY ??= "chave-de-teste-com-mais-de-16-caracteres";

describe("excedente: quantos atendimentos a mais cabem no teto", () => {
  it("teto ÷ preço, em centavos, para baixo", () => {
    expect(OVERAGE_PRICE_BRL).toBe(0.35);
    expect(overageMax(100)).toBe(285);
    expect(overageMax(49)).toBe(140);
    expect(overageMax(3.5)).toBe(10);
    expect(overageMax(0.7)).toBe(2);
    expect(overageMax(0.34)).toBe(0);
    expect(overageMax(null)).toBe(0);
    expect(overageMax(0)).toBe(0);
  });

  it("o teto digitado: com ou sem R$, milhar e centavos; fora de R$ 10 a R$ 100.000, não vale", () => {
    expect(parseCapBrl("49")).toBe(49);
    expect(parseCapBrl("49,90")).toBe(49.9);
    expect(parseCapBrl("49.9")).toBe(49.9);
    expect(parseCapBrl("R$ 1.000")).toBe(1000);
    expect(parseCapBrl("1.000,50")).toBe(1000.5);
    expect(parseCapBrl("100.000")).toBe(100000);
    expect(parseCapBrl("100.001")).toBeNull();
    expect(parseCapBrl("5")).toBeNull();
    expect(parseCapBrl("abc")).toBeNull();
    expect(parseCapBrl("")).toBeNull();
    expect(parseCapBrl("49,90,1")).toBeNull();
  });
});

describe("situação do chatbot no mês", () => {
  const b = { quota: 160, used: 0, overageEnabled: false, overageUsed: 0, overageMax: 0 };
  it("dentro da cota, no excedente ou parado", () => {
    expect(quotaPhase({ ...b, used: 100 })).toBe("cota");
    expect(quotaPhase({ ...b, used: 160 })).toBe("parado");
    expect(quotaPhase({ ...b, used: 160, overageEnabled: true, overageMax: 140 })).toBe("excedente");
    expect(quotaPhase({ ...b, used: 160, overageEnabled: true, overageUsed: 139, overageMax: 140 })).toBe("excedente");
    expect(quotaPhase({ ...b, used: 160, overageEnabled: true, overageUsed: 140, overageMax: 140 })).toBe("parado");
  });
  it("sem tamanho (cota zero), o excedente não vale", () => {
    expect(quotaPhase({ ...b, quota: 0, overageEnabled: true, overageMax: 140 })).toBe("parado");
  });
});

describe("avisos do teto do excedente (cada um sai uma vez)", () => {
  it("80%, 95% e o teto", () => {
    expect(overageAlertLevel(112, 140)).toBe(80);
    expect(overageAlertLevel(113, 140)).toBeNull();
    expect(overageAlertLevel(133, 140)).toBe(95);
    expect(overageAlertLevel(140, 140)).toBe("teto");
    expect(overageAlertLevel(228, 285)).toBe(80);
    expect(overageAlertLevel(271, 285)).toBe(95);
    expect(overageAlertLevel(1, 0)).toBeNull();
  });
  it("teto pequeno: os 80% e os 95% caem no teto e não repetem", () => {
    expect(overageAlertLevel(1, 1)).toBe("teto");
    expect(overageAlertLevel(1, 2)).toBeNull();
    expect(overageAlertLevel(2, 2)).toBe("teto");
    // o teto mínimo (R$ 10) dá 28 atendimentos a mais: 80% no 23º, 95% no 27º
    expect(overageMax(10)).toBe(28);
    expect(overageAlertLevel(23, 28)).toBe(80);
    expect(overageAlertLevel(27, 28)).toBe(95);
  });
});

describe("sugestão de tamanho (o excedente pagou mais que o tamanho de cima)", () => {
  it("P com 400 no mês: o M sairia R$ 13 mais barato", () => {
    // P: 49 + 240 × 0,35 = 133; M: 99 + 60 × 0,35 = 120
    expect(suggestSize({ size: "P", volumePacks: null }, 400)).toEqual({ size: "M", volumePacks: null, monthlyBrl: 120, savingBrl: 13 });
  });
  it("P com 300: o excedente ainda sai mais barato, sem sugestão", () => {
    expect(suggestSize({ size: "P", volumePacks: null }, 300)).toBeNull();
    expect(suggestSize({ size: "P", volumePacks: null }, 160)).toBeNull();
    expect(suggestSize({ size: null, volumePacks: null }, 400)).toBeNull();
  });
  it("G com 1.000: o Volume com 1 pacote", () => {
    expect(suggestSize({ size: "G", volumePacks: null }, 1000)).toEqual({ size: "volume", volumePacks: 1, monthlyBrl: 299, savingBrl: 12 });
  });
  it("Volume com 1 pacote e 2.500 no mês: 2 pacotes", () => {
    // 299 + 1.500 × 0,35 = 824; 2 pacotes: 598 + 500 × 0,35 = 773; 3 pacotes: 897
    expect(suggestSize({ size: "volume", volumePacks: 1 }, 2500)).toEqual({ size: "volume", volumePacks: 2, monthlyBrl: 773, savingBrl: 51 });
  });
});

describe("e-mails do excedente", () => {
  const bot = { name: "Zé", clientName: null };
  it("cota cheia com o excedente ligado: avisa que o excedente começou, o preço, o saldo e o teto", () => {
    const [s, l] = botQuotaEmail(100, bot, 160, 160, "outubro de 2026", "https://x/uso", { capBrl: 100, creditCents: 5000 });
    expect(s).toBe("Zé: a cota do mês acabou e o excedente começou");
    const body = l.join(" ");
    expect(body).toMatch(/R\$\s0,35 do crédito da conta \(saldo: R\$\s50,00\)/);
    expect(body).toMatch(/R\$\s100,00/);
    expect(body).toContain("285 atendimentos a mais");
    expect(body).not.toContain("entrou no modo só humano");
    expect(body).not.toContain("fim do mês");
  });
  it("cota cheia, excedente sem teto e sem crédito: pede para comprar", () => {
    const [, l] = botQuotaEmail(100, bot, 160, 160, "outubro de 2026", "https://x/uso", { capBrl: null, creditCents: 20 });
    expect(l.join(" ")).toContain("compre crédito");
    expect(l.join(" ")).not.toContain("teto do mês deste chatbot");
  });
  it("80% da cota com o excedente ligado: não diz que vai parar na cota", () => {
    const [, l] = botQuotaEmail(80, bot, 128, 160, "outubro de 2026", "https://x/uso", { capBrl: 100, creditCents: 5000 });
    expect(l.join(" ")).toContain("O excedente está ligado");
  });
  it("pico no chat do site: suspenso e os dois caminhos", () => {
    const [s, l] = spikeEmail({ name: "Zé", clientName: "Bar" }, "https://x/uso");
    expect(s).toBe("Zé (Bar): pico no chat do site, excedente suspenso");
    expect(l.join(" ")).toContain("tráfego real");
    expect(l.join(" ")).toContain("ataque");
  });
  it("teto: modo só humano e como voltar", () => {
    const [s, l] = botOverageEmail("teto", bot, 285, 100, "outubro de 2026", "https://x/uso");
    expect(s).toBe("Zé: o excedente chegou ao teto");
    expect(l.join(" ")).toContain("modo só humano");
    expect(l.join(" ")).toContain("aumentarem o teto");
  });
  it("80% do teto: o gasto até agora", () => {
    const [s, l] = botOverageEmail(80, { name: "Zé", clientName: "Bar do Zé" }, 228, 100, "outubro de 2026", "https://x/uso");
    expect(s).toBe("Zé (Bar do Zé): 80% do teto do excedente");
    expect(l.join(" ")).toMatch(/R\$\s79,80/);
  });
});

describe("abertura com o excedente", () => {
  function fake(row: Record<string, unknown>) {
    return {
      rpc: vi.fn(async () => ({ data: [row], error: null })),
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
    } as unknown as SupabaseClient;
  }
  const bot = { id: "b1", agency_id: "a1" };
  const o = { channel: "whatsapp" as const, contactKey: "k", conversationId: "c" };

  it("excedente: abre e conta, marcado como atendimento a mais", async () => {
    const r = await openAtendimento(fake({ status: "excedente", atendimento_id: 11, used: 160, quota: 160, overage_on: true, overage_used: 1, overage_max: 285, credit_left: 4965 }), bot, o);
    expect(r).toEqual({ blocked: null, isNew: true, id: 11, overage: true });
  });
  it("teto, sem crédito, suspenso e pico: modo só humano, como a cota cheia", async () => {
    for (const status of ["teto", "sem_credito", "suspenso", "pico"]) {
      const r = await openAtendimento(fake({ status, atendimento_id: null, used: 160, quota: 160, overage_on: true, overage_used: 3, overage_max: null, credit_left: 10 }), bot, o);
      expect(r).toEqual({ blocked: "quota_exceeded", isNew: false, id: null, overage: false });
    }
  });
});

describe("crédito pré-pago do excedente", () => {
  it("valor da compra: reais inteiros, de R$ 50 a R$ 50.000", () => {
    expect(parseCreditBrl("100")).toBe(10_000);
    expect(parseCreditBrl("R$ 1.000")).toBe(100_000);
    expect(parseCreditBrl("250,00")).toBe(25_000);
    expect(parseCreditBrl("49")).toBeNull();
    expect(parseCreditBrl("50.001")).toBeNull();
    expect(parseCreditBrl("99,90")).toBeNull();
    expect(parseCreditBrl("abc")).toBeNull();
  });

  it("aviso de saldo: acabou quando não paga o próximo; baixo ao cruzar 20% da última compra", () => {
    // última compra R$ 100: baixo abaixo de R$ 20
    expect(creditAlert(1990, 10_000)).toBe("baixo"); // 20,25 → 19,90
    expect(creditAlert(1955, 10_000)).toBeNull(); // já estava abaixo
    expect(creditAlert(2025, 10_000)).toBeNull();
    expect(creditAlert(20, 10_000)).toBe("acabou"); // 0,55 → 0,20
    expect(creditAlert(0, 10_000)).toBe("acabou"); // 0,35 → 0
    expect(creditAlert(5000, 0)).toBeNull();
  });

  const auto = { enabled: true, belowCents: 2000, amountCents: 10_000, monthLimitCents: 30_000 };
  it("recarga automática: abaixo do gatilho e dentro do limite do mês; atrasada não recarrega", () => {
    expect(rechargeDecision(auto, "active", 1990, 0)).toBe("charge");
    expect(rechargeDecision(auto, "active", 2000, 0)).toBe("skip");
    expect(rechargeDecision(auto, "active", 1990, 20_000)).toBe("charge");
    expect(rechargeDecision(auto, "active", 1990, 20_001)).toBe("limit");
    expect(rechargeDecision(auto, "past_due", 0, 0)).toBe("skip");
    expect(rechargeDecision({ ...auto, enabled: false }, "active", 0, 0)).toBe("skip");
  });

  it("formulário da recarga: valor mínimo e limite do mês pelo menos uma recarga", () => {
    const fd = (o: Record<string, string>) => {
      const f = new FormData();
      for (const [k, v] of Object.entries(o)) f.set(k, v);
      return f;
    };
    expect(parseAutoRecharge(fd({ auto: "on", below: "20", amount: "100", limit: "300" }))).toEqual({ enabled: true, belowCents: 2000, amountCents: 10_000, monthLimitCents: 30_000 });
    expect("error" in parseAutoRecharge(fd({ auto: "on", below: "20", amount: "40", limit: "300" }))).toBe(true);
    expect("error" in parseAutoRecharge(fd({ auto: "on", below: "20", amount: "100", limit: "50" }))).toBe(true);
    expect(parseAutoRecharge(fd({ below: "", amount: "", limit: "" }))).toEqual({ enabled: false, belowCents: null, amountCents: null, monthLimitCents: null });
  });

  it("e-mails do crédito", () => {
    const o = { balanceCents: 1990, autoOn: false, creditUrl: "https://x/credito" };
    expect(creditEmail("baixo", o)[0]).toMatch(/Crédito do excedente baixo: R\$\s19,90/);
    expect(creditEmail("acabou", o)[1].join(" ")).toContain("modo só humano");
    expect(creditEmail("recarga", { ...o, amountCents: 10_000, autoOn: true })[0]).toMatch(/Recarga automática de R\$\s100,00 feita/);
    expect(creditEmail("recarga_falhou", { ...o, amountCents: 10_000, payUrl: "https://pay", autoOn: true })[1].join(" ")).toContain("https://pay");
    expect(creditEmail("limite", { ...o, autoOn: true })[0]).toBe("Recarga automática parada pelo limite do mês");
  });
});
