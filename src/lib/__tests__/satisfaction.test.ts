import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.CONTACT_HASH_KEY ??= "chave-de-teste-com-mais-de-16-caracteres";

const sent: Array<{ to: string; text: string; ids: string[] }> = [];
let transportFails = false;
vi.mock("../whatsapp", () => ({
  sendButtons: vi.fn(async (_ch: unknown, to: string, text: string, buttons: Array<{ id: string }>) => {
    if (transportFails) throw new Error("Meta fora do ar");
    sent.push({ to, text, ids: buttons.map((b) => b.id) });
    return { messages: [{ id: "wamid.1" }] };
  }),
}));
// a camada de envio de verdade confere a regra de estado no banco; aqui, só chama o transporte
vi.mock("../send", () => ({
  deliver: vi.fn(async (_db: unknown, o: { transport: () => Promise<string | null> }) => {
    const id = await o.transport();
    return { status: "sent", id, messageId: 1 };
  }),
}));

import { memoryDb, type MemRow } from "../memory-db";
import { SURVEY_TEXT, SURVEY_THANKS, handleSatisfactionReplies, parseSurveyButton, runIdleSurveys, satisfactionSummary, sendSatisfactionSurvey, surveyButtons } from "../satisfaction";

const NOW = Date.parse("2026-10-19T15:00:00.000Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const BOT = "11111111-1111-4111-8111-111111111111";

function tables(over: { bot?: Partial<MemRow>; conv?: Partial<MemRow> } = {}): Record<string, MemRow[]> {
  return {
    bots: [{ id: BOT, satisfaction_survey: true, paused_at: null, status: "live", ...over.bot }],
    conversations: [
      { id: "c1", bot_id: BOT, channel: "whatsapp", wa_id: "5511999990000", ig_id: null, last_contact_at: ago(40), last_reply_at: ago(35), message_count: 6, takeover_at: null, handled_at: null, handoff_requested_at: null, ...over.conv },
    ],
    whatsapp_channels: [{ bot_id: BOT, phone_number_id: "pn1", access_token_enc: null, waba_id: "waba1", disconnected_at: null }],
    instagram_channels: [],
    suppressions: [],
    satisfaction_surveys: [],
  };
}

describe("pesquisa de satisfação", () => {
  beforeEach(() => {
    sent.length = 0;
    transportFails = false;
  });

  it("os botões levam a nota e a pesquisa", () => {
    const id = "22222222-2222-4222-8222-222222222222";
    expect(surveyButtons(id).map((b) => b.title)).toEqual(["Ótimo", "Regular", "Ruim"]);
    expect(parseSurveyButton(surveyButtons(id)[0].id)).toEqual({ score: 3, surveyId: id });
    expect(parseSurveyButton("csat:4:" + id)).toBeNull();
    expect(parseSurveyButton("avs:sim:0123456789ab")).toBeNull();
  });

  it("manda no WhatsApp com os 3 botões e não manda de novo no mesmo dia", async () => {
    const t = tables();
    expect(await sendSatisfactionSurvey(memoryDb(t), { conversationId: "c1", trigger: "equipe", now: NOW })).toBe("sent");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "5511999990000", text: SURVEY_TEXT });
    expect(t.satisfaction_surveys[0]).toMatchObject({ conversation_id: "c1", channel: "whatsapp", trigger: "equipe" });
    expect(await sendSatisfactionSurvey(memoryDb(t), { conversationId: "c1", trigger: "ia", now: NOW + 60_000 })).toBe("skipped");
    expect(sent).toHaveLength(1);
  });

  it("não manda com a pesquisa desligada, fora da janela, para quem pediu para sair, e não fica a linha se o envio falha", async () => {
    expect(await sendSatisfactionSurvey(memoryDb(tables({ bot: { satisfaction_survey: false } })), { conversationId: "c1", trigger: "equipe", now: NOW })).toBe("skipped");
    expect(await sendSatisfactionSurvey(memoryDb(tables({ conv: { last_contact_at: ago(24 * 60) } })), { conversationId: "c1", trigger: "equipe", now: NOW })).toBe("skipped");
    const { contactHash, suppressionScope } = await import("../suppression");
    const t = tables();
    t.suppressions.push({ id: 1, contact_hash: contactHash("whatsapp", "5511999990000"), channel: "whatsapp", scope: suppressionScope({ wabaId: "waba1", botId: BOT }), kind: "all", reason: "sair", revoked_at: null });
    expect(await sendSatisfactionSurvey(memoryDb(t), { conversationId: "c1", trigger: "equipe", now: NOW })).toBe("skipped");
    transportFails = true;
    const t2 = tables();
    expect(await sendSatisfactionSurvey(memoryDb(t2), { conversationId: "c1", trigger: "equipe", now: NOW })).toBe("failed");
    expect(t2.satisfaction_surveys).toHaveLength(0);
  });

  it("a varredura pega a conversa com a IA parada há 30 minutos, e não a que tem atendimento aberto ou pouca conversa", async () => {
    expect(await runIdleSurveys(memoryDb(tables()), { now: NOW })).toBe(1);
    expect(await runIdleSurveys(memoryDb(tables({ conv: { takeover_at: ago(50) } })), { now: NOW })).toBe(0);
    expect(await runIdleSurveys(memoryDb(tables({ conv: { message_count: 2 } })), { now: NOW })).toBe(0);
    // o contato escreveu por último: a IA ainda vai responder
    expect(await runIdleSurveys(memoryDb(tables({ conv: { last_contact_at: ago(34) } })), { now: NOW })).toBe(0);
    // parada há só 10 minutos
    expect(await runIdleSurveys(memoryDb(tables({ conv: { last_reply_at: ago(10), last_contact_at: ago(12) } })), { now: NOW })).toBe(0);
  });

  it("o toque grava a nota uma vez, guarda a mensagem e agradece; a IA não responde", async () => {
    const t = tables();
    await sendSatisfactionSurvey(memoryDb(t), { conversationId: "c1", trigger: "ia", now: NOW });
    const surveyId = String(t.satisfaction_surveys[0].id);
    const stored: number[] = [];
    const replies: string[] = [];
    const io = { db: memoryDb(t), conversation: async () => "c1", store: async (i: number) => void stored.push(i), reply: async (_c: string, text: string) => void replies.push(text) };
    const handled = await handleSatisfactionReplies(io, [{ text: "oi", buttonId: null }, { text: "Ótimo", buttonId: `csat:3:${surveyId}` }]);
    expect(handled).toEqual([1]);
    expect(stored).toEqual([1]);
    expect(replies).toEqual([SURVEY_THANKS]);
    expect(t.satisfaction_surveys[0]).toMatchObject({ score: 3 });
    // a segunda nota não troca a primeira
    await handleSatisfactionReplies(io, [{ text: "Ruim", buttonId: `csat:1:${surveyId}` }]);
    expect(t.satisfaction_surveys[0].score).toBe(3);
    expect(await satisfactionSummary(memoryDb(t), [BOT], ago(60 * 24))).toEqual({ sent: 1, answered: 1, good: 1, regular: 0, bad: 0, goodPct: 100 });
  });
});
