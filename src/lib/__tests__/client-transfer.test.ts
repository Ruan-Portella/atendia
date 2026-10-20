import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { memoryDb, type MemRow } from "../memory-db";

/*
 * Transferência de cliente (D', parte 5). O critério de aceite da spec: um teste lista as colunas
 * agency_id do banco e falha se alguma não estiver classificada como "muda" ou "fica" — aqui, pelas
 * migrações. E toda tabela que muda precisa estar no transfer_client.
 */

vi.mock("../billing-sync", () => ({ syncSubscriptionSafe: vi.fn(async () => undefined) }));

import { TRANSFER_TABLES, transferClient } from "../client-transfer";
import { syncSubscriptionSafe } from "../billing-sync";

const DIR = join(__dirname, "..", "..", "..", "supabase", "migrations");
const migrations = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ name: f, sql: readFileSync(join(DIR, f), "utf8") }));

/** As tabelas com agency_id, pelas migrações (create table e alter table add column). */
function tablesWithAgencyId(): Set<string> {
  const out = new Set<string>();
  for (const { sql } of migrations) {
    for (const m of sql.matchAll(/create table (?:if not exists )?(?:public\.)?(\w+)\s*\(([\s\S]*?)\n\s*\);/gi)) if (/^\s*agency_id\b/m.test(m[2])) out.add(m[1]);
    for (const m of sql.matchAll(/alter table (?:if exists )?(?:public\.)?(\w+)\s+add column (?:if not exists )?agency_id\b/gi)) out.add(m[1]);
    for (const m of sql.matchAll(/alter table (?:public\.)?(\w+)\s*\n(?:\s*add column[^\n]*\n)*?\s*add column (?:if not exists )?agency_id\b/gi)) out.add(m[1]);
  }
  return out;
}

describe("transferência de cliente: toda tabela com agency_id classificada", () => {
  it("cada tabela com agency_id diz se muda ou fica (e a lista não tem tabela que não existe)", () => {
    const found = tablesWithAgencyId();
    expect(found.size).toBeGreaterThan(25);
    const missing = [...found].filter((t) => !(t in TRANSFER_TABLES));
    expect(missing, "tabela nova com agency_id: decida em TRANSFER_TABLES (src/lib/client-transfer.ts) se muda ou fica na transferência").toEqual([]);
    const stale = Object.keys(TRANSFER_TABLES).filter((t) => !found.has(t));
    expect(stale).toEqual([]);
  });

  it("toda tabela que muda tem o UPDATE no transfer_client mais recente", () => {
    const last = [...migrations].reverse().find((m) => /create or replace function public\.transfer_client/.test(m.sql));
    expect(last, "nenhuma migração cria transfer_client").toBeTruthy();
    const body = last!.sql.slice(last!.sql.indexOf("create or replace function public.transfer_client"));
    for (const [t, c] of Object.entries(TRANSFER_TABLES)) {
      const moves = new RegExp(`update public\\.${t} set agency_id = p_to`).test(body);
      expect(moves, `${t}: ${c.muda ? "muda, mas transfer_client não troca o agency_id" : "fica, mas transfer_client troca o agency_id"}`).toBe(c.muda);
    }
  });
});

describe("transferClient (o que vem depois da função)", () => {
  it("as duas assinaturas, a auditoria nas duas contas e o resumo", async () => {
    const FROM = "aaaaaaaa-0000-4000-8000-000000000001";
    const TO = "dddddddd-0000-4000-8000-000000000001";
    const CLIENT = "aaaaaaaa-0000-4000-8000-0000000000c1";
    const tables: Record<string, MemRow[]> = {
      agencies: [{ id: FROM, name: "Agência Velha" }, { id: TO, name: "Plataforma Nova" }],
      clients: [{ id: CLIENT, agency_id: TO, name: "Pizzaria do Zé" }],
      audit_log: [],
    };
    const base = memoryDb(tables);
    const calls: Array<[string, unknown]> = [];
    const db = {
      from: base.from.bind(base),
      rpc: async (fn: string, args: unknown) => {
        calls.push([fn, args]);
        return fn === "transfer_client" ? { data: { from_agency_id: FROM, bot_ids: ["b1", "b2"], chatbots: 2, acoes_desligadas: 3, destino_com_assinatura: false }, error: null } : base.rpc(fn, args as never);
      },
    } as unknown as SupabaseClient;
    const r = await transferClient(db, { clientId: CLIENT, toAgencyId: TO, requestedBy: "Zé, por e-mail de 19/10", doneBy: "suporte@boavoz.com", reason: "troca de agência" });
    expect(calls[0]).toEqual(["transfer_client", { p_client: CLIENT, p_to: TO, p_requested_by: "Zé, por e-mail de 19/10", p_done_by: "suporte@boavoz.com", p_reason: "troca de agência" }]);
    expect(r).toEqual({ fromAgencyId: FROM, botIds: ["b1", "b2"], counts: { chatbots: 2, acoes_desligadas: 3, destino_com_assinatura: false } });
    expect(vi.mocked(syncSubscriptionSafe).mock.calls.map((c) => c[1]).sort()).toEqual([FROM, TO].sort());
    expect(tables.audit_log.map((a) => [a.agency_id, a.action, a.actor_type])).toEqual([
      [FROM, "cliente.transferir_saida", "support"],
      [TO, "cliente.transferir_entrada", "support"],
    ]);
    expect(tables.audit_log[0].after).toMatchObject({ cliente: "Pizzaria do Zé", para: "Plataforma Nova", pedido_por: "Zé, por e-mail de 19/10" });
  });

  it("erro da função (mesma conta, cliente que não existe) sobe com a mensagem", async () => {
    const db = { from: memoryDb({}).from, rpc: async () => ({ data: null, error: { message: "o cliente já é desta conta" } }) } as unknown as SupabaseClient;
    await expect(transferClient(db, { clientId: "x", toAgencyId: "y", requestedBy: "Zé", doneBy: "suporte", reason: null })).rejects.toThrow("o cliente já é desta conta");
  });
});
