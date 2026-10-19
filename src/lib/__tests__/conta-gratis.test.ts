import { describe, expect, it } from "vitest";
import { ATENDIMENTO_TEST_OFF, SIZE_REQUIRED, TEST_ANSWERS_DONE, UNSIZED_API_SENDS, graceEmail } from "../free-account";
import { AI_BOTS_FILTER, BOT_SIZES, TEST_ANSWERS_FREE, UNSIZED_GRACE_DAYS, botHasAi, sizeOption } from "../plans";
import { planSizeChange } from "../billing";
import { suggestSize } from "../quota";
import { UNSIZED_SENDS_REASON } from "../campaigns";
import { decideMode, withoutAi, type ModeFacts } from "../conversation-mode";
import { AI_BLOCK_LABEL } from "../chat";

describe("conta grátis: números e textos (17/10, revistos em 18/10)", () => {
  it("50 respostas de teste e 30 dias de prazo; canal só com tamanho, sem caixa de entrada grátis", () => {
    expect(TEST_ANSWERS_FREE).toBe(50);
    expect(UNSIZED_GRACE_DAYS).toBe(30);
    expect(TEST_ANSWERS_DONE).toContain("50 respostas de teste");
    expect(SIZE_REQUIRED).toContain("precisa de um tamanho");
    expect(SIZE_REQUIRED).toContain("Atendimento (sem IA)");
    expect(UNSIZED_SENDS_REASON).toContain("sem tamanho");
    expect(UNSIZED_API_SENDS).toContain("sem tamanho");
    expect(ATENDIMENTO_TEST_OFF).toContain("sem IA");
  });
});

describe("chatbot com IA (botHasAi)", () => {
  it("só tamanho de IA ou cota sob medida", () => {
    for (const size of ["P", "M", "G", "volume"]) expect(botHasAi({ size, quota_override: null })).toBe(true);
    expect(botHasAi({ size: "atendimento", quota_override: null })).toBe(false);
    expect(botHasAi({ size: null, quota_override: null })).toBe(false);
    expect(botHasAi({})).toBe(false);
    // cota sob medida da BoaVoz: tem IA, com qualquer tamanho
    expect(botHasAi({ size: null, quota_override: 500 })).toBe(true);
    expect(botHasAi({ size: "atendimento", quota_override: 0 })).toBe(true);
    expect(AI_BOTS_FILTER).toBe("size.in.(P,M,G,volume),quota_override.not.is.null");
  });
});

const facts: ModeFacts = {
  channel: "whatsapp",
  channelDisconnected: false,
  metaOrder: false,
  whatsappDisabled: false,
  metaPaymentIssue: false,
  boavozSuspended: false,
  humanInConversation: false,
  apiPaused: false,
  botPaused: false,
  botPauseNotify: false,
  humanOnly: null,
  coexistence: false,
};
const withFacts = (f: ModeFacts) => ({ ...decideMode(f), facts: f });

describe("chatbot sem IA (Atendimento ou sem tamanho): tudo para a equipe", () => {
  it("modo só humano com motivo no_ai, sem aviso ao contato e sem a IA", () => {
    const m = withoutAi(withFacts(facts));
    expect(m).toMatchObject({ step: 5, state: "so_humano", blockReason: "no_ai", handoff: true, aiResponds: false, canSend: true, storeInbound: true, riskWatch: true, notice: null });
    expect(m.facts.humanOnly).toBe("no_ai");
    expect(AI_BLOCK_LABEL.no_ai).toContain("sem IA");
  });

  it("os degraus de antes seguem valendo (canal bloqueado, suspensão, equipe na conversa, bot pausado)", () => {
    expect(withoutAi(withFacts({ ...facts, channelDisconnected: true }))).toMatchObject({ step: 1, canSend: false });
    expect(withoutAi(withFacts({ ...facts, boavozSuspended: true }))).toMatchObject({ step: 2 });
    expect(withoutAi(withFacts({ ...facts, humanInConversation: true }))).toMatchObject({ step: 3, handoff: false });
    expect(withoutAi(withFacts({ ...facts, botPaused: true }))).toMatchObject({ step: 4, blockReason: "bot_paused" });
  });

  it("a IA pausada pela BoaVoz, num chatbot com IA, segue com o aviso ao contato", () => {
    expect(decideMode({ ...facts, humanOnly: "paused" }).notice?.reason).toBe("so_humano");
    expect(decideMode({ ...facts, humanOnly: "paused", coexistence: true }).notice).toBeNull();
  });
});

describe("prazo do chatbot sem tamanho", () => {
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
