import { describe, expect, it } from "vitest";
import { ATENDIMENTO_TEST_OFF, DEMO_ENDED_PANEL, SIZE_REQUIRED, TEST_ANSWERS_DONE, UNSIZED_API_SENDS, demoEndedText, demosMonthText, unsizedEmail } from "../free-account";
import { domainReleasedEmail } from "../domain-pack";
import { AI_BOTS_FILTER, BOT_SIZES, DEMOS_PER_MONTH, DEMOS_PER_MONTH_FREE, DEMO_ANSWERS, DEMO_ANSWERS_SHOWCASE, DEMO_DAYS, TEST_ANSWERS_FREE, botHasAi, sizeOption } from "../plans";
import { isUnpaidSubscriptionInvoice } from "../billing-view";
import { pastDueEmail } from "../billing-webhook";
import { planSizeChange } from "../billing";
import { suggestSize } from "../quota";
import { UNSIZED_SENDS_REASON } from "../campaigns";
import { decideMode, withoutAi, type ModeFacts } from "../conversation-mode";
import { AI_BLOCK_LABEL } from "../chat";

describe("conta grátis: números e textos (17/10, revistos em 18/10)", () => {
  it("50 respostas de teste; cada demo com 50 respostas e 14 dias; canal só com tamanho, sem caixa de entrada grátis", () => {
    expect(TEST_ANSWERS_FREE).toBe(50);
    // o mesmo número da migração 0102 (use_test_answer e a validade da demo nova)
    expect(DEMO_ANSWERS).toBe(50);
    expect(DEMO_DAYS).toBe(14);
    expect(DEMO_ENDED_PANEL).toContain("14 dias");
    expect(DEMO_ENDED_PANEL).toContain("50 vezes");
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

describe("chatbot sem tamanho: os canais desconectam na hora", () => {
  it("e-mail: o que aconteceu, nada apagado e como voltar", () => {
    const [subject, lines] = unsizedEmail("Zé", "https://x/cobranca");
    expect(subject).toBe("Zé: WhatsApp e Instagram desconectados");
    expect(lines.join(" ")).toContain("ficou sem tamanho");
    expect(lines.join(" ")).toContain("Nada foi apagado");
    expect(lines.join(" ")).toContain("Atendimento, sem IA");
    expect(lines.join(" ")).toContain("https://x/cobranca");
  });
});

describe("demo: para mostrar, não para atender", () => {
  it("o aviso da demo que terminou: vitrine chama para a conta grátis; demo de agência, para a agência", () => {
    expect(demoEndedText("Agência Sol", false)).toBe("Esta demonstração terminou. Para continuar, fale com Agência Sol.");
    expect(demoEndedText(null, false)).toContain("quem enviou o link");
    expect(demoEndedText("BoaVoz", true)).toContain("crie sua conta grátis");
  });

  it("demos por mês: 3 na conta grátis, 20 com assinatura; a da vitrine responde 20 vezes", () => {
    // os mesmos números da migração 0103 (claim_demo e use_test_answer recebem daqui)
    expect(DEMOS_PER_MONTH_FREE).toBe(3);
    expect(DEMOS_PER_MONTH).toBe(20);
    expect(DEMO_ANSWERS_SHOWCASE).toBe(20);
    expect(demosMonthText(false)).toBe("A conta grátis gera até 3 demos por mês. Com assinatura, são até 20.");
    expect(demosMonthText(true)).toContain("as 20 demos deste mês");
    expect(demosMonthText(true)).toContain("volta no dia 1º");
  });
});

describe("domínio próprio sem o pacote", () => {
  it("e-mail: o domínio desligado, para onde tudo voltou e como usar de novo", () => {
    const [subject, lines] = domainReleasedEmail("chat.agencia.com.br", "https://x/painel/marca");
    expect(subject).toBe("Domínio próprio desligado");
    expect(lines.join(" ")).toContain("chat.agencia.com.br foi desligado");
    expect(lines.join(" ")).toContain("domínio do BoaVoz");
    expect(lines.join(" ")).toContain("https://x/painel/marca");
  });
});

describe("pagamento em aberto", () => {
  it("a IA pausa (modo só humano, com o aviso ao contato) e o motivo diz que volta ao pagar", () => {
    const m = decideMode({ ...facts, humanOnly: "past_due" });
    expect(m).toMatchObject({ step: 5, blockReason: "past_due", handoff: true, aiResponds: false, canSend: true });
    expect(m.notice?.reason).toBe("so_humano");
    expect(AI_BLOCK_LABEL.past_due).toContain("pagamento");
    const [subject, lines] = pastDueEmail("https://x/cobranca");
    expect(subject).toBe("Pagamento da assinatura falhou: a IA está pausada");
    expect(lines.join(" ")).toContain("Conversas para a sua equipe responder");
    expect(lines.join(" ")).toContain("2 semanas");
    // chatbot sem IA num atraso: segue sem IA e sem aviso
    expect(withoutAi(withFacts({ ...facts, humanOnly: "past_due" }))).toMatchObject({ blockReason: "no_ai", notice: null });
  });

  it("para assinar de novo: só a fatura da assinatura sem pagamento conta (compra de crédito não)", () => {
    const inv = (status: string, reason: string, remaining: number) => ({ status, billing_reason: reason, amount_remaining: remaining }) as Parameters<typeof isUnpaidSubscriptionInvoice>[0];
    expect(isUnpaidSubscriptionInvoice(inv("open", "subscription_cycle", 4900))).toBe(true);
    expect(isUnpaidSubscriptionInvoice(inv("uncollectible", "subscription_cycle", 4900))).toBe(true);
    expect(isUnpaidSubscriptionInvoice(inv("open", "subscription_create", 2397))).toBe(true);
    expect(isUnpaidSubscriptionInvoice(inv("open", "manual", 5000))).toBe(false);
    expect(isUnpaidSubscriptionInvoice(inv("paid", "subscription_cycle", 0))).toBe(false);
    expect(isUnpaidSubscriptionInvoice(inv("void", "subscription_cycle", 4900))).toBe(false);
    expect(isUnpaidSubscriptionInvoice(inv("open", "subscription_cycle", 0))).toBe(false);
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
