import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/*
 * Banco em memória com o pedaço do PostgREST que o roteiro, a identificação, as ações e os avisos
 * usam (filtros simples, or com eq/neq/is, upsert por coluna, contagem, os embeds pela chave
 * estrangeira, um roteiro ativo por conversa e o rpc do limite de chamadas, sempre liberado). Serve
 * à avaliação de roteiros (eval-routines.ts), que roda o motor de verdade sem gravar nada no banco,
 * e aos testes.
 */

/** Embed do PostgREST: a tabela citada no select e a coluna que aponta para ela. */
const EMBED_FK: Record<string, string> = { routines: "routine_id", agency_members: "member_id", agencies: "agency_id", bots: "bot_id" };

export type MemRow = Record<string, unknown>;

/** Índices únicos que os testes conferem (null não conflita, como no Postgres). */
const UNIQUE: Record<string, string[][]> = {
  idempotency_keys: [["api_key_id", "key"]],
  clients: [["agency_id", "external_id"]],
  bots: [["client_id", "external_id"]],
  instagram_comments: [["bot_id", "comment_id"]],
};
const conflicts = (t: MemRow[], table: string, row: MemRow) =>
  (UNIQUE[table] ?? []).some((cols) => cols.every((c) => row[c] !== null && row[c] !== undefined) && t.some((x) => cols.every((c) => x[c] === row[c])));

/** Valores padrão das tabelas que o motor cria (como os defaults das migrações). */
function defaultsOf(table: string, now: string): MemRow {
  if (table === "bots") return { public_key: randomUUID().replace(/-/g, "").slice(0, 24), is_demo: false, is_template: false };
  if (table === "audit_log") return { created_at: now };
  if (table === "routine_runs") return { status: "active", attempts: 0, failing: false, variables_enc: null, end_reason: null, ended_at: null, held_result: null, idle_turns: 0, started_at: now };
  if (table === "contact_links") return { linked_at: now, unlinked_at: null, source: "pairing", identity_key_hash: null };
  return {};
}

export function memoryDb(tables: Record<string, MemRow[]>): SupabaseClient {
  let tick = 0;
  // linked_at e started_at em ordem de criação (o motor ordena por eles)
  const stamp = () => new Date(Date.now() + tick++).toISOString();

  class Query {
    filters: Array<(r: MemRow) => boolean> = [];
    op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
    patch: MemRow = {};
    rows: MemRow[] = [];
    conflict = "id";
    orderBy: { col: string; asc: boolean } | null = null;
    lim = 0;
    embeds: string[] = [];
    head = false;
    constructor(public table: string) {}
    select(cols?: string, o?: { count?: string; head?: boolean }) {
      if (this.op === "select") {
        this.embeds = [...(cols ?? "").matchAll(/\b([a-z_]+)\s*\(/g)].map((m) => m[1]).filter((n) => n in EMBED_FK);
        this.head = Boolean(o?.head);
      }
      return this;
    }
    insert(r: MemRow | MemRow[]) {
      this.op = "insert";
      this.rows = Array.isArray(r) ? r : [r];
      return this;
    }
    ignoreDuplicates = false;
    upsert(r: MemRow | MemRow[], o?: { onConflict?: string; ignoreDuplicates?: boolean }) {
      this.op = "upsert";
      this.rows = Array.isArray(r) ? r : [r];
      this.conflict = o?.onConflict ?? "id";
      this.ignoreDuplicates = Boolean(o?.ignoreDuplicates);
      return this;
    }
    update(p: MemRow) {
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
    match(o: MemRow) {
      for (const [c, v] of Object.entries(o)) this.eq(c, v);
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
    gte(c: string, v: string) {
      this.filters.push((r) => typeof r[c] === "string" && (r[c] as string) >= v);
      return this;
    }
    lte(c: string, v: string) {
      this.filters.push((r) => typeof r[c] === "string" && (r[c] as string) <= v);
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
    /** "a.is.null,b.neq.x,c.not.is.null,d.in.(x,y),e.lt.\"2026-…\"": basta um bater. */
    or(expr: string) {
      // vírgulas dentro de in.(...) não separam
      const pieces = expr.match(/[^,(]+(?:\([^)]*\))?/g) ?? [];
      const parts = pieces.map((p) => {
        const m = /^([a-z_]+)\.(not\.)?(eq|neq|is|in|lt|gt)\.(.*)$/.exec(p.trim());
        if (!m) throw new Error(`banco em memória: or("${p}") não suportado`);
        const [, col, not, op, quoted] = m;
        const raw = quoted.replace(/^"|"$/g, "");
        const v = raw === "null" ? null : raw;
        const list = op === "in" ? raw.replace(/^\(|\)$/g, "").split(",") : [];
        const cmp = (r: MemRow) => (typeof r[col] === "string" ? ((r[col] as string) < raw ? -1 : (r[col] as string) > raw ? 1 : 0) : null);
        const hit = (r: MemRow) =>
          op === "in" ? list.includes(String(r[col])) : op === "lt" ? (cmp(r) ?? 0) < 0 : op === "gt" ? (cmp(r) ?? 0) > 0 : op === "neq" ? (r[col] ?? null) !== v : (r[col] ?? null) === v;
        return not ? (r: MemRow) => !hit(r) : hit;
      });
      this.filters.push((r) => parts.some((f) => f(r)));
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
      return { data: (r.data as MemRow[] | null)?.[0] ?? null, error: r.error };
    }
    async single() {
      const r = await this.exec();
      const d = r.data as MemRow[] | null;
      return d?.length ? { data: d[0], error: null } : { data: null, error: r.error ?? { message: "sem linha" } };
    }
    then<A, B>(res: (v: { data: unknown; error: unknown; count?: number }) => A, rej?: (e: unknown) => B) {
      return this.exec().then(res, rej);
    }
    async exec(): Promise<{ data: unknown; error: { message: string } | null; count?: number }> {
      const t = (tables[this.table] ??= []);
      if (this.op === "insert") {
        const out: MemRow[] = [];
        for (const r of this.rows) {
          const row: MemRow = { id: randomUUID(), ...defaultsOf(this.table, stamp()), ...r };
          // um roteiro ativo por conversa (o índice único parcial da migração 0107)
          if (this.table === "routine_runs" && t.some((x) => x.conversation_id === row.conversation_id && x.status === "active")) return { data: null, error: { message: "duplicate key value violates unique constraint" } };
          if (conflicts(t, this.table, row)) return { data: null, error: { message: "duplicate key value violates unique constraint" } };
          t.push(row);
          out.push(row);
        }
        return { data: out.map((r) => ({ ...r })), error: null };
      }
      if (this.op === "upsert") {
        // onConflict com várias colunas ("bot_id,media_id"): bate em todas; ignoreDuplicates (ON
        // CONFLICT DO NOTHING) deixa a linha que já existe e devolve só as novas
        const cols = this.conflict.split(",").map((c) => c.trim());
        const out: MemRow[] = [];
        for (const r of this.rows) {
          const hit = t.find((x) => cols.every((c) => x[c] === r[c]));
          if (hit && this.ignoreDuplicates) continue;
          if (hit) Object.assign(hit, r);
          else t.push({ ...r });
          out.push(hit ?? t[t.length - 1]);
        }
        return { data: out.map((r) => ({ ...r })), error: null };
      }
      let rows = t.filter((r) => this.filters.every((f) => f(r)));
      if (this.op === "update") {
        for (const r of rows) Object.assign(r, this.patch);
        return { data: rows.map((r) => ({ ...r })), error: null };
      }
      if (this.op === "delete") {
        tables[this.table] = t.filter((r) => !rows.includes(r));
        return { data: rows.map((r) => ({ ...r })), error: null, count: rows.length };
      }
      if (this.orderBy) {
        const { col, asc } = this.orderBy;
        // id de mensagem é número: 10 vem depois de 9
        const cmp = (a: unknown, b: unknown) => (typeof a === "number" && typeof b === "number" ? a - b : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);
        rows = [...rows].sort((a, b) => cmp(a[col], b[col]) * (asc ? 1 : -1));
      }
      const count = rows.length;
      if (this.lim) rows = rows.slice(0, this.lim);
      if (this.head) return { data: null, error: null, count };
      const joined = (r: MemRow) => Object.fromEntries(this.embeds.map((n) => [n, (tables[n] ?? []).find((x) => x.id === r[EMBED_FK[n]]) ?? null]));
      return { data: rows.map((r) => ({ ...r, ...joined(r) })), error: null, count };
    }
  }
  return {
    from: (t: string) => new Query(t),
    // o limite de chamadas das ações (hit_rate_limit) sempre libera; o resto não existe aqui
    rpc: async (fn: string) => (fn === "hit_rate_limit" ? { data: true, error: null } : { data: null, error: { message: `banco em memória: rpc ${fn} não existe` } }),
  } as unknown as SupabaseClient;
}
