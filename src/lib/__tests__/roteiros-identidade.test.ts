import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readIdentity, readResponse, type ActionIdentity } from "../actions";
import { routineInputFromJson, type RoutineRow } from "../routines";
import { routinePreTurn, routineSession } from "../routine-engine";
import {
  CHECK_NO,
  CHECK_YES,
  CONSENT_NO,
  IDENTITY_NOTES,
  IDENTITY_TEXTS,
  IDENTITY_TTL_MS,
  accountButtons,
  chatIdentityOfState,
  checkButtons,
  consentButtons,
  consentPrompt,
  consentYes,
  identityPort,
  identityPreTurn,
  loadConversationIdentity,
  markConsentAsked,
  matchAccount,
  parseIdentityButton,
  stateOf,
  typedYesNo,
} from "../routine-identity";
import { PAIRING_TEXTS, handlePairing, linkColumnsForContact } from "../pairing";
import { callerFor } from "../action-tools";
import type { MessageComponent, OptionItem } from "../components";

/* ------------------------------------------------------------------ puras */

const TWO: ActionIdentity = {
  externalId: "cli_teste_1",
  name: "Cliente Teste",
  accounts: [
    { label: "Rua das Flores, 10", context: { uc: "1001" } },
    { label: "Av. Brasil, 200", context: { uc: "1002" } },
  ],
};
const ONE: ActionIdentity = { externalId: "cli_teste_2", name: "Pessoa Teste", accounts: [{ label: "Rua do Sol, 5", context: { uc: "2001" } }] };

const opts = (c: MessageComponent | null | undefined): OptionItem[] => (c?.type === "options" ? c.options : []);

describe("identificação pelo roteiro: o que a ação devolve", () => {
  it("identity conferida: id (texto ou número), nome e contas; conta sem nome nem contexto sai", () => {
    expect(readIdentity({ external_id: "cli_1", name: "  Ana   Souza ", accounts: [{ label: "Rua A, 1", context: { uc: "1" } }, { label: "", context: null }, "x", { context: { uc: "2" } }] })).toEqual({
      externalId: "cli_1",
      name: "Ana Souza",
      accounts: [
        { label: "Rua A, 1", context: { uc: "1" } },
        { label: null, context: { uc: "2" } },
      ],
    });
    expect(readIdentity({ external_id: 42 })).toEqual({ externalId: "42", name: null, accounts: [] });
    expect(readIdentity({ external_id: "" })).toBeNull();
    expect(readIdentity({ external_id: "x".repeat(201) })).toBeNull();
    expect(readIdentity({ name: "Ana" })).toBeNull();
    expect(readIdentity([{ external_id: "a" }])).toBeNull();
    // contexto acima de 2 KB não vai para as ações
    expect(readIdentity({ external_id: "a", accounts: [{ label: "Grande", context: { x: "y".repeat(3000) } }] })?.accounts).toEqual([{ label: "Grande", context: null }]);
    // até 10 contas (a lista do WhatsApp)
    expect(readIdentity({ external_id: "a", accounts: Array.from({ length: 12 }, (_, i) => ({ label: `Conta ${i}` })) })?.accounts).toHaveLength(10);
  });

  it("a resposta da ação traz a identity junto do data", () => {
    const r = readResponse(200, JSON.stringify({ data: { ok: 1 }, identity: { external_id: "cli_1", name: "Ana" } }));
    expect(r).toMatchObject({ status: "ok", data: { ok: 1 }, identity: { externalId: "cli_1", name: "Ana", accounts: [] } });
    expect(readResponse(200, JSON.stringify({ data: {} }))).not.toHaveProperty("identity");
  });

  it("o passo marca 'pular se identificada' (dado e ação)", () => {
    const r = routineInputFromJson(
      JSON.stringify({
        name: "Fatura",
        when_to_use: "O cliente quer a fatura da conta",
        keywords: [],
        steps: [
          { id: "aaaa0001", type: "dado", text: "Peça o CPF", kind: "cpf", variable: "documento", skip_identified: true },
          { id: "aaaa0002", type: "acao", text: "Identifique", action: "identificar_cliente", results: {}, skip_identified: true },
          { id: "aaaa0003", type: "instrucao", text: "Diga oi", skip_identified: true },
        ],
      }),
    );
    if ("error" in r) throw new Error(r.error);
    expect(r.steps[0]).toMatchObject({ skip_identified: true });
    expect(r.steps[1]).toMatchObject({ skip_identified: true });
    expect(r.steps[2]).not.toHaveProperty("skip_identified");
  });
});

describe("identificação pelo roteiro: botões, respostas e contas (puras)", () => {
  beforeEach(() => vi.stubEnv("CONTACT_HASH_KEY", "chave-de-teste-com-mais-de-16"));

  it("uma conta já é a escolhida; com duas, a pessoa escolhe; a IA vê o nome e a conta, as ações o contexto", () => {
    expect(stateOf(ONE, false).active).toBe(0);
    const two = stateOf(TWO, false);
    expect(two.active).toBe(null);
    expect(chatIdentityOfState(two)).toEqual({ externalId: "cli_teste_1", userDisplay: { name: "Cliente Teste" }, contextDisplay: null, context: null, source: "routine", ageVerified: null, otherContexts: [] });
    expect(chatIdentityOfState({ ...two, active: 1 })).toMatchObject({ contextDisplay: "Av. Brasil, 200", context: { uc: "1002" }, otherContexts: ["Rua das Flores, 10"] });
    // conta sem nome no botão vira "Conta 2"
    expect(opts(accountButtons({ ...two, accounts: [two.accounts[0], { label: null, context: { uc: "9" } }] })).map((o) => o.title)).toEqual(["Rua das Flores, 10", "Conta 2"]);
  });

  it("os ids dos botões voltam sem a IA; o toque antigo de outra pessoa não confunde", () => {
    const two = stateOf(TWO, false);
    const [a, b] = opts(accountButtons(two));
    expect(parseIdentityButton(b.id)).toMatchObject({ kind: "conta", index: 1 });
    expect(parseIdentityButton(a.id)).not.toEqual(parseIdentityButton(opts(accountButtons(stateOf(ONE, false)))[0].id));
    const [yes, no] = opts(consentButtons("whatsapp", two));
    expect([yes.title, no.title]).toEqual(["Lembrar este número", CONSENT_NO]);
    expect(opts(consentButtons("instagram", two))[0].title).toBe("Lembrar este perfil");
    expect(parseIdentityButton(yes.id)).toMatchObject({ kind: "lembrar" });
    const link = randomUUID();
    const [eu, outra] = opts(checkButtons(link));
    expect([eu.title, outra.title]).toEqual([CHECK_YES, CHECK_NO]);
    // botões de até 20 caracteres (WhatsApp e Instagram)
    for (const t of [eu.title, outra.title, consentYes("whatsapp"), consentYes("instagram"), CONSENT_NO]) expect(t.length).toBeLessThanOrEqual(20);
    expect(parseIdentityButton(outra.id)).toEqual({ kind: "outra", linkId: link });
    expect(parseIdentityButton("idn:conta:xyz:1")).toBeNull();
    expect(parseIdentityButton("rt:abc")).toBeNull();
  });

  it("sim e não digitados; a conta pelo nome", () => {
    expect(typedYesNo("Sim, sou eu!")).toBe("sim");
    expect(typedYesNo("pode lembrar")).toBe("sim");
    expect(typedYesNo("Não")).toBe("nao");
    expect(typedYesNo("sou outra pessoa")).toBe("nao");
    expect(typedYesNo("sim, mas qual o horário?")).toBeNull();
    const two = { ...stateOf(TWO, false), active: 0 };
    expect(matchAccount(two, "a da avenida brasil")).toEqual({ options: ["Rua das Flores, 10", "Av. Brasil, 200"] });
    expect(matchAccount(two, "Av. Brasil")).toEqual({ index: 1 });
    expect(matchAccount(two, "outra")).toEqual({ options: ["Rua das Flores, 10", "Av. Brasil, 200"] });
  });

  it("a licença só no WhatsApp e no Instagram, com a conta escolhida e o número ainda não lembrado", () => {
    const one = stateOf(ONE, false);
    expect(consentPrompt("whatsapp", { state: one, consent: "due" })).toEqual({ text: IDENTITY_TEXTS.consent("whatsapp"), component: consentButtons("whatsapp", one) });
    expect(consentPrompt("instagram", { state: one, consent: "due" })?.text).toContain("deste perfil");
    expect(consentPrompt("widget", { state: one, consent: "due" })).toBeNull();
    expect(consentPrompt("whatsapp", { state: one, consent: "asked" })).toBeNull();
    expect(consentPrompt("whatsapp", { state: { ...one, remembered: true }, consent: "due" })).toBeNull();
    expect(consentPrompt("whatsapp", { state: stateOf(TWO, false), consent: "due" })).toBeNull();
  });
});

/* ------------------------------------------------------------------ com o banco (falso) */

type Row = Record<string, unknown>;
let tick = 0;
const stamp = () => new Date(Date.UTC(2026, 9, 19, 12, 0, 0, tick++)).toISOString();

/** Banco em memória com o que o roteiro, a identificação e os vínculos usam. */
function fakeDb(tables: Record<string, Row[]>) {
  class Q {
    filters: Array<(r: Row) => boolean> = [];
    op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
    patch: Row = {};
    rows: Row[] = [];
    conflict = "id";
    orderBy: { col: string; asc: boolean } | null = null;
    lim = 0;
    embed = false;
    constructor(public table: string) {}
    select(cols?: string) {
      if (this.op === "select") this.embed = Boolean(cols?.includes("routines("));
      return this;
    }
    insert(r: Row | Row[]) {
      this.op = "insert";
      this.rows = Array.isArray(r) ? r : [r];
      return this;
    }
    upsert(r: Row, o?: { onConflict?: string }) {
      this.op = "upsert";
      this.rows = [r];
      this.conflict = o?.onConflict ?? "id";
      return this;
    }
    update(p: Row) {
      this.op = "update";
      this.patch = p;
      return this;
    }
    delete() {
      this.op = "delete";
      return this;
    }
    eq(c: string, v: unknown) {
      this.filters.push((r) => r[c] === v);
      return this;
    }
    neq(c: string, v: unknown) {
      this.filters.push((r) => r[c] !== v);
      return this;
    }
    in(c: string, vs: unknown[]) {
      this.filters.push((r) => vs.includes(r[c]));
      return this;
    }
    lt(c: string, v: string) {
      this.filters.push((r) => typeof r[c] === "string" && (r[c] as string) < v);
      return this;
    }
    gt(c: string, v: string) {
      this.filters.push((r) => typeof r[c] === "string" && (r[c] as string) > v);
      return this;
    }
    is(c: string, v: unknown) {
      this.filters.push((r) => (r[c] ?? null) === v);
      return this;
    }
    not(c: string, op: string, v: unknown) {
      if (op === "is") this.filters.push((r) => (r[c] ?? null) !== v);
      return this;
    }
    order(c: string, o?: { ascending?: boolean }) {
      this.orderBy = { col: c, asc: o?.ascending !== false };
      return this;
    }
    limit(n: number) {
      this.lim = n;
      return this;
    }
    async maybeSingle() {
      const r = await this.exec();
      return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error };
    }
    async single() {
      const r = await this.exec();
      const d = r.data as Row[] | null;
      return d?.length ? { data: d[0], error: null } : { data: null, error: r.error ?? { message: "sem linha" } };
    }
    then<A, B>(res: (v: { data: unknown; error: unknown }) => A, rej?: (e: unknown) => B) {
      return this.exec().then(res, rej);
    }
    async exec(): Promise<{ data: unknown; error: { message: string } | null }> {
      const t = (tables[this.table] ??= []);
      if (this.op === "insert") {
        const out: Row[] = [];
        for (const r of this.rows) {
          const defaults: Row =
            this.table === "routine_runs"
              ? { status: "active", attempts: 0, failing: false, variables_enc: null, end_reason: null, ended_at: null, held_result: null }
              : this.table === "contact_links"
                ? { linked_at: stamp(), unlinked_at: null, source: "pairing", identity_key_hash: null }
                : {};
          const row: Row = { id: randomUUID(), ...defaults, ...r };
          if (this.table === "routine_runs" && t.some((x) => x.conversation_id === row.conversation_id && x.status === "active")) return { data: null, error: { message: "duplicate key value violates unique constraint" } };
          t.push(row);
          out.push(row);
        }
        return { data: out, error: null };
      }
      if (this.op === "upsert") {
        const r = this.rows[0];
        const hit = t.find((x) => x[this.conflict] === r[this.conflict]);
        if (hit) Object.assign(hit, r);
        else t.push({ ...r });
        return { data: null, error: null };
      }
      let rows = t.filter((r) => this.filters.every((f) => f(r)));
      if (this.op === "update") {
        for (const r of rows) Object.assign(r, this.patch);
        return { data: rows.map((r) => ({ ...r })), error: null };
      }
      if (this.op === "delete") {
        tables[this.table] = t.filter((r) => !rows.includes(r));
        return { data: rows.map((r) => ({ ...r })), error: null };
      }
      if (this.orderBy) {
        const { col, asc } = this.orderBy;
        rows = [...rows].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1));
      }
      if (this.lim) rows = rows.slice(0, this.lim);
      return { data: rows.map((r) => (this.embed ? { ...r, routines: (tables.routines ?? []).find((x) => x.id === r.routine_id) ?? null } : { ...r })), error: null };
    }
  }
  return { from: (t: string) => new Q(t) } as unknown as SupabaseClient;
}

const BOT = { id: "bot-1", agency_id: "ag-1" };
const CONTACT = "c0000000-0000-4000-8000-000000000001";
const OLD = "2026-10-01T00:00:00.000Z";

/** Fatura: CPF e identificação (pulados com a pessoa já identificada) e a fatura da conta. */
const FATURA = {
  id: "rot-1",
  bot_id: BOT.id,
  name: "Fatura",
  when_to_use: "O cliente quer a fatura ou a segunda via da conta",
  keywords: ["fatura"],
  active: true,
  template: null,
  created_at: OLD,
  updated_at: OLD,
  steps: [
    { id: "fatu0001", type: "dado", text: "Peça o CPF do titular", kind: "cpf", variable: "documento", pattern: null, next: { to: "proximo" }, skip_identified: true },
    { id: "fatu0002", type: "acao", text: "Identifique a pessoa", action: "identificar_cliente", results: { ok: { to: "proximo" }, nao_encontrado: { to: "atendente" }, erro: { to: "atendente" } }, skip_identified: true },
    { id: "fatu0003", type: "acao", text: "Busque a fatura da conta", action: "buscar_fatura", results: { ok: { to: "encerrar" }, nao_encontrado: { to: "atendente" }, erro: { to: "atendente" } } },
  ],
} as RoutineRow & Row;

function world() {
  const now = new Date().toISOString();
  const tables: Record<string, Row[]> = {
    routines: [FATURA],
    agency_packs: [{ agency_id: BOT.agency_id, pack: "integracoes", ends_at: null }],
    messages: [],
    conversations: ["conv-1", "conv-2", "conv-3"].map((id) => ({ id, contact_id: CONTACT, last_message_at: now })),
    contacts: [{ id: CONTACT, bot_id: BOT.id, active_link_id: null, display: null }],
    contact_links: [],
    conversation_identities: [],
    routine_runs: [],
  };
  return { tables, db: fakeDb(tables) };
}

const pre = (db: SupabaseClient, conv: string, texts: string[], o: { buttonId?: string | null; identity?: { identified: boolean; choosing: boolean } } = {}) =>
  routinePreTurn(db, { bot: BOT, conversationId: conv, texts, buttonId: o.buttonId ?? null, waPhone: null, identity: o.identity });
const idPre = (db: SupabaseClient, conv: string, text: string, o: { buttonId?: string | null; channel?: string; external?: boolean } = {}) =>
  identityPreTurn(db, { bot: BOT, channel: o.channel ?? "whatsapp", conversationId: conv, contactId: CONTACT, buttonId: o.buttonId ?? null, text, texts: [text], consume: true, external: o.external ?? false });
const portOf = async (db: SupabaseClient, conv: string, channel = "whatsapp") =>
  identityPort(db, { conversationId: conv, botId: BOT.id, contactId: CONTACT, channel, initial: await loadConversationIdentity(db, conv), external: null });

/** Na conversa 1: CPF, a ação identifica com as duas contas, a pessoa escolhe a segunda. */
async function identifiedInConv1(db: SupabaseClient) {
  await pre(db, "conv-1", ["fatura"]);
  const t = await pre(db, "conv-1", ["529.982.247-25"]);
  const p = await portOf(db, "conv-1");
  const s = routineSession(db, { bot: BOT, conversationId: "conv-1", waPhone: null, turn: t, texts: [], requestHandoff: async () => "aviso", identity: p })!;
  const out = await s.onActionResult("identificar_cliente", { status: "ok", identity: TWO }, []);
  const second = opts(accountButtons(stateOf(TWO, false)))[1];
  return { t, p, s, out, second };
}

/** Número lembrado: identificou, escolheu a segunda conta e tocou em "Lembrar este número". */
async function rememberedNumber(db: SupabaseClient) {
  const { second } = await identifiedInConv1(db);
  await idPre(db, "conv-1", second.title, { buttonId: second.id });
  await markConsentAsked(db, { conversationId: "conv-1", botId: BOT.id, contactId: CONTACT });
  const [yes] = opts(consentButtons("whatsapp", stateOf(TWO, false)));
  return idPre(db, "conv-1", yes.title, { buttonId: yes.id });
}

describe("identificação pelo roteiro: na conversa", () => {
  beforeEach(() => vi.stubEnv("CONTACT_HASH_KEY", "chave-de-teste-com-mais-de-16"));

  it("a ação identifica com duas contas: o roteiro espera a escolha (botões das contas); escolhida, segue para a fatura", async () => {
    const { tables, db } = world();
    const { t, p, s, out, second } = await identifiedInConv1(db);
    expect(t.run?.stepId).toBe("fatu0002");
    expect(out).toMatchObject({ ok: true, identificacao: "escolher_conta" });
    expect(String(out!.instrucao)).toContain("tem 2 contas");
    expect(tables.routine_runs[0]).toMatchObject({ step_id: "fatu0002", held_result: "ok", status: "active" });
    expect(s.component()).toEqual(accountButtons(stateOf(TWO, false)));
    expect(s.prompt()).toContain("esperando a pessoa escolher a conta");
    expect(s.blocksOptions()).toBe(true);
    expect(s.actionStep()).toBeNull();
    expect(s.upcoming()).toEqual([]);
    expect(p.choosing()).toBe(true);
    expect(p.current()).toMatchObject({ externalId: "cli_teste_1", context: null, source: "routine" });
    // a licença fica para depois da escolha
    expect(p.consentPrompt()).toBeNull();
    expect(tables.conversation_identities[0]).toMatchObject({ conversation_id: "conv-1", contact_id: CONTACT, consent: "due" });

    // escreveu outra coisa: o roteiro não anda
    expect(await idPre(db, "conv-1", "qual o horário?")).toEqual({ kind: "none", note: null, consumed: false });
    const still = await pre(db, "conv-1", ["qual o horário?"], { identity: { identified: true, choosing: true } });
    expect(still.run?.heldResult).toBe("ok");

    // tocou na segunda conta: a conversa fica nela e o roteiro segue pelo "ok" da ação
    expect(await idPre(db, "conv-1", second.title, { buttonId: second.id })).toEqual({ kind: "none", note: IDENTITY_NOTES.chose("Av. Brasil, 200"), consumed: true });
    const after = await pre(db, "conv-1", [second.title], { identity: { identified: true, choosing: false } });
    expect(after.run?.stepId).toBe("fatu0003");
    expect(tables.routine_runs[0].held_result).toBeNull();
    const p2 = await portOf(db, "conv-1");
    expect(p2.current()).toMatchObject({ contextDisplay: "Av. Brasil, 200", context: { uc: "1002" }, otherContexts: ["Rua das Flores, 10"] });
    expect(p2.consentPrompt()).toEqual({ text: IDENTITY_TEXTS.consent("whatsapp"), component: consentButtons("whatsapp", stateOf(TWO, false)) });
    // com duas contas e uma escolhida, a IA pode trocar
    expect(Object.keys(p2.switchTool())).toEqual(["trocar_contexto"]);
  });

  it("a escolha digitada vale só com os botões das contas na última mensagem", async () => {
    const { tables, db } = world();
    const { s } = await identifiedInConv1(db);
    expect(await idPre(db, "conv-1", "2")).toEqual({ kind: "none", note: null, consumed: false });
    tables.messages.push({ id: 10, conversation_id: "conv-1", role: "assistant", components_enc: JSON.stringify(s.component()), blocked_reason: null, failed_at: null, deleted_at: null });
    expect(await idPre(db, "conv-1", "2")).toEqual({ kind: "none", note: IDENTITY_NOTES.chose("Av. Brasil, 200"), consumed: true });
  });

  it("uma conta só, no site: identifica e segue o roteiro na mesma vez; as ações saem com a pessoa (sem licença: não há número)", async () => {
    const { tables, db } = world();
    await pre(db, "conv-1", ["fatura"]);
    const t = await pre(db, "conv-1", ["111.444.777-35"]);
    const p = await portOf(db, "conv-1", "widget");
    const s = routineSession(db, { bot: BOT, conversationId: "conv-1", waPhone: null, turn: t, texts: [], requestHandoff: async () => "aviso", identity: p })!;
    expect(s.upcoming()).toEqual(["buscar_fatura"]);
    const out = await s.onActionResult("identificar_cliente", { status: "ok", identity: ONE }, []);
    expect(out).toMatchObject({ ok: true, passo: "3 de 3" });
    expect(String(out!.instrucao)).toContain("A pessoa foi identificada (Pessoa Teste)");
    expect(p.current()).toMatchObject({ externalId: "cli_teste_2", contextDisplay: "Rua do Sol, 5", context: { uc: "2001" }, source: "routine" });
    expect(p.consentPrompt()).toBeNull();
    expect(tables.conversation_identities[0].consent).toBeNull();
    const caller = await callerFor(db, { bot: BOT, conversationId: "conv-1", channel: "widget", waPhone: null, age: null, identity: p.current() });
    expect(caller).toMatchObject({ level: "usuario", hasContext: true, contact: { verified_by: "routine", external_id: "cli_teste_2" }, context: { source: "routine", data: { uc: "2001" } } });
  });

  it("outra pessoa na mesma conversa: trecho novo (a IA não lê o que era da anterior); identidade de fora (pareamento) vence", async () => {
    const { tables, db } = world();
    const p = await portOf(db, "conv-1");
    await p.apply(ONE);
    expect(tables.conversations[0].context_since).toBeUndefined();
    await p.apply(TWO);
    expect(typeof tables.conversations[0].context_since).toBe("string");
    const paired = identityPort(db, { conversationId: "conv-2", botId: BOT.id, contactId: CONTACT, channel: "whatsapp", initial: await loadConversationIdentity(db, "conv-2"), external: chatIdentityOfState(stateOf(ONE, true)) });
    expect(await paired.apply(TWO)).toBeNull();
    expect(paired.identified()).toBe(true);
    expect(paired.current()?.externalId).toBe("cli_teste_2");
  });

  it("a identidade da conversa vale 24 horas", async () => {
    const { db } = world();
    const p = await portOf(db, "conv-1");
    await p.apply(ONE);
    expect((await loadConversationIdentity(db, "conv-1")).state?.externalId).toBe("cli_teste_2");
    expect((await loadConversationIdentity(db, "conv-1", Date.now() + IDENTITY_TTL_MS + 60_000)).state).toBeNull();
  });
});

describe("identificação pelo roteiro: lembrar o número", () => {
  beforeEach(() => vi.stubEnv("CONTACT_HASH_KEY", "chave-de-teste-com-mais-de-16"));

  it("'Lembrar este número': um vínculo por conta (source routine) e a escolhida fica ativa; sem duplicar; a conversa nova não nasce nela", async () => {
    const { tables, db } = world();
    expect(await rememberedNumber(db)).toEqual({ kind: "fixed", text: IDENTITY_TEXTS.remembered("whatsapp"), component: null });
    const links = tables.contact_links;
    expect(links).toHaveLength(2);
    expect(links.every((l) => l.source === "routine" && l.channel === "whatsapp" && l.external_id_enc === "cli_teste_1" && l.contact_id === CONTACT)).toBe(true);
    expect(links.map((l) => l.display)).toEqual([
      { name: "Cliente Teste", workspace_name: "Rua das Flores, 10" },
      { name: "Cliente Teste", workspace_name: "Av. Brasil, 200" },
    ]);
    expect(links.map((l) => JSON.parse(String(l.context_enc)))).toEqual([{ uc: "1001" }, { uc: "1002" }]);
    expect(tables.contacts[0].active_link_id).toBe(links[1].id);
    expect((await loadConversationIdentity(db, "conv-1")).state?.remembered).toBe(true);
    // tocou de novo: não duplica
    const [yes] = opts(consentButtons("whatsapp", stateOf(TWO, false)));
    await idPre(db, "conv-1", yes.title, { buttonId: yes.id });
    expect(tables.contact_links).toHaveLength(2);
    // a conversa nova não entra sozinha na conta lembrada (espera o "Sim, sou eu")
    expect(await linkColumnsForContact(db, CONTACT)).toEqual({});
  });

  it("'Não lembrar': nada fica guardado; a identificação segue só nesta conversa", async () => {
    const { tables, db } = world();
    const { second } = await identifiedInConv1(db);
    await idPre(db, "conv-1", second.title, { buttonId: second.id });
    await markConsentAsked(db, { conversationId: "conv-1", botId: BOT.id, contactId: CONTACT });
    const [, no] = opts(consentButtons("whatsapp", stateOf(TWO, false)));
    expect(await idPre(db, "conv-1", no.title, { buttonId: no.id })).toEqual({ kind: "fixed", text: IDENTITY_TEXTS.notRemembered, component: null });
    expect(tables.contact_links).toHaveLength(0);
    const after = await loadConversationIdentity(db, "conv-1");
    expect(after).toMatchObject({ consent: null, state: { externalId: "cli_teste_1", remembered: false, active: 1 } });
    // a conversa nova não pergunta nada
    expect(await idPre(db, "conv-2", "oi")).toEqual({ kind: "none", note: null, consumed: false });
  });

  it("conversa nova de número lembrado: 'Estou falando com...?' antes de tudo; 'Sim, sou eu' responde à mensagem que esperava e o roteiro pula a identificação", async () => {
    const { tables, db } = world();
    await rememberedNumber(db);
    const active = String(tables.contacts[0].active_link_id);
    const ask = await idPre(db, "conv-2", "fatura");
    expect(ask).toEqual({ kind: "fixed", text: "Estou falando com Cliente Teste?", component: checkButtons(active) });
    // perguntou uma vez: sem resposta, a próxima mensagem segue sem conta
    expect(await idPre(db, "conv-2", "oi?")).toEqual({ kind: "none", note: IDENTITY_NOTES.checkPending, consumed: false });
    const [eu] = opts(checkButtons(active));
    expect(await idPre(db, "conv-2", eu.title, { buttonId: eu.id })).toEqual({ kind: "resume", text: "fatura", texts: ["fatura"], note: null });
    expect((await loadConversationIdentity(db, "conv-2")).state).toEqual({ externalId: "cli_teste_1", name: "Cliente Teste", accounts: TWO.accounts, active: 1, remembered: true });
    // a palavra-chave que esperava começa o roteiro, que pula o CPF e a identificação
    const t = await pre(db, "conv-2", ["fatura"], { identity: { identified: true, choosing: false } });
    expect(t.run?.stepId).toBe("fatu0003");
    expect(t.run?.variables).toEqual({});
    // sem a pessoa identificada, o roteiro pede o CPF
    const fresh = await pre(db, "conv-3", ["fatura"]);
    expect(fresh.run?.stepId).toBe("fatu0001");
  });

  it("'sim' digitado logo depois da pergunta também vale", async () => {
    const { tables, db } = world();
    await rememberedNumber(db);
    const ask = await idPre(db, "conv-2", "minha fatura");
    tables.messages.push({ id: 30, conversation_id: "conv-2", role: "assistant", components_enc: JSON.stringify(ask.kind === "fixed" ? ask.component : null), blocked_reason: null, failed_at: null, deleted_at: null });
    expect(await idPre(db, "conv-2", "sim")).toMatchObject({ kind: "resume", text: "minha fatura" });
  });

  it("'Sou outra pessoa': o número é esquecido (other_person), as conversas perdem a identidade e a mensagem é respondida sem conta", async () => {
    const { tables, db } = world();
    await rememberedNumber(db);
    const ask = await idPre(db, "conv-2", "oi");
    const [, outra] = opts(ask.kind === "fixed" ? ask.component : null);
    expect(await idPre(db, "conv-2", outra.title, { buttonId: outra.id })).toEqual({ kind: "resume", text: "oi", texts: ["oi"], note: IDENTITY_NOTES.otherPerson });
    expect(tables.contact_links.every((l) => l.unlink_reason === "other_person" && l.unlinked_at)).toBe(true);
    expect(tables.contacts[0].active_link_id).toBeNull();
    // a conversa 1 (onde a pessoa se identificou) também perde a identidade, e o roteiro dela acaba
    expect((await loadConversationIdentity(db, "conv-1")).state).toBeNull();
    expect(tables.routine_runs[0]).toMatchObject({ status: "abandoned", end_reason: "context_changed" });
    // botão antigo não vale mais
    expect(await idPre(db, "conv-2", outra.title, { buttonId: outra.id })).toEqual({ kind: "fixed", text: IDENTITY_TEXTS.stale, component: null });
    // e a próxima conversa não pergunta
    expect(await idPre(db, "conv-3", "oi")).toEqual({ kind: "none", note: null, consumed: false });
  });

  it("no site, nem pergunta nem licença", async () => {
    const { db } = world();
    await rememberedNumber(db);
    expect(await idPre(db, "conv-2", "oi", { channel: "widget" })).toEqual({ kind: "none", note: null, consumed: false });
  });

  it("'desconectar' com o número lembrado: sai a pessoa com todas as contas, e a conversa perde a identidade", async () => {
    const { tables, db } = world();
    await rememberedNumber(db);
    expect(tables.contact_links.filter((l) => !l.unlinked_at)).toHaveLength(2);
    const replies: string[] = [];
    const io = { db, bot: BOT, channel: "whatsapp" as const, contactId: CONTACT, phone: null, conversation: async () => "conv-1", store: async () => {}, reply: async (_c: string | null, text: string) => void replies.push(text) };
    await handlePairing(io, [{ text: "desconectar", buttonId: null }]);
    expect(replies).toEqual([PAIRING_TEXTS.forgotten("whatsapp", [])]);
    expect(tables.contact_links.every((l) => l.unlinked_at && l.unlink_reason === "chat")).toBe(true);
    expect(tables.contacts[0].active_link_id).toBeNull();
    expect((await loadConversationIdentity(db, "conv-1")).state).toBeNull();
  });

  it("'desconectar' tira a identificação desta conversa, mesmo sem número lembrado", async () => {
    const { tables, db } = world();
    const p = await portOf(db, "conv-1");
    await p.apply(ONE);
    const replies: string[] = [];
    const io = { db, bot: BOT, channel: "whatsapp" as const, contactId: CONTACT, phone: null, conversation: async () => "conv-1", store: async () => {}, reply: async (_c: string | null, text: string) => void replies.push(text) };
    await handlePairing(io, [{ text: "desconectar", buttonId: null }]);
    expect(replies).toEqual([PAIRING_TEXTS.leftConversation]);
    expect(tables.conversation_identities).toHaveLength(0);
    await handlePairing(io, [{ text: "desconectar", buttonId: null }]);
    expect(replies[1]).toBe(PAIRING_TEXTS.notLinked("whatsapp"));
  });
});
