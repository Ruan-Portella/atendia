import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_MEDIA_BYTES, downloadMedia, toWhatsAppText, validSignature, waIdVariants, whatsappAllowed } from "../whatsapp";
import { inboundText } from "../whatsapp-inbound";

const sign = (body: string, secret: string) => "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

describe("validSignature", () => {
  const body = '{"object":"whatsapp_business_account"}';

  it("aceita a assinatura feita com a chave do app", () => {
    expect(validSignature(body, sign(body, "segredo"), "segredo")).toBe(true);
  });

  it("recusa chave errada, corpo alterado, cabeçalho ausente ou servidor sem chave", () => {
    expect(validSignature(body, sign(body, "outra"), "segredo")).toBe(false);
    expect(validSignature(body + " ", sign(body, "segredo"), "segredo")).toBe(false);
    expect(validSignature(body, null, "segredo")).toBe(false);
    expect(validSignature(body, "sha256=abc", "segredo")).toBe(false);
    expect(validSignature(body, sign(body, "segredo"), undefined)).toBe(false);
  });
});

describe("toWhatsAppText", () => {
  it("troca a formatação markdown pela do WhatsApp", () => {
    expect(toWhatsAppText("O **clareamento** custa R$ 890")).toBe("O *clareamento* custa R$ 890");
    expect(toWhatsAppText("## Horários\nSeg a sex")).toBe("Horários\nSeg a sex");
    expect(toWhatsAppText("Veja [a tabela](https://ex.com/p)")).toBe("Veja a tabela: https://ex.com/p");
    expect(toWhatsAppText("[https://ex.com](https://ex.com)")).toBe("https://ex.com");
  });
});

describe("inboundText", () => {
  const base = { id: "wamid.1", from: "5521999999999" };

  it("lê texto, botão e item de lista", () => {
    expect(inboundText({ ...base, type: "text", text: { body: "  oi  " } })).toBe("oi");
    expect(inboundText({ ...base, type: "button", button: { text: "Quero agendar" } })).toBe("Quero agendar");
    expect(inboundText({ ...base, type: "interactive", interactive: { list_reply: { title: "Clareamento" } } })).toBe("Clareamento");
  });

  it("áudio, imagem e texto vazio não têm texto", () => {
    expect(inboundText({ ...base, type: "audio" })).toBeNull();
    expect(inboundText({ ...base, type: "text", text: { body: "   " } })).toBeNull();
  });
});

describe("whatsappAllowed", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("sem configuração, só o e-mail de teste (sem diferenciar maiúsculas)", () => {
    vi.stubEnv("WHATSAPP_BETA_EMAILS", undefined);
    expect(whatsappAllowed("RuanMorales29@gmail.com")).toBe(true);
    expect(whatsappAllowed("outra@agencia.com")).toBe(false);
    expect(whatsappAllowed("")).toBe(false);
  });

  it("lista do .env e * para liberar todo mundo", () => {
    vi.stubEnv("WHATSAPP_BETA_EMAILS", "a@x.com, b@y.com");
    expect(whatsappAllowed("b@y.com")).toBe(true);
    expect(whatsappAllowed("ruanmorales29@gmail.com")).toBe(false);
    vi.stubEnv("WHATSAPP_BETA_EMAILS", "*");
    expect(whatsappAllowed("qualquer@um.com")).toBe(true);
  });
});

describe("waIdVariants", () => {
  it("celular brasileiro com e sem o 9", () => {
    expect(waIdVariants("5521987654321")).toEqual(["5521987654321", "552187654321"]);
    expect(waIdVariants("552187654321")).toEqual(["552187654321", "5521987654321"]);
  });
  it("fixo e outros países ficam como estão", () => {
    expect(waIdVariants("552133334444")).toEqual(["552133334444"]);
    expect(waIdVariants("14155550123")).toEqual(["14155550123"]);
  });
});

describe("downloadMedia", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  const ch = { phone_number_id: "123" };

  it("pede o endereço à Meta e baixa com o token do número", async () => {
    vi.stubEnv("WHATSAPP_TOKEN", "tok");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ url: "https://lookaside.fbsbx.com/a", mime_type: "audio/ogg", file_size: 3 })))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal("fetch", fetchMock);
    const media = await downloadMedia(ch, "media-1");
    expect(media.mimeType).toBe("audio/ogg");
    expect([...media.data]).toEqual([1, 2, 3]);
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/media-1$/);
    for (const [, init] of fetchMock.mock.calls) expect(init.headers.Authorization).toBe("Bearer tok");
  });

  it("não baixa mídia maior que o limite do WhatsApp", async () => {
    vi.stubEnv("WHATSAPP_TOKEN", "tok");
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ url: "https://x", file_size: MAX_MEDIA_BYTES + 1 })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(downloadMedia(ch, "media-2")).rejects.toThrow(/grande demais/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
