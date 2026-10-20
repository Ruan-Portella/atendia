import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { memoryDb, type MemRow } from "../memory-db";

/*
 * O nome de usuário do Instagram (E1): muda no Instagram sem aviso e os links ig.me levam o nome
 * (com o antigo, o link abre o Instagram mas não acha a conversa). O painel e o cron diário conferem
 * na Meta; a troca guarda o antigo (o aviso do painel), acerta a fonte dos posts e avisa a agência
 * quando há links com origem. A Meta é simulada: cada token responde por uma conta.
 */

const meta = vi.hoisted(() => ({ calls: [] as string[], accounts: {} as Record<string, { igUserId: string; username: string | null } | Error> }));
vi.mock("../instagram", async (orig) => ({
  ...(await orig<typeof import("../instagram")>()),
  instagramMe: vi.fn(async (token: string) => {
    meta.calls.push(token);
    const a = meta.accounts[token];
    if (!a || a instanceof Error) throw a ?? new Error("token desconhecido");
    return a;
  }),
}));
vi.mock("../secret-box", () => ({ unseal: (s: string) => s, seal: (s: string) => s }));
const mail = vi.hoisted(() => ({ sent: [] as Array<{ agency: string; subject: string; lines: string[] }> }));
vi.mock("../notify", () => ({
  notifyAgencyOwner: vi.fn(async (_db: unknown, agency: string, subject: string, lines: string[]) => {
    mail.sent.push({ agency, subject, lines });
    return true;
  }),
}));

import { IG_USERNAME_PANEL_MS, refreshInstagramUsername, refreshInstagramUsernames } from "../instagram-channel";
import { InstagramError } from "../instagram";
import { renamedNotice } from "../instagram-links";

const BOT = "aaaaaaaa-0000-4000-8000-0000000000b1";
const NOW = Date.parse("2026-10-20T15:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
let tables: Record<string, MemRow[]>;
let db: SupabaseClient;

beforeEach(() => {
  meta.calls = [];
  meta.accounts = { "tok-loja": { igUserId: "1784", username: "boavozz" } };
  mail.sent = [];
  vi.spyOn(console, "warn").mockImplementation(() => {});
  tables = {
    bots: [{ id: BOT, name: "Lia", client_name: "BoaVoz", agency_id: "ag1" }],
    instagram_channels: [{ bot_id: BOT, ig_user_id: "1784", username: "boavoz.app", access_token_enc: "tok-loja", disconnected_at: null, username_checked_at: null }],
    sources: [{ id: "s1", bot_id: BOT, kind: "instagram", title: "Posts do Instagram (@boavoz.app)", url: "https://www.instagram.com/boavoz.app/" }],
    instagram_ref_links: [{ id: "l1", bot_id: BOT, ref: "qr-do-balcao", label: "QR do balcão" }],
  };
  db = memoryDb(tables);
});

describe("a troca do nome de usuário", () => {
  it("guarda o novo e o antigo, acerta a fonte dos posts e avisa a agência (há links com origem)", async () => {
    expect(await refreshInstagramUsername(db, BOT, { maxAgeMs: IG_USERNAME_PANEL_MS, now: NOW })).toEqual({ username: "boavozz", previousUsername: "boavoz.app", changedAt: iso(NOW) });
    expect(tables.instagram_channels[0]).toMatchObject({ username: "boavozz", previous_username: "boavoz.app", username_changed_at: iso(NOW), username_checked_at: iso(NOW) });
    expect(tables.sources[0]).toMatchObject({ title: "Posts do Instagram (@boavozz)", url: "https://www.instagram.com/boavozz/" });
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({ agency: "ag1", subject: "O Instagram de BoaVoz agora é @boavozz" });
    expect(mail.sent[0].lines.join("\n")).toContain("A conta @boavoz.app do chatbot Lia mudou o nome para @boavozz");
    expect(mail.sent[0].lines.join("\n")).toContain("não abrem mais o direct");
  });

  it("o título que a loja escreveu fica; sem links com origem, sem e-mail", async () => {
    tables.sources[0].title = "Vitrine da loja";
    tables.instagram_ref_links = [];
    expect(await refreshInstagramUsername(db, BOT, { maxAgeMs: IG_USERNAME_PANEL_MS, now: NOW })).toMatchObject({ username: "boavozz" });
    expect(tables.sources[0]).toMatchObject({ title: "Vitrine da loja", url: "https://www.instagram.com/boavozz/" });
    expect(mail.sent).toEqual([]);
  });

  it("nome igual: só marca a conferência; no painel, a próxima pergunta à Meta é depois de 1 minuto", async () => {
    meta.accounts["tok-loja"] = { igUserId: "1784", username: "boavoz.app" };
    expect(await refreshInstagramUsername(db, BOT, { maxAgeMs: IG_USERNAME_PANEL_MS, now: NOW })).toBeNull();
    expect(tables.instagram_channels[0]).toMatchObject({ username: "boavoz.app", username_checked_at: iso(NOW) });
    expect(tables.instagram_channels[0].previous_username).toBeUndefined();
    await refreshInstagramUsername(db, BOT, { maxAgeMs: IG_USERNAME_PANEL_MS, now: NOW + 30_000 });
    expect(meta.calls).toHaveLength(1);
    await refreshInstagramUsername(db, BOT, { maxAgeMs: IG_USERNAME_PANEL_MS, now: NOW + 61_000 });
    expect(meta.calls).toHaveLength(2);
  });

  it("a Meta não respondeu: fica o nome guardado e conta como conferida", async () => {
    meta.accounts["tok-loja"] = new InstagramError("The operation was aborted due to timeout");
    expect(await refreshInstagramUsername(db, BOT, { maxAgeMs: IG_USERNAME_PANEL_MS, now: NOW })).toBeNull();
    expect(tables.instagram_channels[0]).toMatchObject({ username: "boavoz.app", username_checked_at: iso(NOW) });
    expect(mail.sent).toEqual([]);
  });

  it("o token responde por outra conta ou sem nome: nada muda", async () => {
    meta.accounts["tok-loja"] = { igUserId: "9999", username: "outra.conta" };
    expect(await refreshInstagramUsername(db, BOT, { maxAgeMs: IG_USERNAME_PANEL_MS, now: NOW })).toBeNull();
    meta.accounts["tok-loja"] = { igUserId: "1784", username: null };
    expect(await refreshInstagramUsername(db, BOT, { maxAgeMs: IG_USERNAME_PANEL_MS, now: NOW + 120_000 })).toBeNull();
    expect(tables.instagram_channels[0].username).toBe("boavoz.app");
  });

  it("conta desconectada não pergunta à Meta", async () => {
    tables.instagram_channels[0].disconnected_at = iso(NOW - 3_600_000);
    expect(await refreshInstagramUsername(db, BOT, { maxAgeMs: IG_USERNAME_PANEL_MS, now: NOW })).toBeNull();
    expect(meta.calls).toEqual([]);
  });

  it("o painel e o cron ao mesmo tempo: a troca grava e avisa uma vez só", async () => {
    const both = await Promise.all([refreshInstagramUsername(db, BOT, { maxAgeMs: IG_USERNAME_PANEL_MS, now: NOW }), refreshInstagramUsername(db, BOT, { maxAgeMs: IG_USERNAME_PANEL_MS, now: NOW })]);
    expect(meta.calls).toHaveLength(2);
    expect(both.filter(Boolean)).toHaveLength(1);
    expect(tables.instagram_channels[0]).toMatchObject({ username: "boavozz", previous_username: "boavoz.app" });
    expect(mail.sent).toHaveLength(1);
  });
});

describe("o cron diário", () => {
  it("confere as contas paradas há mais de 20 h e pula a que o painel conferiu agora", async () => {
    const OTHER = "bbbbbbbb-0000-4000-8000-0000000000b2";
    tables.instagram_channels[0].username_checked_at = iso(Date.now() - 2 * 86_400_000);
    tables.instagram_channels.push({ bot_id: OTHER, ig_user_id: "1785", username: "padaria", access_token_enc: "tok-padaria", disconnected_at: null, username_checked_at: iso(Date.now() - 60_000) });
    meta.accounts["tok-padaria"] = { igUserId: "1785", username: "padaria.nova" };
    expect(await refreshInstagramUsernames(db)).toEqual({ checked: 1, renamed: 1 });
    expect(meta.calls).toEqual(["tok-loja"]);
    expect(tables.instagram_channels[1].username).toBe("padaria");
  });

  it("para quando o tempo acaba", async () => {
    expect(await refreshInstagramUsernames(db, () => false)).toEqual({ checked: 0, renamed: 0 });
    expect(meta.calls).toEqual([]);
  });
});

describe("o aviso do nome antigo no painel", () => {
  it("até 30 dias depois da troca, e só com o nome antigo guardado", () => {
    const ch = { username: "boavozz", previous_username: "boavoz.app", username_changed_at: iso(NOW) };
    expect(renamedNotice(ch, NOW + 86_400_000)).toEqual({ from: "boavoz.app", to: "boavozz", at: iso(NOW) });
    expect(renamedNotice(ch, NOW + 31 * 86_400_000)).toBeNull();
    expect(renamedNotice({ username: "boavozz", previous_username: null, username_changed_at: null }, NOW)).toBeNull();
  });
});
