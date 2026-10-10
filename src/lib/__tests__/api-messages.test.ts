import { describe, expect, it } from "vitest";
import { channelError, contentProblem, excerptOf, parseSendBody, signature } from "../api-messages";
import { ApiError } from "../api-v1";
import { SendTimeoutError, WhatsAppError } from "../whatsapp";
import { InstagramError } from "../instagram";

const err = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e as ApiError;
  }
  throw new Error("não lançou");
};

describe("POST /v1/messages: o corpo (C pública, parte 3b)", () => {
  it("texto para o WhatsApp ou o Instagram, com assinatura e sistema de origem", () => {
    expect(parseSendBody({ bot_id: "bot_x", to: "phone:5521999999999", type: "text", text: "  Seu pedido saiu  ", agent_name: "Ana", sender: "zendesk" })).toEqual({
      target: "channel",
      to: "phone:5521999999999",
      channel: null,
      type: "text",
      text: "Seu pedido saiu",
      agentName: "Ana",
      sender: "zendesk",
    });
  });

  it("modelo com variáveis na ordem; idioma pt_BR por padrão", () => {
    const p = parseSendBody({ to: "ctc_x", type: "template", template: { name: "pedido_saiu", variables: ["Ana", "123"] } });
    expect(p).toMatchObject({ type: "template", template: { name: "pedido_saiu", language: "pt_BR", variables: ["Ana", "123"] } });
  });

  it("chat do site pelo conversation_id, só texto", () => {
    const id = "conv_0b7a6c1e-1111-4222-8333-444455556666";
    expect(parseSendBody({ conversation_id: id, type: "text", text: "oi" })).toMatchObject({ target: "widget", conversationId: "0b7a6c1e-1111-4222-8333-444455556666" });
    expect(err(() => parseSendBody({ conversation_id: id, type: "template", template: { name: "x" } })).details).toEqual({ field: "type" });
    expect(err(() => parseSendBody({ conversation_id: id, to: "ctc_x", type: "text", text: "oi" })).details).toEqual({ field: "conversation_id" });
  });

  it("recusa o que está fora do formato, apontando o campo", () => {
    expect(err(() => parseSendBody({ to: "x", type: "audio" })).details).toEqual({ field: "type" });
    expect(err(() => parseSendBody({ to: "x", type: "document" })).details).toEqual({ field: "type" });
    expect(err(() => parseSendBody({ type: "text", text: "oi" })).details).toEqual({ field: "to" });
    expect(err(() => parseSendBody({ to: "x", type: "text" })).details).toEqual({ field: "text" });
    expect(err(() => parseSendBody({ to: "x", type: "text", text: "a".repeat(4097) })).details).toEqual({ field: "text" });
    expect(err(() => parseSendBody({ to: "x", type: "text", text: "oi", channel: "sms" })).details).toEqual({ field: "channel" });
    expect(err(() => parseSendBody({ to: "x", type: "text", text: "oi", sender: "a<b>" })).details).toEqual({ field: "sender" });
    expect(err(() => parseSendBody({ to: "x", type: "template", text: "oi", template: { name: "t" } })).details).toEqual({ field: "text" });
    expect(err(() => parseSendBody({ to: "x", type: "template", template: { name: "t", variables: [1] } })).details).toEqual({ field: "template.variables" });
    expect(err(() => parseSendBody({ to: "x", type: "template", template: { name: "t", language: "português" } })).details).toEqual({ field: "template.language" });
  });
});

describe("o portão no envio pela API: o texto nunca é editado", () => {
  const base = { channel: "whatsapp" as const, contactPhone: "5521999999999", age: null, regulatedConversation: false, exempt: [] };

  it("texto comum passa", () => {
    expect(contentProblem("Seu pedido saiu para entrega e chega em 30 minutos.", base)).toBeNull();
  });

  it("proibido, com qualquer idade, com o termo e o trecho", () => {
    const p = contentProblem("Temos rivotril com desconto hoje.", { ...base, age: "sim" });
    expect(p?.reason).toBe("prohibited");
    expect(p?.matches[0]).toMatchObject({ term: "rivotril" });
    expect(p?.matches[0].excerpt).toContain("rivotril");
  });

  it("regulamentado sem 18+ confirmado; com 18+ sai", () => {
    expect(contentProblem("A cerveja gelada chegou.", base)?.reason).toBe("age_not_confirmed");
    expect(contentProblem("A cerveja gelada chegou.", { ...base, age: "sim" })).toBeNull();
  });

  it("regulamentado junto de pagamento, com qualquer idade (e o pagamento numa conversa com o item)", () => {
    expect(contentProblem("Sua cerveja: pague pelo pix 21999999999.", { ...base, age: "sim" })?.reason).toBe("regulated_in_transaction");
    expect(contentProblem("Pague pelo pix 21999999999.", { ...base, age: "sim", regulatedConversation: true })?.reason).toBe("regulated_in_transaction");
    expect(contentProblem("Pague pelo pix 21999999999.", { ...base, age: "sim" })).toBeNull();
  });

  it("trecho em volta do termo", () => {
    expect(excerptOf("Olá! Hoje tem Cerveja Artesanal na promoção", "cerveja")).toContain("cerveja artesanal");
  });
});

describe("assinatura e erros do canal", () => {
  it("agent_name assina no WhatsApp e no Instagram; no site o nome vai no balão", () => {
    expect(signature("Ana", "whatsapp")).toBe("*Ana:*");
    expect(signature("Ana", "instagram")).toBe("Ana:");
    expect(signature("Ana", "widget")).toBeNull();
    expect(signature(null, "whatsapp")).toBeNull();
  });

  it("erro da Meta vira o código da API (temporário com Retry-After)", () => {
    expect(channelError(new WhatsAppError("re-engagement", 131047))).toMatchObject({ status: 422, code: "outside_messaging_window" });
    expect(channelError(new WhatsAppError("pair rate", 131056))).toMatchObject({ status: 429, code: "rate_limited", headers: { "Retry-After": "6" } });
    expect(channelError(new WhatsAppError("throughput", 130429))).toMatchObject({ status: 429, headers: { "Retry-After": "60" } });
    expect(channelError(new WhatsAppError("service unavailable", 131016))).toMatchObject({ status: 503, code: "channel_unavailable" });
    expect(channelError(new WhatsAppError("not a WhatsApp user", 131026))).toMatchObject({ status: 422, code: "channel_rejected", details: { channel_code: 131026 } });
    expect(channelError(new InstagramError("fora da janela", 10, 2018278))).toMatchObject({ status: 422, code: "outside_messaging_window" });
    expect(channelError(new TypeError("fetch failed"))).toMatchObject({ status: 503 });
  });

  it("sem resposta no prazo é um erro próprio (vira 202 uncertain, nunca reenvio)", () => {
    expect(new SendTimeoutError("whatsapp")).toBeInstanceOf(Error);
    expect(new SendTimeoutError("instagram").channel).toBe("instagram");
  });
});
