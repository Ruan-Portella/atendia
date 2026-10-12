import { describe, expect, it } from "vitest";
import { parseCampaignBody, parseCampaignVariables } from "../api-campaigns";
import { campaignFinishedData } from "../campaigns";
import { ApiError } from "../api-v1";

const NOW = Date.parse("2026-10-12T12:00:00Z");
const iso = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();
const err = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e as ApiError;
  }
  throw new Error("não lançou");
};

describe("campanha de marketing pela API (C pública, parte 4b)", () => {
  const base = { kind: "marketing", template: { name: "black_friday", variables: [{ type: "first_name", fallback: "cliente" }, "30%"] }, audience: { tags: ["vip"] } };

  it("público por etiqueta, variáveis com o primeiro nome e agora", () => {
    expect(parseCampaignBody(base, NOW)).toEqual({
      kind: "marketing",
      name: null,
      template: { name: "black_friday", language: "pt_BR", variables: [{ mode: "name", value: "cliente" }, { mode: "fixed", value: "30%" }] },
      audience: { tags: ["vip"], contacts: [], externalIds: [] },
      sends: null,
      sendAt: null,
      regulated: false,
    });
  });

  it("agendada: a data com fuso vira UTC; no passado sai agora; mais de 60 dias, não", () => {
    expect(parseCampaignBody({ ...base, send_at: "2026-10-13T09:00:00-03:00" }, NOW).sendAt).toBe("2026-10-13T12:00:00.000Z");
    expect(parseCampaignBody({ ...base, send_at: iso(-10) }, NOW).sendAt).toBeNull();
    expect(err(() => parseCampaignBody({ ...base, send_at: iso(61 * 24 * 60) }, NOW)).details).toEqual({ field: "send_at" });
  });

  it("recusa o que não é campanha de WhatsApp ou não tem público", () => {
    expect(err(() => parseCampaignBody({ ...base, channel: "instagram" }, NOW)).details).toEqual({ field: "channel" });
    expect(err(() => parseCampaignBody({ ...base, kind: "promo" }, NOW)).details).toEqual({ field: "kind" });
    expect(err(() => parseCampaignBody({ ...base, audience: {} }, NOW)).details).toEqual({ field: "audience" });
    expect(err(() => parseCampaignBody({ ...base, audience: { tags: "vip" } }, NOW)).details).toEqual({ field: "audience.tags" });
    expect(err(() => parseCampaignBody({ ...base, sends: [] }, NOW)).details).toEqual({ field: "sends" });
    expect(err(() => parseCampaignBody({ ...base, template: {} }, NOW)).details).toEqual({ field: "template.name" });
  });

  it("variável: texto, ou o primeiro nome com um texto para quem não tem nome", () => {
    expect(parseCampaignVariables(["oi", { type: "first_name", fallback: "amigo" }])).toEqual([{ mode: "fixed", value: "oi" }, { mode: "name", value: "amigo" }]);
    expect(err(() => parseCampaignVariables([{ type: "first_name" }])).details).toEqual({ field: "template.variables[0]" });
    expect(err(() => parseCampaignVariables([7])).details).toEqual({ field: "template.variables[0]" });
  });
});

describe("lembretes pela API", () => {
  const send = { contact: "phone:5521999999999", send_at: iso(60), variables: ["Ana", "amanhã 15h"] };
  const base = { kind: "utility_reminder", template: { name: "lembrete_consulta" }, sends: [send] };

  it("cada linha com o contato, a hora e as variáveis", () => {
    expect(parseCampaignBody(base, NOW)).toMatchObject({ kind: "utility_reminder", audience: null, sends: [{ contact: "phone:5521999999999", sendAt: iso(60), variables: ["Ana", "amanhã 15h"], name: null }] });
  });

  it("aponta a linha com problema", () => {
    expect(err(() => parseCampaignBody({ ...base, sends: [send, { ...send, send_at: iso(-60) }] }, NOW)).details).toEqual({ field: "sends[1].send_at" });
    expect(err(() => parseCampaignBody({ ...base, sends: [{ ...send, send_at: iso(91 * 24 * 60) }] }, NOW)).details).toEqual({ field: "sends[0].send_at" });
    expect(err(() => parseCampaignBody({ ...base, sends: [{ ...send, contact: "" }] }, NOW)).details).toEqual({ field: "sends[0].contact" });
    expect(err(() => parseCampaignBody({ ...base, sends: [{ ...send, variables: ["linha\nquebrada"] }] }, NOW)).details).toEqual({ field: "sends[0].variables" });
    expect(err(() => parseCampaignBody({ ...base, audience: { tags: ["x"] } }, NOW)).details).toEqual({ field: "audience" });
    expect(err(() => parseCampaignBody({ ...base, sends: Array.from({ length: 2001 }, () => send) }, NOW)).details).toEqual({ field: "sends" });
  });

  it("campaign.finished usa o mesmo kind da API", () => {
    expect(campaignFinishedData({ id: "c1", name: "x", kind: "utility_reminder" }, { status: {}, replied: 0, optOut: {}, errors: {} }).campaign.kind).toBe("utility_reminder");
  });
});
