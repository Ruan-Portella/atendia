import { describe, expect, it } from "vitest";
import { choiceLabel, nextChoice, packChargeCents, packsRemovedWith, planSizeChange, renewalLabel, type CurrentSize } from "../billing";
import { subscriptionDiff } from "../billing-sync";

// dia 16 de outubro, 00:00 em São Paulo: faltam 16 dos 31 dias
const now = new Date("2026-10-16T03:00:00Z");
const P: CurrentSize = { size: "P", volumePacks: null, monthQuota: 160, pendingSize: null, pendingVolumePacks: null };

describe("troca de tamanho com assinatura", () => {
  it("subir: cobra a diferença proporcional e a cota do mês sobe na mesma proporção", () => {
    // (99 − 49) × 16/31 = R$ 25,81; 160 + 180 × 16/31 (92,9 → 93)
    expect(planSizeChange(P, { size: "M", volumePacks: null }, now)).toEqual({ kind: "upgrade", amountCents: 2581, monthQuota: 253 });
  });

  it("subir de quem ganhou o tamanho neste mês: soma à cota proporcional que já tinha", () => {
    expect(planSizeChange({ ...P, monthQuota: 83 }, { size: "M", volumePacks: null }, now)).toEqual({ kind: "upgrade", amountCents: 2581, monthQuota: 176 });
  });

  it("de sem tamanho para P: o mês proporcional", () => {
    expect(planSizeChange({ ...P, size: null, monthQuota: 0 }, { size: "P", volumePacks: null }, now)).toEqual({ kind: "upgrade", amountCents: 2529, monthQuota: 83 });
  });

  it("Volume: mais pacotes é subir", () => {
    const v2: CurrentSize = { size: "volume", volumePacks: 2, monthQuota: 2000, pendingSize: null, pendingVolumePacks: null };
    expect(planSizeChange(v2, { size: "volume", volumePacks: 3 }, now)).toEqual({ kind: "upgrade", amountCents: 15_432, monthQuota: 2517 });
    expect(planSizeChange(v2, { size: "volume", volumePacks: 2 }, now)).toEqual({ kind: "same" });
    expect(planSizeChange(v2, { size: "volume", volumePacks: 1 }, now)).toEqual({ kind: "downgrade" });
  });

  it("descer ou tirar o tamanho: fica para o dia 1º", () => {
    const G: CurrentSize = { ...P, size: "G", monthQuota: 680 };
    expect(planSizeChange(G, { size: "M", volumePacks: null }, now)).toEqual({ kind: "downgrade" });
    expect(planSizeChange(P, { size: null, volumePacks: null }, now)).toEqual({ kind: "downgrade" });
  });

  it("com troca agendada: voltar ao de agora cancela; a mesma troca já está agendada; subir parte do de agora", () => {
    const G: CurrentSize = { size: "G", volumePacks: null, monthQuota: 680, pendingSize: "P", pendingVolumePacks: null };
    expect(planSizeChange(G, { size: "G", volumePacks: null }, now)).toEqual({ kind: "cancel_pending" });
    expect(planSizeChange(G, { size: "P", volumePacks: null }, now)).toEqual({ kind: "already_scheduled" });
    expect(planSizeChange(G, { size: "M", volumePacks: null }, now)).toEqual({ kind: "downgrade" });
    // G → Volume 1: (299 − 199) × 16/31 = R$ 51,61; 680 + 320 × 16/31 (165,2 → 166)
    expect(planSizeChange(G, { size: "volume", volumePacks: 1 }, now)).toEqual({ kind: "upgrade", amountCents: 5161, monthQuota: 846 });
  });

  it("o que vale no mês que vem", () => {
    expect(nextChoice({ size: "G", volumePacks: null, pendingSize: null, pendingVolumePacks: null })).toEqual({ size: "G", volumePacks: null });
    expect(nextChoice({ size: "G", volumePacks: null, pendingSize: "none", pendingVolumePacks: null })).toEqual({ size: null, volumePacks: null });
    expect(nextChoice({ size: "volume", volumePacks: 3, pendingSize: "volume", pendingVolumePacks: 1 })).toEqual({ size: "volume", volumePacks: 1 });
  });

  it("nomes e datas das telas", () => {
    expect(choiceLabel({ size: null, volumePacks: null })).toBe("sem tamanho");
    expect(choiceLabel({ size: "volume", volumePacks: 1 })).toBe("Volume (1 pacote)");
    expect(choiceLabel({ size: "M", volumePacks: null })).toBe("M");
    expect(renewalLabel(now)).toBe("1º de novembro");
    expect(renewalLabel(new Date("2026-12-10T12:00:00Z"))).toBe("1º de janeiro");
  });
});

describe("pacotes com assinatura", () => {
  it("assinar no meio do mês: proporcional; tirar o Integrações tira a Plataforma", () => {
    expect(packChargeCents("integracoes", now)).toBe(2529);
    expect(packsRemovedWith("integracoes")).toEqual(["integracoes", "plataforma"]);
    expect(packsRemovedWith("dominio")).toEqual(["dominio"]);
  });
});

describe("assinatura igual ao que vale no mês que vem", () => {
  const ids = { boavoz_bot_p: "price_p", boavoz_bot_m: "price_m", boavoz_bot_g: "price_g", boavoz_bot_volume: "price_v", boavoz_dominio: "price_dom", boavoz_integracoes: "price_int", boavoz_plataforma: "price_plat", boavoz_excedente: "price_exc" };

  it("muda a quantidade, põe o que falta, tira o que zerou e garante o excedente", () => {
    const current = [
      { id: "si_p", priceId: "price_p", quantity: 2 },
      { id: "si_dom", priceId: "price_dom", quantity: 1 },
    ];
    expect(subscriptionDiff(current, { boavoz_bot_p: 3, boavoz_bot_m: 1 }, ids)).toEqual([
      { id: "si_p", quantity: 3 },
      { price: "price_m", quantity: 1 },
      { id: "si_dom", deleted: true },
      { price: "price_exc" },
    ]);
  });

  it("já igual: nada a mudar", () => {
    const current = [
      { id: "si_p", priceId: "price_p", quantity: 2 },
      { id: "si_exc", priceId: "price_exc", quantity: null },
    ];
    expect(subscriptionDiff(current, { boavoz_bot_p: 2 }, ids)).toEqual([]);
  });
});
