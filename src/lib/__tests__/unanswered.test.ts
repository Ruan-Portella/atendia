import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { looksUnanswered, NO_INFO_PHRASE, recordUnanswered } from "../unanswered";

describe("looksUnanswered", () => {
  it.each([
    `${NO_INFO_PHRASE}, mas posso pedir para a equipe te responder.`,
    "Não tenho informações sobre estacionamento.",
    "Infelizmente nao encontrei essa informação no site.",
    "Não sei informar o preço exato.",
    "Essa informação não está disponível aqui.",
    "NÃO TENHO ESTA INFORMAÇÃO no momento",
  ])("reconhece: %s", (t) => expect(looksUnanswered(t)).toBe(true));

  it.each([
    "Abrimos de segunda a sexta, das 8h às 18h.",
    "Sim, aceitamos Unimed.",
    "Tenho essa informação: custa R$ 120.",
    "Não se preocupe, a consulta dura 30 minutos.",
  ])("não confunde resposta normal: %s", (t) => expect(looksUnanswered(t)).toBe(false));
});

describe("recordUnanswered", () => {
  function fakeDb(pending: string[]) {
    const inserts: unknown[] = [];
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: async () => ({ data: pending.map((question, i) => ({ id: String(i), question })) }),
      insert: async (row: unknown) => {
        inserts.push(row);
        return {};
      },
      update: () => ({ eq: async () => ({}) }),
    };
    return { db: { from: vi.fn(() => chain) } as unknown as SupabaseClient, inserts };
  }

  it("registra pergunta nova", async () => {
    const { db, inserts } = fakeDb([]);
    await recordUnanswered(db, "bot", "conv", "  Tem   estacionamento? ");
    expect(inserts).toEqual([{ bot_id: "bot", question: "Tem estacionamento?" }]);
  });

  it("não duplica a mesma pergunta pendente (acento, maiúscula e ? não importam)", async () => {
    const { db, inserts } = fakeDb(["Tem estacionamento?"]);
    await recordUnanswered(db, "bot", "conv", "tem ESTACIONAMENTO");
    expect(inserts).toEqual([]);
  });
});
