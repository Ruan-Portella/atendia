import { describe, expect, it } from "vitest";
import { UNSEEN_WINDOW_MS, igUnseenKind, recentUnseen, unseenMediaText, waUnseenKind } from "../unseen-media";

describe("mídia que o assistente não vê", () => {
  it("WhatsApp: foto, vídeo e documento; figurinha, áudio e localização não", () => {
    expect(waUnseenKind("image")).toBe("foto");
    expect(waUnseenKind("video")).toBe("vídeo");
    expect(waUnseenKind("document")).toBe("arquivo");
    for (const t of ["sticker", "audio", "location", "text"]) expect(waUnseenKind(t)).toBeNull();
  });

  it("Instagram: story e foto sempre; post ou reel só sem legenda (com legenda, ele lê a legenda)", () => {
    expect(igUnseenKind([{ type: "ig_story" }])).toBe("story");
    expect(igUnseenKind([{ type: "image" }])).toBe("foto");
    expect(igUnseenKind([{ type: "ig_post", payload: { title: "Pizza R$ 45" } }])).toBeNull();
    expect(igUnseenKind([{ type: "ig_post", payload: { title: " " } }])).toBe("post");
    expect(igUnseenKind([{ type: "ig_reel" }])).toBe("reel");
    expect(igUnseenKind([{ type: "audio" }])).toBeNull();
    expect(igUnseenKind(undefined)).toBeNull();
  });

  it("o texto fixo pede para escrever o que é, sem prometer o que não vê", () => {
    expect(unseenMediaText("foto")).toBe("Recebi sua foto, mas por aqui eu ainda não consigo ver imagens. Pode me escrever o que é ou o que você quer saber (o nome do produto, por exemplo)? Assim eu te respondo certo.");
    expect(unseenMediaText("arquivo")).toContain("abrir arquivos");
    expect(unseenMediaText("story")).toContain("Recebi o story");
  });

  it("a pergunta que vem logo depois (até 2 minutos) ainda é sobre a mídia", () => {
    const now = Date.parse("2026-10-02T20:00:00Z");
    expect(recentUnseen({ unseen_media_at: new Date(now - 30_000).toISOString(), unseen_media_kind: "story" }, now)).toBe("story");
    expect(recentUnseen({ unseen_media_at: new Date(now - UNSEEN_WINDOW_MS - 1000).toISOString(), unseen_media_kind: "foto" }, now)).toBeNull();
    expect(recentUnseen({ unseen_media_at: null }, now)).toBeNull();
    expect(recentUnseen(null, now)).toBeNull();
  });
});
