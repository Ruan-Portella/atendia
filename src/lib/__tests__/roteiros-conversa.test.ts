import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  photoValue,
  actionValue,
  boundParams,
  resultDestination,
  resultKey,
  schemaWithout,
  CARD_PLACEHOLDER,
  FAIL_CANCEL,
  FAIL_TEAM,
  brPhone,
  failButtons,
  findValue,
  isCnpj,
  isCpf,
  keywordRoutine,
  maskCardNumbers,
  nextFrom,
  parseDate,
  parseNumber,
  parseRoutineButton,
  routinePrompt,
  stepButtons,
  stepInstruction,
  typedChoice,
  validateValue,
} from "../routine-run";
import { ROUTINE_CANCELLED_TEXT, applyConfirmedAction, cancelRoutineAction, deleteRoutineRunsOfConversations, endActiveRoutine, endRoutineRuns, routinePreTurn, routineSession, sweepRoutineTimeouts } from "../routine-engine";
import { routineInputFromJson, routineProblem, type RoutineRow, type RoutineStep } from "../routines";
import { offeredByRoutine } from "../action-tools";
import { cleanReason } from "../photo-reading";

/* ------------------------------------------------------------------ validação e máscaras (puras) */

describe("roteiro na conversa: dados conferidos", () => {
  it("CPF e CNPJ pelo dígito verificador (o CNPJ alfanumérico também)", () => {
    expect(isCpf("52998224725")).toBe(true);
    expect(isCpf("52998224724")).toBe(false);
    expect(isCpf("11111111111")).toBe(false);
    expect(isCnpj("11222333000181")).toBe(true);
    expect(isCnpj("11222333000182")).toBe(false);
    // exemplo da Receita Federal para o CNPJ alfanumérico (a partir de 07/2026)
    expect(isCnpj("12ABC34501DE35")).toBe(true);
    expect(isCnpj("12abc34501de35")).toBe(true);
    expect(isCnpj("12ABC34501DE36")).toBe(false);
  });

  it("telefone do Brasil com DDD; o 55 da frente sai", () => {
    expect(brPhone("(11) 98765-4321")).toBe("11987654321");
    expect(brPhone("+55 21 3333-4444")).toBe("2133334444");
    expect(brPhone("(00) 98765-4321")).toBeNull();
    expect(brPhone("(11) 8765-4321")).toBeNull();
    expect(brPhone("98765-4321")).toBeNull();
  });

  it("data e número na forma guardada", () => {
    expect(parseDate("15/03/2026")).toBe("15/03/2026");
    expect(parseDate("5/3/26")).toBe("05/03/2026");
    expect(parseDate("2026-03-15")).toBe("15/03/2026");
    expect(parseDate("15 de março de 2026")).toBe("15/03/2026");
    expect(parseDate("31/02/2026")).toBeNull();
    expect(parseDate("amanhã")).toBeNull();
    expect(parseNumber("1.234,56")).toBe("1234,56");
    expect(parseNumber("12.5")).toBe("12,5");
    expect(parseNumber("3")).toBe("3");
    expect(parseNumber("três")).toBeNull();
  });

  it("cada tipo: o valor conferido ou null", () => {
    expect(validateValue("cpf", "529.982.247-25")).toBe("529.982.247-25");
    expect(validateValue("cnpj", "11.222.333/0001-81")).toBe("11.222.333/0001-81");
    expect(validateValue("cnpj", "12.abc.345/01de-35")).toBe("12.ABC.345/01DE-35");
    expect(validateValue("cpf_cnpj", "52998224725")).toBe("529.982.247-25");
    expect(validateValue("email", "Ana@Exemplo.com.br")).toBe("ana@exemplo.com.br");
    expect(validateValue("email", "ana@exemplo")).toBeNull();
    expect(validateValue("telefone", "21 99999-0000")).toBe("(21) 99999-0000");
    expect(validateValue("cep", "20040-002")).toBe("20040-002");
    expect(validateValue("cep", "00000-000")).toBeNull();
    expect(validateValue("regex", "PED-1234", "[A-Z]{3}-\\d{4}")).toBe("PED-1234");
    expect(validateValue("regex", "PED-12", "[A-Z]{3}-\\d{4}")).toBeNull();
  });

  it("procura o dado nas mensagens desta vez: o mais recente que confere; candidato errado conta como tentativa", () => {
    expect(findValue("cpf", ["meu cpf é", "529.982.247-25"])).toEqual({ value: "529.982.247-25" });
    expect(findValue("cpf", ["529.982.247-25 ou melhor 123.456.789-09"])).toEqual({ value: "123.456.789-09" });
    expect(findValue("cpf", ["123.456.789-00"])).toEqual({ invalid: true });
    expect(findValue("cpf", ["qual o horário de vocês?"])).toBeNull();
    expect(findValue("email", ["manda para ana@exemplo.com.br."])).toEqual({ value: "ana@exemplo.com.br" });
    expect(findValue("email", ["ana@exemplo"])).toEqual({ invalid: true });
    expect(findValue("cep", ["o cep é 20040002"])).toEqual({ value: "20040-002" });
    expect(findValue("telefone", ["pode ligar no (21) 99999-0000"])).toEqual({ value: "(21) 99999-0000" });
    // data e formato próprio vêm da IA (informar_dado)
    expect(findValue("data", ["15/03/2026"])).toBeNull();
  });

  it("número de cartão sai antes de gravar; telefone e CPF ficam", () => {
    expect(maskCardNumbers("cartão 4111 1111 1111 1111 validade 12/30")).toEqual({ text: `cartão ${CARD_PLACEHOLDER} validade 12/30`, found: true });
    expect(maskCardNumbers("5555-5555-5555-4444").found).toBe(true);
    expect(maskCardNumbers("amex 378282246310005").found).toBe(true);
    expect(maskCardNumbers("4111 1111 1111 1112").found).toBe(false);
    expect(maskCardNumbers("meu zap +55 21 99999-0000").found).toBe(false);
    expect(maskCardNumbers("5521999990000").found).toBe(false);
    expect(maskCardNumbers("cpf 529.982.247-25").found).toBe(false);
  });
});

describe("roteiro na conversa: botões, escolhas e caminho", () => {
  const RUN = "0b7f5d0e-1c1a-4f3c-9e77-2a1b3c4d5e6f";
  const botoes: Extract<RoutineStep, { type: "botoes" }> = { id: "passo002", type: "botoes", text: "Confirme o titular", variable: "titular", options: [{ title: "Sim", next: { to: "proximo" } }, { title: "Não", next: { to: "atendente" } }] };

  it("os ids dos botões levam o roteiro, o passo e a opção", () => {
    const c = stepButtons(RUN, botoes);
    expect(c).toEqual({ type: "options", options: [{ id: `rt:${RUN}:passo002:0`, title: "Sim" }, { id: `rt:${RUN}:passo002:1`, title: "Não" }] });
    expect(parseRoutineButton(`rt:${RUN}:passo002:1`)).toEqual({ runId: RUN, stepId: "passo002", index: 1 });
    expect(failButtons(RUN)).toEqual({ type: "options", options: [{ id: `rt:${RUN}:falha:equipe`, title: FAIL_TEAM }, { id: `rt:${RUN}:falha:cancelar`, title: FAIL_CANCEL }] });
    expect(parseRoutineButton(`rt:${RUN}:falha:cancelar`)).toEqual({ runId: RUN, fail: "cancelar" });
    expect(parseRoutineButton("op_1")).toBeNull();
    expect(parseRoutineButton(`rt:${RUN}:falha:2`)).toBeNull();
    expect(parseRoutineButton("rt:x:passo002:1")).toBeNull();
  });

  it("escolha digitada: o número da opção ou o texto dela", () => {
    const opts = [{ id: "a", title: "Veio com defeito" }, { id: "b", title: "Não serviu" }];
    expect(typedChoice("2", opts)).toBe(1);
    expect(typedChoice("nao serviu", opts)).toBe(1);
    expect(typedChoice("3", opts)).toBeNull();
    expect(typedChoice("acho que não serviu", opts)).toBeNull();
  });

  it("palavra-chave é a mensagem inteira, sem diferença de maiúsculas e acentos", () => {
    const rs = [{ name: "Segunda via", keywords: ["2via", "segunda via"] }, { name: "Troca", keywords: ["devolucao"] }];
    expect(keywordRoutine("2VIA", rs)?.name).toBe("Segunda via");
    expect(keywordRoutine("  Devolução! ", rs)?.name).toBe("Troca");
    expect(keywordRoutine("quero a 2via", rs)).toBeNull();
  });

  it("caminho: próximo (no último, acaba), passo, encerrar e equipe", () => {
    const steps: RoutineStep[] = [{ id: "passo001", type: "instrucao", text: "a", next: { to: "proximo" } }, botoes];
    expect(nextFrom(steps, "passo001", { to: "proximo" })).toEqual({ kind: "step", step: botoes });
    expect(nextFrom(steps, "passo002", { to: "proximo" })).toEqual({ kind: "completed" });
    expect(nextFrom(steps, "passo002", { to: "passo", step: "passo001" })).toEqual({ kind: "step", step: steps[0] });
    expect(nextFrom(steps, "passo002", { to: "passo", step: "sumiu00" })).toEqual({ kind: "completed" });
    expect(nextFrom(steps, "passo001", { to: "encerrar" })).toEqual({ kind: "completed" });
    expect(nextFrom(steps, "passo001", { to: "atendente" })).toEqual({ kind: "handoff" });
  });

  it("o que a IA recebe: o passo, os dados como vieram e as regras", () => {
    const p = routinePrompt(
      { name: "Segunda via", steps: [{ id: "passo001", type: "dado", text: "Peça o CPF", kind: "cpf", variable: "cpf", pattern: null, next: { to: "proximo" } }, botoes], stepId: "passo002", variables: { cpf: { kind: "cpf", value: "529.982.247-25" } }, failing: false },
      'A pessoa escolheu "Sim".',
    );
    expect(p).toContain('ROTEIRO EM ANDAMENTO: "Segunda via", passo 2 de 2.');
    expect(p).toContain("Os botões (Sim, Não) vão sozinhos");
    // CPF como a pessoa mandou (decisão de 19/10/2026: a loja pode precisar dele para conferir a conta)
    expect(p).toContain("Dados já informados: cpf: 529.982.247-25.");
    expect(p).toContain('Nesta mensagem: A pessoa escolheu "Sim".');
    expect(p).toContain("cancelar_roteiro");
    expect(stepInstruction({ id: "passo003", type: "dado", text: "Peça a data", kind: "data", variable: "data", pattern: null, next: { to: "proximo" } })).toContain("informar_dado");
    expect(stepInstruction({ id: "passo003", type: "dado", text: "Peça o CPF", kind: "cpf", variable: "cpf", pattern: null, next: { to: "proximo" } }, { failing: true })).toContain(FAIL_TEAM);
  });
});

/* ------------------------------------------------------------------ motor com o banco (falso) */

type Row = Record<string, unknown>;

/** Banco em memória com o que o motor usa (filtros simples, embed routines(*), um roteiro ativo por conversa). */
function fakeDb(tables: Record<string, Row[]>) {
  class Q {
    filters: Array<(r: Row) => boolean> = [];
    op: "select" | "insert" | "update" | "delete" = "select";
    patch: Row = {};
    rows: Row[] = [];
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
    then<A, B>(res: (v: { data: unknown; error: unknown; count?: number }) => A, rej?: (e: unknown) => B) {
      return this.exec().then(res, rej);
    }
    async exec(): Promise<{ data: unknown; error: { message: string } | null; count?: number }> {
      const t = (tables[this.table] ??= []);
      if (this.op === "insert") {
        const out: Row[] = [];
        for (const r of this.rows) {
          const row: Row = { id: crypto.randomUUID(), ...(this.table === "routine_runs" ? { status: "active", attempts: 0, failing: false, variables_enc: null, end_reason: null, ended_at: null } : {}), ...r };
          if (this.table === "routine_runs" && t.some((x) => x.conversation_id === row.conversation_id && x.status === "active")) return { data: null, error: { message: "duplicate key value violates unique constraint" } };
          t.push(row);
          out.push(row);
        }
        return { data: out, error: null };
      }
      let rows = t.filter((r) => this.filters.every((f) => f(r)));
      if (this.op === "update") {
        for (const r of rows) Object.assign(r, this.patch);
        return { data: rows.map((r) => ({ ...r })), error: null };
      }
      if (this.op === "delete") {
        tables[this.table] = t.filter((r) => !rows.includes(r));
        return { data: null, error: null, count: rows.length };
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
const CONV = "conv-1";
const OLD = "2026-10-01T00:00:00.000Z";

/** Linha de roteiro como a tabela guarda (também serve de Row no banco falso). */
function routine(over: Partial<RoutineRow> = {}): RoutineRow & Row {
  return {
    id: "rot-1",
    bot_id: BOT.id,
    name: "Segunda via",
    when_to_use: "O cliente pede segunda via de boleto",
    keywords: ["2via"],
    active: true,
    template: null,
    created_at: OLD,
    updated_at: OLD,
    steps: [
      { id: "passo001", type: "dado", text: "Peça o CPF do titular", kind: "cpf", variable: "cpf", pattern: null, next: { to: "proximo" } },
      { id: "passo002", type: "botoes", text: "Confirme o endereço", variable: "endereco", options: [{ title: "Está certo", next: { to: "proximo" } }, { title: "Mudou", next: { to: "atendente" } }] },
      { id: "passo003", type: "instrucao", text: "Diga que a segunda via sai por e-mail", next: { to: "proximo" } },
    ],
    ...over,
  } as RoutineRow & Row;
}

const runs = (tables: Record<string, Row[]>) => tables.routine_runs ?? [];
const pre = (db: SupabaseClient, texts: string[], o: { buttonId?: string | null; waPhone?: string | null; consume?: boolean } = {}) =>
  routinePreTurn(db, { bot: BOT, conversationId: CONV, texts, buttonId: o.buttonId ?? null, waPhone: o.waPhone ?? null, consume: o.consume });

describe("roteiro na conversa: antes da IA", () => {
  it("palavra-chave começa o roteiro; o CPF conferido avança", async () => {
    const tables: Record<string, Row[]> = { routines: [routine()], conversations: [{ id: CONV }], messages: [] };
    const db = fakeDb(tables);
    const t1 = await pre(db, ["2VIA"]);
    expect(t1.run?.stepId).toBe("passo001");
    expect(t1.note).toContain('palavra-chave "2VIA"');
    expect(runs(tables)[0]).toMatchObject({ started_by: "palavra", status: "active", step_index: 1, routine_name: "Segunda via" });

    const t2 = await pre(db, ["meu cpf é 529.982.247-25"]);
    expect(t2.run?.stepId).toBe("passo002");
    expect(t2.note).toBe("CPF conferido: 529.982.247-25.");
    expect(JSON.parse(String(runs(tables)[0].variables_enc))).toEqual({ cpf: { kind: "cpf", value: "529.982.247-25" } });
  });

  it("CPF errado conta tentativa; na terceira, botões de equipe e cancelar; Cancelar encerra sem a IA", async () => {
    const tables: Record<string, Row[]> = { routines: [routine()], conversations: [{ id: CONV }], messages: [] };
    const db = fakeDb(tables);
    await pre(db, ["2via"]);
    const t1 = await pre(db, ["123.456.789-00"]);
    expect(t1.note).toContain("tentativa 1 de 3");
    expect(t1.note).toContain("dígito verificador");
    await pre(db, ["123.456.789-00"]);
    const t3 = await pre(db, ["123.456.789-00"]);
    expect(t3.run?.failing).toBe(true);
    const s = routineSession(db, { bot: BOT, conversationId: CONV, waPhone: null, turn: t3, texts: ["123.456.789-00"], requestHandoff: async () => "aviso" })!;
    expect(s.component()).toEqual(failButtons(t3.run!.id));
    expect(s.blocksOptions()).toBe(true);
    expect(s.prompt()).toContain(FAIL_TEAM);

    const t4 = await pre(db, ["Cancelar"], { buttonId: `rt:${t3.run!.id}:falha:cancelar` });
    expect(t4.fixed).toEqual({ kind: "cancelled", text: ROUTINE_CANCELLED_TEXT });
    expect(runs(tables)[0]).toMatchObject({ status: "abandoned", end_reason: "cancelled", variables_enc: null });
  });

  it("perguntou outra coisa no meio: não conta tentativa", async () => {
    const tables: Record<string, Row[]> = { routines: [routine()], conversations: [{ id: CONV }], messages: [] };
    const db = fakeDb(tables);
    await pre(db, ["2via"]);
    const t = await pre(db, ["vocês abrem sábado?"]);
    expect(t.note).toContain("ainda não mandou o CPF");
    expect(runs(tables)[0].attempts).toBe(0);
  });

  it("botão do passo: o toque decide o caminho; o número digitado vale só com os botões na última mensagem", async () => {
    const tables: Record<string, Row[]> = { routines: [routine()], conversations: [{ id: CONV }], messages: [] };
    const db = fakeDb(tables);
    await pre(db, ["2via"]);
    const t = await pre(db, ["529.982.247-25"]);
    const runId = t.run!.id;
    const s = routineSession(db, { bot: BOT, conversationId: CONV, waPhone: null, turn: t, texts: [], requestHandoff: async () => "aviso" })!;
    expect(s.component()).toEqual({ type: "options", options: [{ id: `rt:${runId}:passo002:0`, title: "Está certo" }, { id: `rt:${runId}:passo002:1`, title: "Mudou" }] });

    // o "1" sem os botões na última mensagem do bot não é escolha
    const loose = await pre(db, ["1"]);
    expect(loose.run?.stepId).toBe("passo002");
    tables.messages.push({ id: 10, conversation_id: CONV, role: "assistant", components_enc: JSON.stringify(s.component()), blocked_reason: null, failed_at: null, deleted_at: null, created_at: new Date().toISOString() });
    const typed = await pre(db, ["1"]);
    expect(typed.note).toBe('A pessoa escolheu "Está certo" (digitou a opção).');
    expect(typed.run?.stepId).toBe("passo003");
    expect(JSON.parse(String(runs(tables)[0].variables_enc)).endereco).toEqual({ kind: "escolha", value: "Está certo" });
  });

  it("botão que leva à equipe: pedido de atendente sem a IA, roteiro abandonado (handoff)", async () => {
    const tables: Record<string, Row[]> = { routines: [routine()], conversations: [{ id: CONV }], messages: [] };
    const db = fakeDb(tables);
    await pre(db, ["2via"]);
    const t = await pre(db, ["529.982.247-25"]);
    const out = await pre(db, ["Mudou"], { buttonId: `rt:${t.run!.id}:passo002:1` });
    expect(out.fixed).toEqual({ kind: "handoff", reason: 'Roteiro "Segunda via": Mudou' });
    expect(runs(tables)[0]).toMatchObject({ status: "abandoned", end_reason: "handoff" });
  });

  it("toque num botão de um passo antigo não anda o roteiro", async () => {
    const tables: Record<string, Row[]> = { routines: [routine()], conversations: [{ id: CONV }], messages: [] };
    const db = fakeDb(tables);
    await pre(db, ["2via"]);
    const t = await pre(db, ["529.982.247-25"]);
    const out = await pre(db, ["Está certo"], { buttonId: `rt:${t.run!.id}:passo001:0` });
    expect(out.run?.stepId).toBe("passo002");
    expect(out.fixed).toBeNull();
  });

  it("acaba sozinho: 24 horas sem resposta, roteiro alterado e equipe que entrou", async () => {
    const base = () => ({ conversation_id: CONV, bot_id: BOT.id, routine_id: "rot-1", routine_name: "Segunda via", routine_version: OLD, step_id: "passo001", step_index: 1, steps_total: 3, status: "active", attempts: 0, failing: false, variables_enc: null, started_by: "ia" });
    const recent = new Date(Date.now() - 60_000).toISOString();

    const t1: Record<string, Row[]> = { routines: [routine()], conversations: [{ id: CONV }], messages: [], routine_runs: [{ id: "r1", ...base(), last_contact_at: new Date(Date.now() - 25 * 3_600_000).toISOString(), updated_at: OLD }] };
    expect((await pre(fakeDb(t1), ["oi"])).run).toBeNull();
    expect(t1.routine_runs[0]).toMatchObject({ status: "abandoned", end_reason: "timeout" });

    const t2: Record<string, Row[]> = { routines: [routine({ updated_at: new Date().toISOString() })], conversations: [{ id: CONV }], messages: [], routine_runs: [{ id: "r2", ...base(), last_contact_at: recent, updated_at: recent }] };
    await pre(fakeDb(t2), ["oi"]);
    expect(t2.routine_runs[0]).toMatchObject({ status: "abandoned", end_reason: "routine_changed" });

    const t3: Record<string, Row[]> = { routines: [routine()], conversations: [{ id: CONV, takeover_at: new Date().toISOString() }], messages: [], routine_runs: [{ id: "r3", ...base(), last_contact_at: recent, updated_at: recent }] };
    await pre(fakeDb(t3), ["oi"]);
    expect(t3.routine_runs[0]).toMatchObject({ status: "abandoned", end_reason: "handoff" });
  });

  it("mensagem mandada pela API sem pausa não encerra; resposta pelo celular encerra", async () => {
    const recent = new Date(Date.now() - 60_000).toISOString();
    const now = new Date().toISOString();
    const run = (id: string): Row => ({ id, conversation_id: CONV, bot_id: BOT.id, routine_id: "rot-1", routine_name: "Segunda via", routine_version: OLD, step_id: "passo001", step_index: 1, steps_total: 3, status: "active", attempts: 0, failing: false, variables_enc: null, started_by: "ia", last_contact_at: recent, updated_at: recent });
    const api: Record<string, Row[]> = { routines: [routine()], conversations: [{ id: CONV }], messages: [{ id: 1, conversation_id: CONV, role: "agent", author: "integracao", created_at: now }], routine_runs: [run("r5")] };
    expect((await pre(fakeDb(api), ["oi"])).run?.id).toBe("r5");
    const phone: Record<string, Row[]> = { routines: [routine()], conversations: [{ id: CONV }], messages: [{ id: 1, conversation_id: CONV, role: "agent", author: "celular", created_at: now }], routine_runs: [run("r6")] };
    expect((await pre(fakeDb(phone), ["oi"])).run).toBeNull();
    expect(phone.routine_runs[0]).toMatchObject({ status: "abandoned", end_reason: "handoff" });
  });

  it("depois do Confirmar ou da resposta de 18+: só confere o estado, não usa a mensagem", async () => {
    const tables: Record<string, Row[]> = { routines: [routine()], conversations: [{ id: CONV }], messages: [] };
    const db = fakeDb(tables);
    const t = await pre(db, ["2via"], { consume: false });
    expect(t.run).toBeNull();
    expect(runs(tables)).toHaveLength(0);
  });

  it("chatbot sem roteiro ligado: nada muda", async () => {
    const db = fakeDb({ routines: [routine({ active: false })], conversations: [{ id: CONV }], messages: [] });
    const t = await pre(db, ["2via"]);
    expect(t).toMatchObject({ run: null, available: [], note: null, fixed: null });
    expect(routineSession(db, { bot: BOT, conversationId: CONV, waPhone: null, turn: t, texts: [], requestHandoff: async () => "" })).toBeNull();
  });
});

describe("roteiro na conversa: ferramentas da IA", () => {
  const orcamento = routine({
    id: "rot-2",
    name: "Orçamento",
    keywords: [],
    steps: [
      { id: "orcam001", type: "instrucao", text: "Pergunte o que a pessoa precisa orçar", next: { to: "proximo" } },
      { id: "orcam002", type: "dado", text: "Peça um telefone com DDD", kind: "telefone", variable: "telefone", pattern: null, next: { to: "proximo" } },
      { id: "orcam003", type: "dado", text: "Peça a data do serviço", kind: "data", variable: "data", pattern: null, next: { to: "atendente" } },
    ],
  });
  const exec = async (s: NonNullable<ReturnType<typeof routineSession>>, name: string, input: Record<string, unknown> = {}) =>
    (s.tools[name] as unknown as { execute: (i: unknown, o: unknown) => Promise<Record<string, unknown>> }).execute(input, { toolCallId: "t", messages: [] });

  it("a IA começa, conclui a instrução e informa a data; o telefone do WhatsApp entra sozinho; no fim, a equipe", async () => {
    const tables: Record<string, Row[]> = { routines: [orcamento], conversations: [{ id: CONV }], messages: [] };
    const db = fakeDb(tables);
    const turn = await pre(db, ["quero um orçamento de pintura"], { waPhone: "5521999990000" });
    const handoffs: string[] = [];
    const s = routineSession(db, { bot: BOT, conversationId: CONV, waPhone: "5521999990000", turn, texts: ["quero um orçamento de pintura"], requestHandoff: async (r) => (handoffs.push(r), "A equipe já vai te responder.") })!;
    expect(Object.keys(s.tools)).toEqual(["iniciar_roteiro", "concluir_passo", "informar_dado", "cancelar_roteiro"]);

    const started = await exec(s, "iniciar_roteiro", { nome: "Orçamento" });
    expect(started).toMatchObject({ ok: true, passo: "1 de 3" });
    expect(runs(tables)[0]).toMatchObject({ started_by: "ia", step_id: "orcam001" });
    expect(await exec(s, "iniciar_roteiro", { nome: "Orçamento" })).toMatchObject({ ok: false });

    // instrução cumprida: o passo do telefone se preenche com o número desta conversa do WhatsApp
    const next = await exec(s, "concluir_passo");
    expect(next).toMatchObject({ ok: true, passo: "3 de 3" });
    expect(String(next.dados)).toContain("telefone: (21) 99999-0000");

    // data: a IA informa; errada conta tentativa
    expect(await exec(s, "informar_dado", { valor: "31/02/2026" })).toMatchObject({ ok: false });
    expect(runs(tables)[0].attempts).toBe(1);
    const done = await exec(s, "informar_dado", { valor: "15/03/2026" });
    expect(done).toMatchObject({ ok: true, roteiro: "equipe", aviso: "A equipe já vai te responder." });
    expect(handoffs).toEqual(['Roteiro "Orçamento"']);
    expect(runs(tables)[0]).toMatchObject({ status: "abandoned", end_reason: "handoff", variables_enc: null });
    expect(s.component()).toBeNull();
  });

  it("o dado de formato fixo não vem da IA; cancelar encerra", async () => {
    const tables: Record<string, Row[]> = { routines: [routine()], conversations: [{ id: CONV }], messages: [] };
    const db = fakeDb(tables);
    const turn = await pre(db, ["quero a segunda via"]);
    const s = routineSession(db, { bot: BOT, conversationId: CONV, waPhone: null, turn, texts: ["quero a segunda via"], requestHandoff: async () => "" })!;
    await exec(s, "iniciar_roteiro", { nome: "Segunda via" });
    expect(await exec(s, "informar_dado", { valor: "529.982.247-25" })).toMatchObject({ ok: false });
    expect(await exec(s, "concluir_passo")).toMatchObject({ ok: false });
    expect(await exec(s, "cancelar_roteiro")).toMatchObject({ ok: true });
    expect(runs(tables)[0]).toMatchObject({ status: "abandoned", end_reason: "cancelled" });
    expect(await exec(s, "cancelar_roteiro")).toMatchObject({ ok: false });
  });

  it("o CPF que já veio na mensagem que começou o roteiro conta: o roteiro já para nos botões", async () => {
    const tables: Record<string, Row[]> = { routines: [routine()], conversations: [{ id: CONV }], messages: [] };
    const db = fakeDb(tables);
    const text = "segunda via, meu cpf é 529.982.247-25";
    const turn = await pre(db, [text]);
    const s = routineSession(db, { bot: BOT, conversationId: CONV, waPhone: null, turn, texts: [text], requestHandoff: async () => "" })!;
    expect(await exec(s, "iniciar_roteiro", { nome: "Segunda via" })).toMatchObject({ ok: true, passo: "2 de 3" });
    expect(s.component()?.type).toBe("options");
    expect(s.blocksOptions()).toBe(true);
  });
});

describe("roteiro na conversa: fim pelos ganchos e limpeza", () => {
  const active = (id: string, over: Row = {}): Row => ({ id, conversation_id: CONV, bot_id: BOT.id, routine_id: "rot-1", status: "active", variables_enc: "{}", last_contact_at: new Date().toISOString(), ...over });

  it("equipe, roteiro alterado, prazo e pedido do titular", async () => {
    const tables: Record<string, Row[]> = { routine_runs: [active("a"), active("b", { conversation_id: "conv-2", routine_id: "rot-9" }), active("c", { conversation_id: "conv-3", last_contact_at: "2026-01-01T00:00:00.000Z" })] };
    const db = fakeDb(tables);
    await endActiveRoutine(db, CONV, "handoff");
    expect(tables.routine_runs[0]).toMatchObject({ status: "abandoned", end_reason: "handoff", variables_enc: null });
    await endRoutineRuns(db, "rot-9", "routine_changed");
    expect(tables.routine_runs[1]).toMatchObject({ status: "abandoned", end_reason: "routine_changed" });
    expect(await sweepRoutineTimeouts(db)).toBe(1);
    expect(tables.routine_runs[2]).toMatchObject({ status: "abandoned", end_reason: "timeout" });
    expect(await deleteRoutineRunsOfConversations(db, [CONV, "conv-2"])).toBe(2);
    expect(tables.routine_runs.map((r) => r.id)).toEqual(["c"]);
  });
});

/* ------------------------------------------------------------------ passo de ação (parte 2b) */

describe("roteiro na conversa: passo de ação (puro)", () => {
  it("o valor como vai para a ação: sem pontuação, data em aaaa-mm-dd e número de verdade quando o parâmetro é número", () => {
    expect(actionValue({ kind: "cpf", value: "529.982.247-25" })).toBe("52998224725");
    expect(actionValue({ kind: "cnpj", value: "12.ABC.345/01DE-35" })).toBe("12ABC34501DE35");
    expect(actionValue({ kind: "cep", value: "20040-002" })).toBe("20040002");
    expect(actionValue({ kind: "telefone", value: "(21) 99999-0000" })).toBe("21999990000");
    expect(actionValue({ kind: "email", value: "Ana@Exemplo.com" })).toBe("ana@exemplo.com");
    expect(actionValue({ kind: "data", value: "15/03/2026" })).toBe("2026-03-15");
    expect(actionValue({ kind: "numero", value: "1234,5" })).toBe("1234.5");
    expect(actionValue({ kind: "numero", value: "1234,5" }, "number")).toBe(1234.5);
    expect(actionValue({ kind: "numero", value: "3" }, "integer")).toBe(3);
    expect(actionValue({ kind: "escolha", value: "Está certo" })).toBe("Está certo");
  });

  it("parâmetros com o mesmo nome de uma variável vão preenchidos (texto e número; o resto fica com a IA)", () => {
    const schema = { type: "object" as const, properties: { documento: { type: "string" as const }, quantidade: { type: "integer" as const }, ativo: { type: "boolean" as const }, nome: { type: "string" as const } }, required: ["documento", "nome"] };
    const vars = { documento: { kind: "cpf" as const, value: "529.982.247-25" }, quantidade: { kind: "numero" as const, value: "3" }, ativo: { kind: "escolha" as const, value: "Sim" } };
    expect(boundParams(schema, vars)).toEqual({ documento: "52998224725", quantidade: 3 });
    expect(schemaWithout(schema, ["documento", "quantidade"])).toEqual({ type: "object", properties: { ativo: { type: "boolean" }, nome: { type: "string" } }, required: ["nome"] });
    expect(schemaWithout(schema, [])).toBe(schema);
  });

  it("resultado → destino: declarado, ok, não encontrado e o resto no erro", () => {
    expect(resultKey({ status: "ok" }, [])).toBe("ok");
    expect(resultKey({ status: "ok", outcome: "sem_debito" }, ["sem_debito"])).toBe("sem_debito");
    expect(resultKey({ status: "ok", outcome: "inventado" }, ["sem_debito"])).toBe("erro");
    expect(resultKey({ status: "not_found" }, [])).toBe("nao_encontrado");
    for (const st of ["error", "timeout", "uncertain", "blocked"]) expect(resultKey({ status: st }, [])).toBe("erro");
    const step: Extract<RoutineStep, { type: "acao" }> = { id: "acao0001", type: "acao", text: "Busque", action: "buscar", results: { ok: { to: "encerrar" }, erro: { to: "passo", step: "x0000001" } } };
    expect(resultDestination(step, "nao_encontrado")).toEqual({ to: "passo", step: "x0000001" });
    expect(resultDestination({ ...step, results: {} }, "ok")).toEqual({ to: "atendente" });
    expect(stepInstruction(step)).toContain("acao_buscar");
  });
});

describe("roteiro na conversa: passo de ação (motor)", () => {
  // roteiro com passo de ação só vale com o pacote Integrações
  const PACK: Row = { agency_id: BOT.agency_id, pack: "integracoes", ends_at: null };
  const segundaVia = routine({
    id: "rot-3",
    name: "Segunda via",
    keywords: ["2via"],
    steps: [
      { id: "segv0001", type: "dado", text: "Peça o CPF", kind: "cpf", variable: "documento", pattern: null, next: { to: "proximo" } },
      { id: "segv0002", type: "acao", text: "Envie o boleto", action: "buscar_segunda_via", results: { ok: { to: "encerrar" }, nao_encontrado: { to: "passo", step: "segv0003" }, erro: { to: "atendente" }, sem_debito: { to: "encerrar" } } },
      { id: "segv0003", type: "instrucao", text: "Diga que não achou nada em aberto", next: { to: "atendente" } },
    ],
  });
  const atAction = async (extra: Record<string, Row[]> = {}) => {
    const tables: Record<string, Row[]> = { routines: [segundaVia], conversations: [{ id: CONV }], messages: [], agency_packs: [PACK], ...extra };
    const db = fakeDb(tables);
    await pre(db, ["2via"]);
    const turn = await pre(db, ["529.982.247-25"]);
    const handoffs: string[] = [];
    const s = routineSession(db, { bot: BOT, conversationId: CONV, waPhone: null, turn, texts: [], requestHandoff: async (r) => (handoffs.push(r), "aviso da equipe") })!;
    return { tables, db, s, handoffs };
  };

  it("sem o pacote Integrações, o roteiro com passo de ação fica pausado (nem começa pela palavra-chave)", async () => {
    const tables: Record<string, Row[]> = { routines: [segundaVia], conversations: [{ id: CONV }], messages: [] };
    const t = await pre(fakeDb(tables), ["2via"]);
    expect(t.available).toEqual([]);
    expect(runs(tables)).toHaveLength(0);
  });

  it("o passo de ação entrega a ação e os dados; o resultado escolhe o destino", async () => {
    const { tables, s } = await atAction();
    expect(s.actionStep()).toEqual({ action: "buscar_segunda_via", variables: { documento: { kind: "cpf", value: "529.982.247-25" } } });
    expect(s.prompt()).toContain("acao_buscar_segunda_via");
    // outra ação não anda o roteiro
    expect(await s.onActionResult("outra", { status: "ok" }, [])).toBeNull();
    const out = await s.onActionResult("buscar_segunda_via", { status: "not_found" }, ["sem_debito"]);
    expect(out).toMatchObject({ ok: true, passo: "3 de 3" });
    expect(runs(tables)[0].step_id).toBe("segv0003");
  });

  it("resultado declarado encerra; resultado não declarado segue o erro (equipe)", async () => {
    const a = await atAction();
    expect(await a.s.onActionResult("buscar_segunda_via", { status: "ok", outcome: "sem_debito" }, ["sem_debito"])).toMatchObject({ ok: true, roteiro: "concluido" });
    expect(runs(a.tables)[0]).toMatchObject({ status: "completed", end_reason: null });

    const b = await atAction();
    expect(await b.s.onActionResult("buscar_segunda_via", { status: "ok", outcome: "inventado" }, ["sem_debito"])).toMatchObject({ ok: true, roteiro: "equipe", aviso: "aviso da equipe" });
    expect(runs(b.tables)[0]).toMatchObject({ status: "abandoned", end_reason: "handoff" });
  });

  it("ação que não veio entre as ferramentas: destino de erro, com o motivo step_unavailable", async () => {
    const { tables, s, handoffs } = await atAction();
    await s.prepare(new Set(["acao_outra"]), { confirmRound: true });
    expect(runs(tables)[0].status).toBe("active");
    await s.prepare(new Set(["acao_outra"]));
    expect(runs(tables)[0]).toMatchObject({ status: "abandoned", end_reason: "step_unavailable" });
    expect(handoffs).toHaveLength(1);
    expect(s.prompt()).toContain("não está disponível agora e a conversa foi passada para a equipe");
    expect(s.actionStep()).toBeNull();
  });

  it("5 'não encontrado' tiram a ação: indisponível também é step_unavailable", async () => {
    const { tables, s } = await atAction();
    await s.onActionResult("buscar_segunda_via", { status: "unavailable" }, []);
    expect(runs(tables)[0]).toMatchObject({ status: "abandoned", end_reason: "step_unavailable" });
  });

  it("Confirmar de uma ação \"executa\" do passo anda pelo resultado; Cancelar encerra", async () => {
    const pedido = routine({ id: "rot-4", name: "Pedido", keywords: ["pedido"], steps: [{ id: "pedi0001", type: "acao", text: "Confirme o pedido", action: "criar_pedido", results: { ok: { to: "atendente" }, nao_encontrado: { to: "atendente" }, erro: { to: "atendente" } } }] });
    const tables: Record<string, Row[]> = { routines: [pedido], conversations: [{ id: CONV }], messages: [], agency_packs: [PACK], actions: [{ id: "act-1", name: "criar_pedido" }, { id: "act-2", name: "outra" }] };
    const db = fakeDb(tables);
    await pre(db, ["pedido"]);
    expect(await applyConfirmedAction(db, { conversationId: CONV, action: "outra", status: "ok", outcome: null, declared: [], waPhone: null })).toEqual({ note: null, handoff: null });
    const r = await applyConfirmedAction(db, { conversationId: CONV, action: "criar_pedido", status: "ok", outcome: null, declared: [], waPhone: null });
    expect(r.handoff).toBe('Roteiro "Pedido": criar_pedido (ok)');
    expect(runs(tables)[0]).toMatchObject({ status: "abandoned", end_reason: "handoff" });

    // de novo, agora com o Cancelar
    await pre(db, ["pedido"]);
    await cancelRoutineAction(db, CONV, "act-2");
    expect(runs(tables)[1].status).toBe("active");
    await cancelRoutineAction(db, CONV, "act-1");
    expect(runs(tables)[1]).toMatchObject({ status: "abandoned", end_reason: "cancelled" });
  });
});

/* ------------------------------------------------------------------ o roteiro aberto não prende a conversa */

describe("roteiro na conversa: outro roteiro e o roteiro parado", () => {
  const troca = routine({
    id: "rot-9",
    name: "Troca",
    when_to_use: "O cliente quer trocar um produto",
    keywords: ["troca"],
    steps: [
      { id: "troc0001", type: "instrucao", text: "Peça o número do pedido", next: { to: "proximo" } },
      { id: "troc0002", type: "instrucao", text: "Diga que a equipe segue com a troca", next: { to: "atendente" } },
    ],
  });
  const exec = async (s: NonNullable<ReturnType<typeof routineSession>>, name: string, input: Record<string, unknown> = {}) =>
    (s.tools[name] as unknown as { execute: (i: unknown, o: unknown) => Promise<Record<string, unknown>> }).execute(input, { toolCallId: "t", messages: [] });

  it("a palavra-chave de outro roteiro troca o aberto (replaced), mesmo no passo que espera o CPF; a do próprio roteiro não recomeça", async () => {
    const tables: Record<string, Row[]> = { routines: [routine(), troca], conversations: [{ id: CONV }], messages: [] };
    const db = fakeDb(tables);
    await pre(db, ["2via"]);
    const t = await pre(db, ["troca"]);
    expect(t.run?.routine.name).toBe("Troca");
    expect(t.note).toContain('palavra-chave "troca"');
    expect(runs(tables)[0]).toMatchObject({ routine_id: "rot-1", status: "abandoned", end_reason: "replaced", variables_enc: null });
    expect(runs(tables)[1]).toMatchObject({ routine_id: "rot-9", status: "active", started_by: "palavra" });
    const again = await pre(db, ["troca"]);
    expect(again.run?.id).toBe(t.run!.id);
    expect(runs(tables)).toHaveLength(2);
  });

  it("a IA começa outro roteiro com um aberto: o aberto acaba (replaced); o mesmo roteiro, não", async () => {
    const tables: Record<string, Row[]> = { routines: [routine(), troca], conversations: [{ id: CONV }], messages: [] };
    const db = fakeDb(tables);
    await pre(db, ["2via"]);
    const turn = await pre(db, ["na verdade quero trocar um produto"]);
    const s = routineSession(db, { bot: BOT, conversationId: CONV, waPhone: null, turn, texts: [], requestHandoff: async () => "aviso" })!;
    expect(await exec(s, "iniciar_roteiro", { nome: "Segunda via" })).toMatchObject({ ok: false, instrucao: "Esse roteiro já está em andamento: siga o passo atual." });
    expect(await exec(s, "iniciar_roteiro", { nome: "Troca" })).toMatchObject({ ok: true, passo: "1 de 2" });
    expect(runs(tables)[0]).toMatchObject({ status: "abandoned", end_reason: "replaced" });
    expect(runs(tables)[1]).toMatchObject({ routine_id: "rot-9", status: "active", started_by: "ia" });
    expect(s.prompt()).toContain('"Troca", passo 1 de 2');
  });

  it("4 mensagens seguidas sem o roteiro andar: na próxima, ele acaba (idle); quando anda, o contador zera", async () => {
    const tables: Record<string, Row[]> = { routines: [troca, routine()], conversations: [{ id: CONV }], messages: [] };
    const db = fakeDb(tables);
    const first = await pre(db, ["troca"]);
    const s = routineSession(db, { bot: BOT, conversationId: CONV, waPhone: null, turn: first, texts: [], requestHandoff: async () => "aviso" })!;
    for (const msg of ["oi", "vocês abrem sábado?", "e o horário?"]) await pre(db, [msg]);
    expect(runs(tables)[0].idle_turns).toBe(3);
    // o passo andou na vez da IA: o contador zera
    await exec(s, "concluir_passo");
    expect(runs(tables)[0]).toMatchObject({ step_id: "troc0002", idle_turns: 0 });
    for (const msg of ["a", "b", "c", "d"]) expect((await pre(db, [msg])).run?.id).toBe(first.run!.id);
    expect(runs(tables)[0].idle_turns).toBe(4);
    const after = await pre(db, ["e a fatura?"]);
    expect(after.run).toBeNull();
    expect(runs(tables)[0]).toMatchObject({ status: "abandoned", end_reason: "idle", variables_enc: null });
    // a IA ainda pode começar um roteiro nesta mesma vez
    expect(after.available.map((r) => r.name)).toEqual(["Segunda via", "Troca"]);
  });

  it("no passo que espera o CPF, a mensagem sem CPF também conta como parada", async () => {
    const tables: Record<string, Row[]> = { routines: [routine()], conversations: [{ id: CONV }], messages: [] };
    const db = fakeDb(tables);
    await pre(db, ["2via"]);
    for (const msg of ["oi", "qual o horário?", "e o endereço?", "tem estacionamento?"]) await pre(db, [msg]);
    expect((await pre(db, ["obrigado"])).run).toBeNull();
    expect(runs(tables)[0]).toMatchObject({ status: "abandoned", end_reason: "idle" });
  });
});

/* ------------------------------------------------------------------ ações "Só no roteiro" */

describe("ação só no roteiro", () => {
  it("vai para a IA só se um roteiro ligado tem um passo com ela; a ação comum vai sempre", () => {
    const steps = new Set(["buscar_segunda_via"]);
    expect(offeredByRoutine({ name: "buscar_segunda_via", routine_only: true }, steps)).toBe(true);
    expect(offeredByRoutine({ name: "identificar_cliente", routine_only: true }, steps)).toBe(false);
    expect(offeredByRoutine({ name: "identificar_cliente", routine_only: true }, new Set())).toBe(false);
    expect(offeredByRoutine({ name: "ver_pizzas", routine_only: false }, new Set())).toBe(true);
    expect(offeredByRoutine({ name: "ver_pizzas" }, new Set())).toBe(true);
  });

  it("as ações dos passos: dos roteiros ligados e do aberto; roteiro desligado fica de fora", async () => {
    const segundaVia = routine({ id: "rot-3", name: "Segunda via", steps: [{ id: "segv0001", type: "acao", text: "Busque", action: "buscar_segunda_via", results: { ok: { to: "encerrar" }, nao_encontrado: { to: "atendente" }, erro: { to: "atendente" } } }] });
    const desligado = routine({ id: "rot-4", name: "Fatura", active: false, keywords: ["fatura"], steps: [{ id: "fatu0001", type: "acao", text: "Busque", action: "buscar_fatura", results: { ok: { to: "encerrar" }, nao_encontrado: { to: "atendente" }, erro: { to: "atendente" } } }] });
    const tables: Record<string, Row[]> = { routines: [routine(), segundaVia, desligado], conversations: [{ id: CONV }], messages: [], agency_packs: [{ agency_id: BOT.agency_id, pack: "integracoes", ends_at: null }] };
    const db = fakeDb(tables);
    const turn = await pre(db, ["oi"]);
    const s = routineSession(db, { bot: BOT, conversationId: CONV, waPhone: null, turn, texts: [], requestHandoff: async () => "" })!;
    expect(s.stepActions()).toEqual(["buscar_segunda_via"]);
  });
});

/* ------------------------------------------------------------------ passo de foto (parte 2d) */

describe("passo de foto", () => {
  const ROTEADOR = { kind: "comum" as const, description: "Roteador branco com a luz LOS vermelha acesa e a PON apagada.", text: "LOS PON" };
  const suporte = routine({
    id: "rot-7",
    name: "Internet",
    when_to_use: "O cliente está sem internet ou com a internet lenta",
    keywords: ["internet"],
    steps: [
      { id: "inte0001", type: "foto", text: "Peça uma foto das luzes do roteador", variable: "foto_roteador", next: { to: "proximo" } },
      { id: "inte0002", type: "instrucao", text: "Oriente pela luz que está acesa", next: { to: "atendente" } },
    ],
  });
  const exec = async (s: NonNullable<ReturnType<typeof routineSession>>, name: string, input: Record<string, unknown> = {}) =>
    (s.tools[name] as unknown as { execute: (i: unknown, o: unknown) => Promise<Record<string, unknown>> }).execute(input, { toolCallId: "t", messages: [] });
  const prePhoto = (db: SupabaseClient, texts: string[], photos: Array<{ kind: "comum"; description: string; text?: string }> | null, o: { can?: boolean; check?: (asked: string, seen: string) => Promise<{ ok: boolean; reason: string | null; error?: boolean }> } = {}) =>
    routinePreTurn(db, { bot: BOT, conversationId: CONV, texts, buttonId: null, waPhone: null, photos, canPhotos: o.can ?? true, checkPhoto: o.check });

  it("a descrição guardada: a das fotos descritas da rajada (comprovante e ilegível ficam de fora)", () => {
    expect(photoValue([ROTEADOR])).toBe('Roteador branco com a luz LOS vermelha acesa e a PON apagada. Texto na foto: "LOS PON".');
    expect(photoValue([{ kind: "comprovante" }, { kind: "ilegivel" }])).toBeNull();
    expect(photoValue([ROTEADOR, { kind: "comum", description: "Cabo de rede solto." }])).toBe('Foto 1: Roteador branco com a luz LOS vermelha acesa e a PON apagada. Texto na foto: "LOS PON". Foto 2: Cabo de rede solto.');
    expect(photoValue(null)).toBeNull();
    expect(photoValue([{ kind: "comum", description: "x".repeat(900) }])!.length).toBe(600);
    expect(stepInstruction(suporte.steps[0])).toContain("concluir_passo");
    // o motivo da conferência entra no meio da frase da IA
    expect(cleanReason("A foto está escura e não mostra as luzes do roteador.")).toBe("a foto está escura e não mostra as luzes do roteador");
    expect(cleanReason("  ")).toBeNull();
  });

  it("o editor: variável obrigatória e nada de pedir foto de documento, cartão, comprovante ou saúde", () => {
    const base = { name: "Internet", when_to_use: "O cliente está sem internet", keywords: [], active: true, template: null };
    const ctx = { actions: [], others: [], integrations: false };
    const read = (text: string, variable = "foto") => {
      const r = routineInputFromJson(JSON.stringify({ ...base, steps: [{ id: "inte0001", type: "foto", text, variable }] }));
      if ("error" in r) throw new Error(r.error);
      return r;
    };
    expect(read("Peça uma foto das luzes do roteador").steps[0]).toEqual({ id: "inte0001", type: "foto", text: "Peça uma foto das luzes do roteador", variable: "foto", next: { to: "proximo" } });
    expect(routineProblem(read("Peça uma foto das luzes do roteador"), ctx)).toBeNull();
    expect(routineProblem(read("Peça uma foto das luzes do roteador", "Foto Roteador"), ctx)).toContain("nome da variável");
    for (const t of ["Peça uma foto do RG", "Peça a foto da CNH", "Peça uma foto do cartão", "Peça o comprovante do Pix", "Peça a foto do exame", "Peça a foto da receita"]) expect(routineProblem(read(t), ctx)).toContain("o passo de foto não pede");
    // nota fiscal a IA lê
    expect(routineProblem(read("Peça uma foto da nota fiscal"), ctx)).toBeNull();
  });

  it("o BoaVoz confere a foto: a certa anda sozinha; a errada conta tentativa (3: equipe ou cancelar); concluir_passo não anda este passo", async () => {
    const CANECA = { kind: "comum" as const, description: "Caneca preta com um desenho colorido." };
    const tables: Record<string, Row[]> = { routines: [suporte], conversations: [{ id: CONV }], messages: [] };
    const db = fakeDb(tables);
    const asked: string[] = [];
    const answer = (v: { ok: boolean; reason: string | null; error?: boolean }) => async (a: string) => (asked.push(a), v);
    const t1 = await prePhoto(db, ["internet"], null);
    expect(t1.run?.stepId).toBe("inte0001");
    const s1 = routineSession(db, { bot: BOT, conversationId: CONV, waPhone: null, turn: t1, texts: [], requestHandoff: async () => "aviso" })!;
    expect(await exec(s1, "concluir_passo")).toMatchObject({ ok: false, instrucao: "Este passo anda sozinho quando chega a foto que mostra o que ele pede (o BoaVoz confere): peça a foto." });
    expect(s1.prompt()).toContain("O BoaVoz confere se ela mostra o que este passo pede");

    // escreveu sem foto: o passo segue esperando (e conta como parada)
    expect((await prePhoto(db, ["mandei?"], null)).note).toContain("ainda não mandou a foto");
    expect(runs(tables)[0].idle_turns).toBe(1);

    // foto de outra coisa: não vale, conta tentativa e a IA sabe o que faltou
    const wrong = await prePhoto(db, ["[foto]"], [CANECA], { check: answer({ ok: false, reason: "a foto mostra uma caneca, não o roteador" }) });
    expect(asked).toEqual(["Peça uma foto das luzes do roteador"]);
    expect(wrong.run?.stepId).toBe("inte0001");
    expect(wrong.note).toBe("A foto que a pessoa mandou não mostra o que este passo pede (a foto mostra uma caneca, não o roteador). Diga isso com gentileza e peça outra (tentativa 1 de 3), sem seguir para o próximo passo.");
    expect(runs(tables)[0]).toMatchObject({ attempts: 1, variables_enc: null });

    // não deu para conferir agora: manda de novo, sem contar tentativa
    const failed = await prePhoto(db, ["[foto]"], [ROTEADOR], { check: answer({ ok: false, reason: null, error: true }) });
    expect(failed.note).toContain("Não deu para conferir a foto agora");
    expect(runs(tables)[0].attempts).toBe(1);

    // a foto certa: o passo anda sozinho e a descrição fica na variável
    const right = await prePhoto(db, ["[foto]"], [ROTEADOR], { check: answer({ ok: true, reason: null }) });
    expect(right.run?.stepId).toBe("inte0002");
    expect(right.note).toContain("mostra o que o passo pedia");
    expect(JSON.parse(String(runs(tables)[0].variables_enc))).toEqual({ foto_roteador: { kind: "foto", value: photoValue([ROTEADOR]) } });
  });

  it("3 fotos erradas: botões de equipe e cancelar; a equipe recebe o motivo da foto", async () => {
    const CANECA = { kind: "comum" as const, description: "Caneca preta." };
    const tables: Record<string, Row[]> = { routines: [suporte], conversations: [{ id: CONV }], messages: [] };
    const db = fakeDb(tables);
    const no = { check: async () => ({ ok: false, reason: "não é o roteador" }) };
    await prePhoto(db, ["internet"], null);
    await prePhoto(db, ["[foto]"], [CANECA], no);
    await prePhoto(db, ["[foto]"], [CANECA], no);
    const third = await prePhoto(db, ["[foto]"], [CANECA], no);
    expect(third.run?.failing).toBe(true);
    const s = routineSession(db, { bot: BOT, conversationId: CONV, waPhone: null, turn: third, texts: [], requestHandoff: async () => "aviso" })!;
    expect(s.component()).toEqual(failButtons(third.run!.id));
    expect(s.prompt()).toContain("Não deu para receber a foto pedida depois de 3 tentativas");
    const team = await pre(db, [FAIL_TEAM], { buttonId: `rt:${third.run!.id}:falha:equipe` });
    expect(team.fixed).toEqual({ kind: "handoff", reason: 'Roteiro "Internet": não deu para receber a foto pedida' });
  });

  it("a foto mandada junto do pedido: conferida, o roteiro já passa do passo; errada, o passo espera e a IA sabe o motivo", async () => {
    const start = async (verdict: { ok: boolean; reason: string | null }) => {
      const tables: Record<string, Row[]> = { routines: [suporte], conversations: [{ id: CONV }], messages: [] };
      const db = fakeDb(tables);
      const t = await prePhoto(db, ["minha internet caiu, olha o roteador"], [ROTEADOR], { check: async () => verdict });
      const s = routineSession(db, { bot: BOT, conversationId: CONV, waPhone: null, turn: t, texts: ["minha internet caiu, olha o roteador"], requestHandoff: async () => "aviso" })!;
      return { tables, out: await exec(s, "iniciar_roteiro", { nome: "Internet" }) };
    };
    const ok = await start({ ok: true, reason: null });
    expect(ok.out).toMatchObject({ ok: true, passo: "2 de 2" });
    expect(JSON.parse(String(runs(ok.tables)[0].variables_enc))).toEqual({ foto_roteador: { kind: "foto", value: photoValue([ROTEADOR]) } });
    const miss = await start({ ok: false, reason: "a foto não mostra as luzes" });
    expect(miss.out).toMatchObject({ ok: true, passo: "1 de 2" });
    expect(String(miss.out.instrucao)).toContain("não mostra o que este passo pede (a foto não mostra as luzes)");
    expect(runs(miss.tables)[0].variables_enc).toBeNull();
  });

  it("sem como receber foto (site, leitura desligada): o passo fica para trás", async () => {
    const tables: Record<string, Row[]> = { routines: [suporte], conversations: [{ id: CONV }], messages: [] };
    const db = fakeDb(tables);
    const t = await prePhoto(db, ["internet"], null, { can: false });
    expect(t.run?.stepId).toBe("inte0002");
    expect(runs(tables)[0].variables_enc).toBeNull();
  });
});
