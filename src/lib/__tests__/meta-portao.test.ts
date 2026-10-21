import { beforeEach, describe, expect, it, vi } from "vitest";

const events: Array<{ bot: string; kind: string }> = [];
vi.mock("../platform-events", async (orig) => ({
  ...(await orig<typeof import("../platform-events")>()),
  queueChannelEvent: vi.fn(async (_db: unknown, bot: string, kind: string) => void events.push({ bot, kind })),
}));
const mails: string[] = [];
vi.mock("../notify", () => ({ notifyAgencyOwner: vi.fn(async (_db: unknown, _id: string, subject: string) => (mails.push(subject), true)) }));
vi.mock("../team-notices", () => ({ botTitle: (b: { name: string }) => b.name, sendTeamNotice: vi.fn(async () => 0) }));

import { memoryDb, type MemRow } from "../memory-db";
import { ORDER_MARK, isOrderText, orderText, orderWithLabels } from "../order-message";
import { inboundText } from "../whatsapp-inbound";
import { markDisconnected, markReconnected } from "../whatsapp-access";
import { PRIMARY_INACTIVITY_TEXT } from "../platform-events";
import { noticeRegulatedWithoutChannel, regulatedNoticeEmail } from "../gate/regulated-notice";
import { seal } from "../secret-box";

beforeEach(() => {
  events.length = 0;
  mails.length = 0;
  vi.stubEnv("WHATSAPP_TOKEN_KEY", "chave-de-teste-dos-segredos-123");
});

describe("o carrinho da Meta", () => {
  const order = { catalog_id: "cat1", text: "sem cebola", product_items: [{ product_retailer_id: "SKU-9", quantity: 2, item_price: 12.5, currency: "BRL" }, { product_retailer_id: "PIZ-1", quantity: "1", item_price: 0 }] };

  it("vira texto com a quantidade, o código, o preço e a observação", () => {
    expect(orderText(order)).toBe(`${ORDER_MARK} 2× SKU-9 (R$ 12,50 cada); 1× PIZ-1. Observação: sem cebola`);
    expect(orderText({ product_items: [] })).toBeNull();
    expect(orderText(undefined)).toBeNull();
    expect(inboundText({ id: "m1", type: "order", order })).toBe(orderText(order));
    expect(isOrderText(orderText(order))).toBe(true);
    expect(isOrderText("quero uma pizza")).toBe(false);
  });

  it("os códigos que as ações já mostraram ganham o nome (o portão lê a bebida)", () => {
    const text = orderText(order)!;
    const labeled = orderWithLabels(text, { "SKU-9": { categoria: "bebida", rotulo: "Cerveja Heineken 350 ml" }, "OUTRO.1": { categoria: null, rotulo: "Outro" } });
    expect(labeled).toBe(`${ORDER_MARK} 2× Cerveja Heineken 350 ml (SKU-9) (R$ 12,50 cada); 1× PIZ-1. Observação: sem cebola`);
    // o código que nunca apareceu fica como veio; texto que não é carrinho não muda
    expect(orderWithLabels(text, {})).toBe(text);
    expect(orderWithLabels("2× SKU-9", { "SKU-9": { categoria: "bebida", rotulo: "Cerveja" } })).toBe("2× SKU-9");
  });
});

describe("ACCOUNT_RECONNECTED", () => {
  function tables(o: { reason?: string; size?: string | null } = {}): Record<string, MemRow[]> {
    return {
      bots: [{ id: "b1", agency_id: "ag1", name: "Lia", client_name: "Bar do Zé", client_id: null, size: o.size === undefined ? "P" : o.size, quota_override: null }],
      whatsapp_channels: [{ bot_id: "b1", waba_id: "waba1", phone_number_id: "pn1", display_phone: "+55 21 99999-0000", access_token_enc: seal("token-do-cliente"), disconnected_at: null, disconnect_reason: null }],
    };
  }

  it("na inatividade da coexistência, o acesso fica guardado; nas outras desconexões, sai", async () => {
    const t = tables();
    await markDisconnected(memoryDb(t), { column: "waba_id", value: "waba1" }, PRIMARY_INACTIVITY_TEXT, "PRIMARY_INACTIVITY", { keepToken: true });
    expect(t.whatsapp_channels[0]).toMatchObject({ disconnect_reason: PRIMARY_INACTIVITY_TEXT });
    expect(t.whatsapp_channels[0].access_token_enc).toBeTruthy();
    const other = tables();
    await markDisconnected(memoryDb(other), { column: "waba_id", value: "waba1" }, "a conta saiu", "PARTNER_REMOVED");
    expect(other.whatsapp_channels[0].access_token_enc).toBeNull();
  });

  it("a conta voltou: o número volta sozinho (inscrição refeita, channel.connected e e-mail ao dono)", async () => {
    const t = tables();
    const db = memoryDb(t);
    await markDisconnected(db, { column: "waba_id", value: "waba1" }, PRIMARY_INACTIVITY_TEXT, "PRIMARY_INACTIVITY", { keepToken: true });
    events.length = 0;
    mails.length = 0;
    const subscribed: string[] = [];
    expect(await markReconnected(db, "waba1", { subscribe: async (w, token) => void subscribed.push(`${w}:${token}`) })).toBe(1);
    expect(subscribed).toEqual(["waba1:token-do-cliente"]);
    expect(t.whatsapp_channels[0]).toMatchObject({ disconnected_at: null, disconnect_reason: null });
    expect(events).toEqual([{ bot: "b1", kind: "connected" }]);
    expect(mails).toEqual(["O WhatsApp de Bar do Zé voltou"]);
  });

  it("a Meta recusa o acesso guardado: ele sai e o dono conecta de novo; sem tamanho ou por outro motivo, nada volta", async () => {
    const t = tables();
    const db = memoryDb(t);
    await markDisconnected(db, { column: "waba_id", value: "waba1" }, PRIMARY_INACTIVITY_TEXT, "PRIMARY_INACTIVITY", { keepToken: true });
    mails.length = 0;
    expect(await markReconnected(db, "waba1", { subscribe: async () => Promise.reject(new Error("token inválido")) })).toBe(0);
    expect(t.whatsapp_channels[0].access_token_enc).toBeNull();
    expect(t.whatsapp_channels[0].disconnected_at).toBeTruthy();
    expect(mails).toEqual(["O WhatsApp de Bar do Zé precisa ser conectado de novo"]);

    const unsized = tables({ size: null });
    const d2 = memoryDb(unsized);
    await markDisconnected(d2, { column: "waba_id", value: "waba1" }, PRIMARY_INACTIVITY_TEXT, "PRIMARY_INACTIVITY", { keepToken: true });
    expect(await markReconnected(d2, "waba1", { subscribe: async () => undefined })).toBe(0);
    expect(unsized.whatsapp_channels[0].disconnected_at).toBeTruthy();

    const removed = tables();
    const d3 = memoryDb(removed);
    await markDisconnected(d3, { column: "waba_id", value: "waba1" }, "a conta saiu", "PARTNER_REMOVED", { keepToken: true });
    expect(await markReconnected(d3, "waba1", { subscribe: async () => undefined })).toBe(0);
  });
});

describe("18+ sem canal para os pedidos", () => {
  it("o dono recebe o aviso uma vez por chatbot, com o caminho", async () => {
    const t: Record<string, MemRow[]> = { bots: [{ id: "b1", agency_id: "ag1", name: "Lia", client_name: "Bar do Zé", regulated_notice_at: null }] };
    const db = memoryDb(t);
    const bot = { id: "b1", agency_id: "ag1", name: "Lia", client_name: "Bar do Zé" };
    expect(await noticeRegulatedWithoutChannel(db, bot, ["bebida"])).toBe(true);
    expect(await noticeRegulatedWithoutChannel(db, bot, ["medicamento"])).toBe(false);
    expect(mails).toEqual(["O chatbot Lia (Bar do Zé) recebeu um pedido de bebida alcoólica e não tem onde fechar esses pedidos"]);
    const [, lines] = regulatedNoticeEmail(bot, ["bebida", "medicamento", "bebida"], "https://x/atendimento");
    expect(lines.join(" ")).toContain("bebida alcoólica e remédio");
    expect(lines.join(" ")).toContain("Atendimento humano → Bebida alcoólica e remédio: https://x/atendimento");
  });
});
