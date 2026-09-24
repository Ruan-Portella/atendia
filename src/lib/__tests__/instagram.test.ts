import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstagramError, authorizeUrl, fitDm, isInstagramAccessError, isOutsideWindow, readState, signState, toInstagramText } from "../instagram";
import { igMediaLabel, igText } from "../instagram-inbound";

describe("state do login", () => {
  beforeEach(() => vi.stubEnv("INSTAGRAM_APP_SECRET", "segredo-do-instagram"));
  afterEach(() => vi.unstubAllEnvs());

  it("volta o que foi assinado: painel e link", () => {
    expect(readState(signState({ botId: "b1", via: "painel" }))).toEqual({ botId: "b1", via: "painel" });
    expect(readState(signState({ botId: "b1", via: "link", token: "tok" }))).toEqual({ botId: "b1", via: "link", token: "tok" });
  });

  it("recusa state adulterado, de outra chave, vencido ou vazio", () => {
    const state = signState({ botId: "b1", via: "painel" });
    const [body, sig] = state.split(".");
    const forged = Buffer.from(JSON.stringify({ botId: "b2", via: "painel", exp: Date.now() + 60_000 })).toString("base64url");
    expect(readState(`${forged}.${sig}`)).toBeNull();
    expect(readState(`${body}.x${sig.slice(1)}`)).toBeNull();
    vi.stubEnv("INSTAGRAM_APP_SECRET", "outra-chave");
    expect(readState(state)).toBeNull();
    vi.stubEnv("INSTAGRAM_APP_SECRET", "segredo-do-instagram");
    expect(readState(signState({ botId: "b1", via: "painel" }, Date.now() - 20 * 60_000))).toBeNull();
    expect(readState(null)).toBeNull();
    expect(readState("sem-ponto")).toBeNull();
  });

  it("URL de login com as permissões de mensagens e o retorno cadastrado", () => {
    vi.stubEnv("INSTAGRAM_APP_ID", "123");
    const url = new URL(authorizeUrl("st"));
    expect(url.origin + url.pathname).toBe("https://www.instagram.com/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("123");
    expect(url.searchParams.get("scope")).toBe("instagram_business_basic,instagram_business_manage_messages");
    expect(url.searchParams.get("redirect_uri")).toMatch(/\/api\/instagram\/callback$/);
    expect(url.searchParams.get("state")).toBe("st");
  });
});

describe("texto da DM", () => {
  it("cabe em 1.000 bytes sem partir emoji", () => {
    expect(fitDm("oi")).toBe("oi");
    const long = "😀".repeat(400); // 1.600 bytes
    const out = fitDm(long);
    expect(Buffer.byteLength(out, "utf8")).toBeLessThanOrEqual(1000);
    expect(out.endsWith("…")).toBe(true);
    expect(out.replace("…", "")).toMatch(/^(😀)+$/u);
  });

  it("tira o markdown (o Instagram não formata)", () => {
    expect(toInstagramText("O **clareamento** custa R$ 890")).toBe("O clareamento custa R$ 890");
    expect(toInstagramText("Veja [a tabela](https://ex.com/p)")).toBe("Veja a tabela: https://ex.com/p");
    expect(toInstagramText("## Horários\nSeg a sex")).toBe("Horários\nSeg a sex");
  });
});

describe("erros do Instagram", () => {
  it("190 é acesso removido; 2018278 é fora da janela", () => {
    expect(isInstagramAccessError(new InstagramError("token", 190))).toBe(true);
    expect(isInstagramAccessError(new InstagramError("outro", 10))).toBe(false);
    expect(isOutsideWindow(new InstagramError("janela", 10, 2018278))).toBe(true);
    expect(isOutsideWindow(new InstagramError("janela", 10))).toBe(false);
  });
});

describe("mensagens recebidas", () => {
  it("lê texto e botão; mídia vira rótulo", () => {
    expect(igText({ message: { mid: "m", text: "  oi  " } })).toBe("oi");
    expect(igText({ postback: { title: "Quero agendar" } })).toBe("Quero agendar");
    expect(igText({ message: { mid: "m", attachments: [{ type: "image" }] } })).toBeNull();
    expect(igMediaLabel({ message: { attachments: [{ type: "image" }] } })).toBe("📷 (foto)");
    expect(igMediaLabel({ message: { attachments: [{ type: "story_mention" }] } })).toBe("(menção nos stories)");
    expect(igMediaLabel({ message: {} })).toBe("(mensagem sem texto)");
  });
});
