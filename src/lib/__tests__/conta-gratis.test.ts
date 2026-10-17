import { describe, expect, it } from "vitest";
import { TEST_ANSWERS_DONE, graceEmail, pickFreeInbox, type ConnectedUnsized } from "../free-inbox";
import { BOT_SIZES, FREE_INBOX_CAMPAIGN_SENDS, TEST_ANSWERS_FREE, UNSIZED_GRACE_DAYS, sizeOption } from "../plans";
import { planSizeChange } from "../billing";
import { suggestSize } from "../quota";
import { FREE_INBOX_SENDS_REASON } from "../campaigns";

const bot = (botId: string, connectedAt: string, graceUntil: string | null = null): ConnectedUnsized => ({ botId, name: `Bot ${botId}`, agencyId: "a1", connectedAt, graceUntil });

describe("conta grátis: números da decisão de 17/10", () => {
  it("50 respostas de teste, 100 envios por mês na caixa grátis, 30 dias de prazo", () => {
    expect(TEST_ANSWERS_FREE).toBe(50);
    expect(FREE_INBOX_CAMPAIGN_SENDS).toBe(100);
    expect(UNSIZED_GRACE_DAYS).toBe(30);
    expect(TEST_ANSWERS_DONE).toContain("50 respostas de teste");
    expect(FREE_INBOX_SENDS_REASON).toContain("100 mensagens");
  });
});

describe("caixa de entrada grátis", () => {
  it("fica o chatbot sem tamanho conectado há mais tempo; os outros entram no prazo", () => {
    const { holder, others } = pickFreeInbox([bot("b2", "2026-10-10T10:00:00Z"), bot("b1", "2026-09-01T10:00:00Z"), bot("b3", "2026-10-12T10:00:00Z")]);
    expect(holder?.botId).toBe("b1");
    expect(others.map((b) => b.botId)).toEqual(["b2", "b3"]);
  });

  it("um só: é a caixa grátis, sem prazo; nenhum: ninguém", () => {
    expect(pickFreeInbox([bot("b1", "2026-10-10T10:00:00Z")])).toEqual({ holder: bot("b1", "2026-10-10T10:00:00Z"), others: [] });
    expect(pickFreeInbox([])).toEqual({ holder: null, others: [] });
  });

  it("e-mails do prazo: a data, o que acontece e como manter", () => {
    const [s1, l1] = graceEmail("inicio", "Zé", new Date("2026-11-16T15:00:00Z"), "https://x/cobranca");
    expect(s1).toBe("Zé: sem tamanho, os canais desconectam em 16/11/2026");
    expect(l1.join(" ")).toContain("Atendimento (sem IA)");
    expect(l1.join(" ")).toContain("nada é apagado");
    const [s2, l2] = graceEmail("desconectado", "Zé", null, "https://x/cobranca");
    expect(s2).toBe("Zé: WhatsApp e Instagram desconectados");
    expect(l2.join(" ")).toContain("30 dias sem tamanho");
  });
});

describe("tamanho Atendimento (sem IA)", () => {
  it("nas listas de escolha", () => {
    expect(sizeOption(BOT_SIZES.atendimento)).toMatch(/^Atendimento · R\$\s29,00 · sem IA$/);
    expect(sizeOption(BOT_SIZES.P)).toMatch(/^P · R\$\s49,00 · 160 atendimentos$/);
    expect(sizeOption(BOT_SIZES.P, false)).toMatch(/^P · R\$\s49,00 · 160$/);
    expect(sizeOption(BOT_SIZES.volume)).toMatch(/^Volume · R\$\s299,00 por 1\.000$/);
  });

  it("sem IA não há excedente: nada de sugestão de tamanho", () => {
    expect(suggestSize({ size: "atendimento", volumePacks: null }, 500)).toBeNull();
  });

  it("Atendimento para P: subir, com a diferença proporcional e a cota do P proporcional", () => {
    // dia 16 de outubro: faltam 16 dos 31 dias; (49 − 29) × 16/31 = R$ 10,32; 160 × 16/31 = 83
    const now = new Date("2026-10-16T03:00:00Z");
    expect(planSizeChange({ size: "atendimento", volumePacks: null, monthQuota: 0, pendingSize: null, pendingVolumePacks: null }, { size: "P", volumePacks: null }, now)).toEqual({ kind: "upgrade", amountCents: 1032, monthQuota: 83 });
    // P para Atendimento: descer, no dia 1º
    expect(planSizeChange({ size: "P", volumePacks: null, monthQuota: 160, pendingSize: null, pendingVolumePacks: null }, { size: "atendimento", volumePacks: null }, now)).toEqual({ kind: "downgrade" });
    // sem tamanho para Atendimento: o mês proporcional, sem cota
    expect(planSizeChange({ size: null, volumePacks: null, monthQuota: 0, pendingSize: null, pendingVolumePacks: null }, { size: "atendimento", volumePacks: null }, now)).toEqual({ kind: "upgrade", amountCents: 1497, monthQuota: 0 });
  });
});
