import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { expectInbound, igInboundExtra, queueMessageEvent, releaseInbound, resetWebhookCache, waInboundExtra } from "../message-events";
import { refreshMediaLink } from "../file-links";

const NOW = Date.parse("2026-10-12T12:00:00Z");
const ID = "0b7a6c1e-1111-4222-8333-444455556666";

describe("o que a mensagem recebida traz além do texto (C pública, parte 3d)", () => {
  it("WhatsApp: arquivo que será guardado e o clique", () => {
    expect(waInboundExtra({ type: "image", image: { id: "m1" } })).toEqual({ media: true, interactive: null });
    expect(waInboundExtra({ type: "audio", audio: { id: "m2" } }).media).toBe(true);
    expect(waInboundExtra({ type: "location", location: {} }).media).toBe(false);
    expect(waInboundExtra({ type: "text", text: { body: "oi" } })).toEqual({ media: false, interactive: null });
    expect(waInboundExtra({ type: "interactive", interactive: { button_reply: { id: "sim", title: "Sim" } } }).interactive).toEqual({ type: "button_reply", id: "sim", title: "Sim" });
    expect(waInboundExtra({ type: "interactive", interactive: { list_reply: { id: "p2", title: "Pizza" } } }).interactive).toEqual({ type: "list_reply", id: "p2", title: "Pizza" });
    expect(waInboundExtra({ type: "button", button: { text: "Parar promoções", payload: "STOP" } }).interactive).toEqual({ type: "button", id: "STOP", title: "Parar promoções" });
  });

  it("Instagram: anexo de mídia, resposta rápida e botão", () => {
    expect(igInboundExtra({ message: { attachments: [{ type: "image", payload: { url: "https://cdn/x.jpg" } }] } }).media).toBe(true);
    // post compartilhado não é arquivo guardado
    expect(igInboundExtra({ message: { attachments: [{ type: "share", payload: { url: "https://ig/p/1" } }] } }).media).toBe(false);
    expect(igInboundExtra({ message: { text: "Sim", quick_reply: { payload: "age_yes" } } }).interactive).toEqual({ type: "quick_reply", id: "age_yes", title: "Sim" });
    expect(igInboundExtra({ postback: { title: "Ver cardápio", payload: "menu" } }).interactive).toEqual({ type: "postback", id: "menu", title: "Ver cardápio" });
    // botão do card do carrossel com o id do dev: volta sem o prefixo u: do BoaVoz
    expect(igInboundExtra({ postback: { title: "Pedir este", payload: "u:pedir_coca" } }).interactive).toEqual({ type: "postback", id: "pedir_coca", title: "Pedir este" });
  });
});

describe("message.received de mensagem com arquivo espera o arquivo ser guardado", () => {
  afterEach(() => resetWebhookCache());

  it("com arquivo, nada é consultado na gravação; sem arquivo, o evento segue o caminho normal", async () => {
    const from = vi.fn(() => {
      throw new Error("consultou o banco");
    });
    const db = { from } as unknown as SupabaseClient;
    expectInbound([{ key: "k-foto", media: true, interactive: null }]);
    await queueMessageEvent(db, 1, { conversation_id: "c1", role: "user", content: "📷 (foto)", inbound_key: "k-foto" });
    expect(from).not.toHaveBeenCalled();
    // texto comum consulta (e o erro do banco nunca derruba quem gravou)
    await queueMessageEvent(db, 2, { conversation_id: "c1", role: "user", content: "oi", inbound_key: "k-texto" });
    expect(from).toHaveBeenCalled();
    // a liberação acha a mensagem para emitir (aqui o banco falha, sem derrubar ninguém)
    await expect(releaseInbound(db, ["k-foto"])).resolves.toBeUndefined();
  });
});

describe("o link do arquivo é gerado de novo a cada tentativa de entrega", () => {
  beforeEach(() => vi.stubEnv("CONTACT_HASH_KEY", "chave-de-teste-com-mais-de-16"));
  afterEach(() => vi.unstubAllEnvs());

  it("troca url e url_expires_at, e mantém o resto do corpo", () => {
    const body = JSON.stringify({ id: "evt_1", type: "message.received", data: { message: { id: "msg_1", text: null, media: { id: `med_${ID}`, type: "image", url: "https://velho", url_expires_at: "2026-01-01T00:00:00.000Z" }, interactive: null } } });
    const out = JSON.parse(refreshMediaLink(body, NOW));
    expect(out.data.message.media.url).toContain(`/api/files/${ID}?exp=`);
    expect(out.data.message.media.url_expires_at).toBe(new Date(NOW + 3600_000).toISOString());
    expect(out.id).toBe("evt_1");
    expect(out.data.message.media.type).toBe("image");
  });

  it("sem arquivo (ou corpo estranho), o corpo volta igual", () => {
    const plain = JSON.stringify({ id: "evt_2", data: { message: { id: "msg_2", text: "oi", media: null } } });
    expect(refreshMediaLink(plain, NOW)).toBe(plain);
    expect(refreshMediaLink('{"med_": quebrado', NOW)).toBe('{"med_": quebrado');
  });
});
