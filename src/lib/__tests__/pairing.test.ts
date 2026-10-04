import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MAX_INVALID_CODES, PAIRING_ALPHABET, PAIRING_TEXTS, createPairing, handlePairing, isUnlinkCommand, linkLabel, matchLink, newPairingCode, pairingCommand, pairingLink, type LinkRow, type PairingIO } from "../pairing";
import { parsePairingBody, maskPhone } from "../api-pairing";
import { phoneHash } from "../contacts";

type Row = Record<string, unknown>;

/** Banco em memória com o pedaço do PostgREST que o pareamento usa. */
function memDb(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    const rows = (tables[table] ??= []);
    const filters: Array<(r: Row) => boolean> = [];
    let patch: Row | null = null;
    let inserted: Row[] | null = null;
    let max = Infinity;
    const run = () => {
      if (inserted) {
        rows.push(...inserted);
        const out = inserted;
        inserted = null;
        return out;
      }
      const hit = rows.filter((r) => filters.every((f) => f(r))).slice(0, max);
      if (patch) hit.forEach((r) => Object.assign(r, patch));
      return hit;
    };
    const b = {
      select: () => b,
      order: () => b,
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), b),
      is: (k: string, v: unknown) => (filters.push((r) => (r[k] ?? null) === v), b),
      gt: (k: string, v: string) => (filters.push((r) => String(r[k] ?? "") > v), b),
      lt: (k: string, v: string) => (filters.push((r) => String(r[k] ?? "") < v), b),
      in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k])), b),
      limit: (n: number) => ((max = n), b),
      update: (p: Row) => ((patch = p), b),
      insert: (r: Row | Row[]) => ((inserted = (Array.isArray(r) ? r : [r]).map((x) => ({ id: randomUUID(), created_at: new Date().toISOString(), linked_at: new Date().toISOString(), ...x }))), b),
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      single: async () => {
        const d = run()[0];
        return { data: d ?? null, error: d ? null : { message: "nenhuma linha" } };
      },
      then: (ok: (v: { data: Row[]; error: null }) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve({ data: run(), error: null }).then(ok, ko),
    };
    return b;
  };
  const rpc = async (_fn: string, a: { p_key: string; p_max: number }) => {
    const t = (tables.rate_limits ??= []);
    const window_start = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000).toISOString();
    let r = t.find((x) => x.key === a.p_key && x.window_start === window_start);
    if (!r) t.push((r = { key: a.p_key, window_start, hits: 0 }));
    r.hits = Number(r.hits) + 1;
    return { data: Number(r.hits) <= a.p_max, error: null };
  };
  return { from, rpc } as unknown as SupabaseClient;
}

const BOT = { id: "b0000000-0000-4000-8000-000000000001", agency_id: "a0000000-0000-4000-8000-000000000001" };
const CONTACT = "c0000000-0000-4000-8000-000000000001";

function setup(phone: string | null = "5521999999999") {
  const tables: Record<string, Row[]> = { contacts: [{ id: CONTACT, bot_id: BOT.id, active_link_id: null, phone_enc: phone, display: null }], conversations: [{ id: "conv-1", contact_id: CONTACT, last_message_at: new Date().toISOString() }], pairing_codes: [], contact_links: [], rate_limits: [] };
  const db = memDb(tables);
  const replies: Array<{ text: string; buttons?: Array<{ id: string; title: string }> }> = [];
  const stored: number[] = [];
  const io: PairingIO = {
    db,
    bot: BOT,
    channel: "whatsapp",
    contactId: CONTACT,
    phone,
    conversation: async () => "conv-1",
    store: async (i) => void stored.push(i),
    reply: async (_c, text, buttons) => void replies.push({ text, buttons }),
  };
  const pair = (o: Partial<{ externalId: string; display: Row; expectedPhone: string | null; context: Row | null }> = {}) =>
    createPairing(db, { botId: BOT.id, channel: "whatsapp", externalId: o.externalId ?? "user_42", context: (o.context as Record<string, unknown>) ?? { workspace_id: "ws_familia" }, display: (o.display as { name?: string }) ?? { name: "Ruan", workspace_name: "Família Portella" }, expectedPhone: o.expectedPhone ?? null, apiKeyId: null }, { phone: "+55 21 3333-4444" });
  return { tables, db, io, replies, stored, pair };
}

describe("comandos do pareamento", () => {
  it("código: 6 caracteres sem letras ambíguas", () => {
    for (let i = 0; i < 200; i++) {
      const code = newPairingCode();
      expect(code).toMatch(new RegExp(`^[${PAIRING_ALPHABET}]{6}$`));
      // sempre com um dígito: o código digitado sozinho é reconhecido
      expect(code).toMatch(/[0-9]/);
    }
    expect(PAIRING_ALPHABET).not.toMatch(/[01OIL]/);
  });

  it("'Conectar ABC123' é sempre tentativa; o código sozinho só com dígito", () => {
    expect(pairingCommand("Conectar ABC234")).toEqual({ code: "ABC234", explicit: true });
    expect(pairingCommand("  conectar abc234. ")).toEqual({ code: "ABC234", explicit: true });
    expect(pairingCommand("ABC234")).toEqual({ code: "ABC234", explicit: false });
    expect(pairingCommand("BANANA")).toBeNull();
    expect(pairingCommand("Conectar")).toBeNull();
    expect(pairingCommand("quero conectar ABC234 hoje")).toBeNull();
  });

  it("'desconectar' sozinho ou com este WhatsApp; pergunta não conta", () => {
    expect(isUnlinkCommand("desconectar")).toBe(true);
    expect(isUnlinkCommand("Desconectar este WhatsApp!")).toBe(true);
    expect(isUnlinkCommand("desvincular minha conta")).toBe(true);
    expect(isUnlinkCommand("como faço para desconectar?")).toBe(false);
  });

  it("links: wa.me com o texto pronto, ig.me com o ref", () => {
    expect(pairingLink("whatsapp", { phone: "+55 21 3333-4444" }, "ABC234")).toBe("https://wa.me/552133334444?text=Conectar%20ABC234");
    expect(pairingLink("instagram", { username: "fintrabr" }, "ABC234")).toBe("https://ig.me/fintrabr?ref=ABC234");
    expect(pairingLink("instagram", { username: null }, "ABC234")).toBeNull();
  });

  it("rótulo e escolha da conta na troca", () => {
    expect(linkLabel({ name: "Ruan", workspace_name: "Família Portella" })).toBe("Família Portella");
    expect(linkLabel({ name: "Ruan" })).toBe("a conta de Ruan");
    expect(linkLabel({ name: "Ruan", workspace_name: "Família" }, { byName: true })).toBe("a conta de Ruan");
    const l = (id: string, ws: string) => ({ id, display: { workspace_name: ws } }) as unknown as LinkRow;
    const links = [l("1", "Família Portella"), l("2", "Empresa Portella"), l("3", "Clínica")];
    expect(matchLink(links, "empresa")).toEqual({ link: links[1] });
    expect(matchLink(links, "portella")).toEqual({ options: ["Família Portella", "Empresa Portella"] });
    expect(matchLink(links, "padaria")).toEqual({ options: ["Família Portella", "Empresa Portella", "Clínica"] });
  });
});

describe("pareamento no WhatsApp", () => {
  beforeEach(() => vi.stubEnv("CONTACT_HASH_KEY", "chave-de-teste-com-mais-de-16"));

  it("código certo: vincula, vira o contexto ativo e a conversa entra nele", async () => {
    const s = setup();
    const p = await s.pair();
    expect(p.link).toBe(`https://wa.me/552133334444?text=Conectar%20${p.code}`);
    const handled = await handlePairing(s.io, [{ text: `Conectar ${p.code}`, buttonId: null }]);
    expect([...handled]).toEqual([0]);
    expect(s.replies[0].text).toBe(PAIRING_TEXTS.linked("whatsapp", "Família Portella"));
    const link = s.tables.contact_links[0];
    expect(link).toMatchObject({ contact_id: CONTACT, channel: "whatsapp", display: { name: "Ruan", workspace_name: "Família Portella" } });
    expect(s.tables.contacts[0].active_link_id).toBe(link.id);
    expect(s.tables.conversations[0]).toMatchObject({ context_source: "pairing", context_display: "Família Portella" });
    // uso único
    await handlePairing(s.io, [{ text: `Conectar ${p.code}`, buttonId: null }]);
    expect(s.replies[1].text).toBe(PAIRING_TEXTS.invalid);
  });

  it("código errado: avisa; depois de 5 na hora, nenhum código é aceito (sem resposta)", async () => {
    const s = setup();
    for (let i = 0; i < MAX_INVALID_CODES; i++) await handlePairing(s.io, [{ text: "Conectar ZZZ999", buttonId: null }]);
    expect(s.replies).toHaveLength(MAX_INVALID_CODES);
    const p = await s.pair();
    await handlePairing(s.io, [{ text: `Conectar ${p.code}`, buttonId: null }]);
    expect(s.replies).toHaveLength(MAX_INVALID_CODES);
    expect(s.tables.contact_links).toHaveLength(0);
  });

  it("palavra solta de 6 letras não vira tentativa; o código solto que existe vale", async () => {
    const s = setup();
    expect((await handlePairing(s.io, [{ text: "ABC234", buttonId: null }])).size).toBe(0);
    const p = await s.pair();
    expect((await handlePairing(s.io, [{ text: p.code, buttonId: null }])).size).toBe(1);
    expect(s.tables.contact_links).toHaveLength(1);
  });

  it("telefone esperado: outro número é recusado; sem telefone, avisa", async () => {
    const s = setup("5521988887777");
    const p = await s.pair({ expectedPhone: "21999999999" });
    await handlePairing(s.io, [{ text: `Conectar ${p.code}`, buttonId: null }]);
    expect(s.replies[0].text).toBe(PAIRING_TEXTS.otherPhone);
    const s2 = setup(null);
    const p2 = await s2.pair({ expectedPhone: "21999999999" });
    await handlePairing(s2.io, [{ text: `Conectar ${p2.code}`, buttonId: null }]);
    expect(s2.replies[0].text).toBe(PAIRING_TEXTS.noPhone);
    // o número certo passa
    const s3 = setup("5521999999999");
    const p3 = await s3.pair({ expectedPhone: "21999999999" });
    expect(s3.tables.pairing_codes[0].expected_phone_hash).toBe(phoneHash("5521999999999"));
    await handlePairing(s3.io, [{ text: `Conectar ${p3.code}`, buttonId: null }]);
    expect(s3.tables.contact_links).toHaveLength(1);
  });

  it("golpe inverso: já conectado a outra pessoa, pede confirmação; Cancelar não conecta, Conectar conecta", async () => {
    const s = setup();
    await handlePairing(s.io, [{ text: `Conectar ${(await s.pair()).code}`, buttonId: null }]);
    const p = await s.pair({ externalId: "user_99", display: { name: "Maria", workspace_name: "Empresa da Maria" } });
    await handlePairing(s.io, [{ text: `Conectar ${p.code}`, buttonId: null }]);
    const ask = s.replies[1];
    expect(ask.text).toBe(PAIRING_TEXTS.confirm("a conta de Ruan", "a conta de Maria"));
    expect(ask.buttons?.map((b) => b.title)).toEqual(["Conectar", "Cancelar"]);
    await handlePairing(s.io, [{ text: "Cancelar", buttonId: ask.buttons![1].id }]);
    expect(s.replies[2].text).toBe(PAIRING_TEXTS.cancelled);
    expect(s.tables.contact_links.filter((l) => !l.unlinked_at)).toHaveLength(1);
    await handlePairing(s.io, [{ text: "Conectar", buttonId: ask.buttons![0].id }]);
    expect(s.replies[3].text).toBe(PAIRING_TEXTS.linked("whatsapp", "Empresa da Maria"));
    expect(s.tables.contact_links.filter((l) => !l.unlinked_at)).toHaveLength(2);
  });

  it("'desconectar': desfaz o vínculo ativo e diz o que sobrou", async () => {
    const s = setup();
    await handlePairing(s.io, [{ text: "desconectar", buttonId: null }]);
    expect(s.replies[0].text).toBe(PAIRING_TEXTS.notLinked("whatsapp"));
    await handlePairing(s.io, [{ text: `Conectar ${(await s.pair()).code}`, buttonId: null }]);
    await handlePairing(s.io, [{ text: "Desconectar este WhatsApp", buttonId: null }]);
    expect(s.replies[2].text).toBe(PAIRING_TEXTS.unlinked("whatsapp", "Família Portella", []));
    expect(s.tables.contact_links[0]).toMatchObject({ unlink_reason: "chat" });
    expect(s.tables.contacts[0].active_link_id).toBeNull();
    // a conversa sai do contexto (trecho novo, sem a conta)
    expect(s.tables.conversations[0]).toMatchObject({ context_source: null, identity_hash: null });
  });
});

describe("API de pareamento", () => {
  it("corpo do POST /v1/pairings", () => {
    expect(parsePairingBody({ channel: "whatsapp", external_id: "user_42", display: { name: "Ruan" }, expected_phone: "21 99999-9999" })).toMatchObject({ channel: "whatsapp", externalId: "user_42", expectedPhone: "5521999999999" });
    expect(() => parsePairingBody({ channel: "telegram", external_id: "x" })).toThrow(/channel/);
    expect(() => parsePairingBody({ channel: "whatsapp" })).toThrow(/external_id/);
    expect(() => parsePairingBody({ channel: "instagram", external_id: "x", expected_phone: "21999999999" })).toThrow(/só no WhatsApp/);
    expect(() => parsePairingBody({ channel: "whatsapp", external_id: "x", context: { blob: "x".repeat(2100) } })).toThrow(/2 KB/);
    expect(maskPhone("5521999991234")).toBe("*********1234");
  });
});
