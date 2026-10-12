import { describe, expect, it } from "vitest";
import { contactApiObject, leadApiObject, parseConsentBody, parseTags } from "../api-contacts";
import { contextShape } from "../inbound-process";
import { ApiError } from "../api-v1";
import type { ApiContactRow } from "../contacts";

const NOW = Date.parse("2026-10-12T12:00:00Z");
const err = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e as ApiError;
  }
  throw new Error("não lançou");
};

const row = (o: Partial<ApiContactRow> = {}): ApiContactRow => ({
  id: "c1",
  bot_id: "b1",
  channel: "whatsapp",
  name: "Ana",
  email: null,
  tags: ["vip"],
  phone: "5521999999999",
  bsuid: "BR.123",
  igsid: null,
  external_id: "user_42",
  first_inbound_at: null,
  last_inbound_at: null,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-02T00:00:00Z",
  ...o,
});

describe("contatos pela API (C pública, parte 4a)", () => {
  it("WhatsApp: identidades, etiquetas, consentimento e 18+", () => {
    expect(contactApiObject(row(), { consent: "granted", optedOut: ["utility"], age: "sim" })).toMatchObject({
      id: "ctc_c1",
      bot_id: "bot_b1",
      phone: "5521999999999",
      whatsapp_user_id: "BR.123",
      instagram_id: null,
      external_id: "user_42",
      tags: ["vip"],
      consent: { marketing: "granted", opted_out: ["utility"] },
      age_confirmed: true,
    });
  });

  it("Instagram: sem promoções (só o descadastro); site: sem consentimento", () => {
    const ig = contactApiObject(row({ channel: "instagram", phone: null, bsuid: null, igsid: "17841" }), { consent: null, optedOut: ["all"], age: null });
    expect(ig).toMatchObject({ phone: null, whatsapp_user_id: null, instagram_id: "17841", consent: { marketing: null, opted_out: ["all"] }, age_confirmed: null });
    expect(contactApiObject(row({ channel: "widget" }), { consent: null, optedOut: [], age: "nao" })).toMatchObject({ consent: null, age_confirmed: false, phone: null });
  });

  it("etiquetas: lista de textos, sem # e sem repetir; vazia apaga", () => {
    expect(parseTags(["#VIP", "vip", "  cliente novo ", "a,b"])).toEqual(["VIP", "cliente novo", "a b"]);
    expect(parseTags([])).toEqual([]);
    expect(err(() => parseTags("vip")).details).toEqual({ field: "tags" });
    expect(err(() => parseTags([1])).details).toEqual({ field: "tags" });
    expect(err(() => parseTags(Array.from({ length: 21 }, (_, i) => `t${i}`))).details).toEqual({ field: "tags" });
  });

  it("lead no formato da API", () => {
    expect(leadApiObject({ id: "l1", bot_id: "b1", conversation_id: "cv1", name: "Ana", phone: "5521", email: null, instagram: null, channel: "whatsapp", notes: "quer orçamento", created_at: "2026-10-01T00:00:00Z" })).toEqual({
      id: "lead_l1",
      bot_id: "bot_b1",
      conversation_id: "conv_cv1",
      channel: "whatsapp",
      name: "Ana",
      phone: "5521",
      email: null,
      instagram: null,
      notes: "quer orçamento",
      created_at: "2026-10-01T00:00:00Z",
    });
  });
});

describe("consentimento pela API: a prova vem junto", () => {
  const base = { granted: true, source: "cadastro no site", text: "Aceito receber novidades por WhatsApp" };

  it("aceite com origem, texto e data", () => {
    expect(parseConsentBody({ ...base, channel: "whatsapp", collected_at: "2026-10-10T15:00:00Z" }, NOW)).toEqual({ ...base, collectedAt: "2026-10-10T15:00:00.000Z" });
    // sem data, vale agora
    expect(parseConsentBody(base, NOW).collectedAt).toBe(new Date(NOW).toISOString());
  });

  it("recusa o que falta ou está fora do lugar, apontando o campo", () => {
    expect(err(() => parseConsentBody({ ...base, channel: "instagram" }, NOW)).details).toEqual({ field: "channel" });
    expect(err(() => parseConsentBody({ ...base, granted: "sim" }, NOW)).details).toEqual({ field: "granted" });
    expect(err(() => parseConsentBody({ ...base, source: "x" }, NOW)).details).toEqual({ field: "source" });
    expect(err(() => parseConsentBody({ ...base, text: "ok" }, NOW)).details).toEqual({ field: "text" });
    expect(err(() => parseConsentBody({ ...base, collected_at: "2026-12-01T00:00:00Z" }, NOW)).details).toEqual({ field: "collected_at" });
  });
});

describe("teste do status do WhatsApp: só o formato vai para o registro", () => {
  it("nomes dos campos (e dos de dentro), nunca os valores", () => {
    expect(contextShape({ id: "wamid.X", from: "5521999999999", referred_product: { catalog_id: "1", product_retailer_id: "2" } })).toBe("from,id,referred_product{catalog_id,product_retailer_id}");
    expect(contextShape({ forwarded: true })).toBe("forwarded");
  });
});
