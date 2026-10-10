import { describe, expect, it } from "vitest";
import { decideMode, measureApplies, SUSPENDED_NOTICE, type ModeFacts } from "../conversation-mode";
import { HUMAN_ONLY_NOTICE } from "../chat";
import { metaMeasureFor } from "../meta-enforcement";

const normal: ModeFacts = {
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

describe("regra única de estado (decideMode)", () => {
  it("sem nada ativo, a IA responde (degrau 6)", () => {
    const m = decideMode(normal);
    expect(m).toMatchObject({ step: 6, state: "normal", aiResponds: true, canSend: true, storeInbound: true, handoff: false, notice: null });
  });

  it("o primeiro degrau que se aplica vence (tudo ligado = ordem da Meta)", () => {
    const all: ModeFacts = { ...normal, metaOrder: true, whatsappDisabled: true, channelDisconnected: true, metaPaymentIssue: true, boavozSuspended: true, humanInConversation: true, botPaused: true, humanOnly: "quota_exceeded" };
    expect(decideMode(all)).toMatchObject({ step: 1, reason: "ordem da Meta", storeInbound: false, canSend: false });
    expect(decideMode({ ...all, metaOrder: false })).toMatchObject({ step: 1, reason: "WhatsApp desligado para todos (BoaVoz)", storeInbound: false });
    expect(decideMode({ ...all, metaOrder: false, whatsappDisabled: false })).toMatchObject({ step: 1, reason: "canal desconectado", storeInbound: true });
    expect(decideMode({ ...all, metaOrder: false, whatsappDisabled: false, channelDisconnected: false })).toMatchObject({ step: 1, reason: "número sem pagamento na Meta" });
    expect(decideMode({ ...all, metaOrder: false, whatsappDisabled: false, channelDisconnected: false, metaPaymentIssue: false })).toMatchObject({ step: 2 });
    expect(decideMode({ ...normal, humanInConversation: true, botPaused: true, humanOnly: "paused" })).toMatchObject({ step: 3 });
    expect(decideMode({ ...normal, botPaused: true, humanOnly: "paused" })).toMatchObject({ step: 4, blockReason: "bot_paused" });
    expect(decideMode({ ...normal, humanOnly: "paused" })).toMatchObject({ step: 5, blockReason: "paused" });
  });

  it("ordem da Meta e desligamento geral só valem no WhatsApp", () => {
    expect(decideMode({ ...normal, channel: "instagram", metaOrder: true, whatsappDisabled: true, metaPaymentIssue: true })).toMatchObject({ step: 6 });
    expect(decideMode({ ...normal, channel: "widget", channelDisconnected: true })).toMatchObject({ step: 6 });
    expect(decideMode({ ...normal, channel: "instagram", channelDisconnected: true })).toMatchObject({ step: 1, canSend: false });
  });

  it("degraus 1 e 2: nada sai e o risco à vida não roda; a suspensão avisa uma vez (menos na coexistência)", () => {
    const suspended = decideMode({ ...normal, boavozSuspended: true });
    expect(suspended).toMatchObject({ step: 2, canSend: false, riskWatch: false, aiResponds: false, storeInbound: true, notice: { reason: "suspenso", text: SUSPENDED_NOTICE } });
    expect(decideMode({ ...normal, boavozSuspended: true, coexistence: true }).notice).toBeNull();
    expect(decideMode({ ...normal, metaPaymentIssue: true })).toMatchObject({ riskWatch: false, notice: null });
  });

  it("degrau 3: gente atendendo, a equipe envia, sem aviso e sem pedido de atendente novo", () => {
    expect(decideMode({ ...normal, humanInConversation: true })).toMatchObject({ aiResponds: false, canSend: true, riskWatch: true, handoff: false, notice: null });
  });

  it("degrau 4: bot pausado avisa só se o dono pediu (e nunca na coexistência)", () => {
    expect(decideMode({ ...normal, botPaused: true })).toMatchObject({ handoff: true, riskWatch: true, notice: null });
    expect(decideMode({ ...normal, botPaused: true, botPauseNotify: true }).notice).toEqual({ reason: "bot_pausado", text: HUMAN_ONLY_NOTICE });
    expect(decideMode({ ...normal, botPaused: true, botPauseNotify: true, coexistence: true }).notice).toBeNull();
  });

  it("degrau 5: modo só humano sempre avisa uma vez (menos na coexistência)", () => {
    expect(decideMode({ ...normal, humanOnly: "trial_expired" })).toMatchObject({ handoff: true, notice: { reason: "so_humano", text: HUMAN_ONLY_NOTICE } });
    expect(decideMode({ ...normal, humanOnly: "trial_expired", coexistence: true }).notice).toBeNull();
  });
});

describe("alcance das medidas", () => {
  const bot = { id: "b1", agency_id: "a1" };
  const m = (x: Partial<Parameters<typeof measureApplies>[0]>) => ({ source: "boavoz", channel: "all", agency_id: "a1", bot_id: null, waba_id: null, ...x });

  it("suspensão da BoaVoz: a agência inteira ou só o chatbot, no canal escolhido", () => {
    expect(measureApplies(m({}), bot, "instagram")).toBe(true);
    expect(measureApplies(m({ channel: "whatsapp" }), bot, "instagram")).toBe(false);
    expect(measureApplies(m({ bot_id: "b2" }), bot, "widget")).toBe(false);
    expect(measureApplies(m({ bot_id: "b1" }), bot, "widget")).toBe(true);
    expect(measureApplies(m({ agency_id: "a2" }), bot, "widget")).toBe(false);
  });

  it("ordem da Meta: só o número da conta (WABA) que a recebeu, nunca a agência inteira", () => {
    const order = m({ source: "meta_order", channel: "whatsapp", waba_id: "w1" });
    expect(measureApplies(order, bot, "whatsapp", "w1")).toBe(true);
    expect(measureApplies(order, bot, "whatsapp", "w2")).toBe(false);
    expect(measureApplies(order, bot, "whatsapp", null)).toBe(false);
  });
});

describe("avisos da Meta (account_update)", () => {
  it("desativação bloqueia; agendada só registra; reativação levanta", () => {
    expect(metaMeasureFor("DISABLED_UPDATE", { ban_info: { waba_ban_state: "DISABLE" } })).toMatchObject({ source: "meta_order", feature: "channel" });
    expect(metaMeasureFor("DISABLED_UPDATE", { ban_info: { waba_ban_state: "SCHEDULE_FOR_DISABLE", waba_ban_date: "2026-10-09" } })).toMatchObject({ source: "meta_order", feature: "outro", reason: "a Meta agendou a desativação da conta para 2026-10-09" });
    expect(metaMeasureFor("DISABLED_UPDATE", { ban_info: { waba_ban_state: "REINSTATE" } })).toBe("reinstate");
  });

  it("infração de bebida ou remédio cai em regulados; as outras ficam só registradas", () => {
    expect(metaMeasureFor("ACCOUNT_VIOLATION", { violation_info: { violation_type: "ALCOHOL" } })).toMatchObject({ source: "meta_violation", feature: "regulados" });
    expect(metaMeasureFor("ACCOUNT_VIOLATION", { violation_info: { violation_type: "DRUGS" } })).toMatchObject({ feature: "regulados" });
    expect(metaMeasureFor("ACCOUNT_VIOLATION", { violation_info: { violation_type: "SCAM" } })).toMatchObject({ feature: "outro" });
  });

  it("restrição vira registro; eventos de acesso e desconhecidos não viram medida", () => {
    expect(metaMeasureFor("ACCOUNT_RESTRICTION", { restriction_info: [{ restriction_type: "RESTRICTED_BIZ_INITIATED_MESSAGING" }] })).toMatchObject({ source: "meta_restriction", feature: "restricao", reason: "restrição da Meta: RESTRICTED_BIZ_INITIATED_MESSAGING" });
    expect(metaMeasureFor("PARTNER_REMOVED", {})).toBeNull();
    expect(metaMeasureFor("DISABLED_UPDATE", {})).toBeNull();
  });
});
