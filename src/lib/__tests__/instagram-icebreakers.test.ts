import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Perguntas prontas na Meta (E1, parte 3a): na dev, a Meta recusou o formato da documentação com
 * "Invalid parameter" (20/10). A gravação tenta as variações conhecidas em ordem, para na primeira
 * aceita e, se nenhuma passar, devolve o motivo de cada uma (com o detalhe que a Meta manda). Erro
 * de token ou de permissão não tenta outro formato. A Meta é simulada.
 */

vi.mock("../secret-box", () => ({ unseal: () => "token", seal: (s: string) => s }));

const meta = vi.hoisted(() => ({ calls: [] as Array<{ url: string; method: string; body: Record<string, unknown> | null }>, answers: [] as Array<{ status: number; body: unknown }> }));
vi.stubGlobal(
  "fetch",
  vi.fn(async (url: string, init: RequestInit) => {
    meta.calls.push({ url, method: String(init.method), body: init.body ? JSON.parse(String(init.body)) : null });
    const a = meta.answers.shift() ?? { status: 200, body: { success: true } };
    return new Response(JSON.stringify(a.body), { status: a.status, headers: { "Content-Type": "application/json" } });
  }),
);

import { InstagramError, setInstagramIceBreakers } from "../instagram";

const ch = { ig_user_id: "17841400000000000", access_token_enc: "selado" };
const invalid = (detail?: string) => ({ status: 400, body: { error: { message: "Invalid parameter", type: "OAuthException", code: 100, error_subcode: 2018001, ...(detail ? { error_user_msg: detail } : {}) } } });

beforeEach(() => {
  meta.calls = [];
  meta.answers = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("as perguntas prontas na Meta", () => {
  it("o formato da documentação aceito de primeira", async () => {
    expect(await setInstagramIceBreakers(ch, ["Qual o horário?", "Vocês entregam?"])).toBe("documentação");
    expect(meta.calls).toHaveLength(1);
    expect(meta.calls[0].url).toMatch(/graph\.instagram\.com\/v\d+\.\d+\/me\/messenger_profile$/);
    expect(meta.calls[0].body).toEqual({ platform: "instagram", ice_breakers: [{ call_to_actions: [{ question: "Qual o horário?", payload: "ib:1" }, { question: "Vocês entregam?", payload: "ib:2" }] }] });
  });

  it("recusado com Invalid parameter: tenta o locale default, e para no que a Meta aceita", async () => {
    meta.answers = [invalid()];
    expect(await setInstagramIceBreakers(ch, ["Qual o horário?"])).toBe("locale default");
    expect(meta.calls).toHaveLength(2);
    expect(meta.calls[1].body).toEqual({ platform: "instagram", ice_breakers: [{ call_to_actions: [{ question: "Qual o horário?", payload: "ib:1" }], locale: "default" }] });
  });

  it("depois, o id da conta no lugar de me e o formato antigo", async () => {
    meta.answers = [invalid(), invalid(), invalid()];
    expect(await setInstagramIceBreakers(ch, ["Qual o horário?"])).toBe("formato antigo");
    expect(meta.calls[2].url).toContain("/17841400000000000/messenger_profile");
    expect(meta.calls[3].body).toEqual({ platform: "instagram", ice_breakers: [{ question: "Qual o horário?", payload: "ib:1" }] });
  });

  it("nenhum aceito: o motivo de cada formato, com o detalhe da Meta", async () => {
    meta.answers = [invalid("The ice breakers field is not supported for this account"), invalid(), invalid(), invalid()];
    const err = await setInstagramIceBreakers(ch, ["Qual o horário?"]).catch((e) => e);
    expect(err).toBeInstanceOf(InstagramError);
    expect(err.message).toContain("nenhum formato foi aceito");
    expect(err.message).toContain("documentação: Invalid parameter — The ice breakers field is not supported for this account (2018001)");
    expect(err.message).toContain("formato antigo: Invalid parameter");
  });

  it("token recusado não tenta outro formato", async () => {
    meta.answers = [{ status: 400, body: { error: { message: "Error validating access token", code: 190 } } }];
    await expect(setInstagramIceBreakers(ch, ["Qual o horário?"])).rejects.toMatchObject({ code: 190 });
    expect(meta.calls).toHaveLength(1);
  });

  it("lista vazia apaga as perguntas da conta", async () => {
    expect(await setInstagramIceBreakers(ch, [])).toBe("apagadas");
    expect(meta.calls[0]).toMatchObject({ method: "DELETE", body: { fields: ["ice_breakers"] } });
  });
});
