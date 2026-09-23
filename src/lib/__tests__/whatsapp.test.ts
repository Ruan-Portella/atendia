import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toWhatsAppText, validSignature, whatsappAllowed } from "../whatsapp";
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
