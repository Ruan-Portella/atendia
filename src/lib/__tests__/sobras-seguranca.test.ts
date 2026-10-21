import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/*
 * Leva das sobras, parte 3: recusar o pedido do titular com o motivo (nada é apagado; a pessoa
 * recebe o motivo) e encerrar as sessões de outra pessoa da equipe (a regra e a conferência pela
 * hora da entrada no token).
 */

const saved = vi.hoisted(() => [] as Array<{ conversation_id: string; content: string }>);
vi.mock("../messages", async (orig) => ({
  ...(await orig<typeof import("../messages")>()),
  saveMessage: vi.fn(async (_db: unknown, m: { conversation_id: string; content: string }) => (saved.push(m), 1)),
}));

import { memoryDb, type MemRow } from "../memory-db";
import { ERASURE_TEXTS, refuseReasonProblem, refuseRequest } from "../data-subject";
import { endMemberSessions, sessionRevoked } from "../team";

const AG = "aaaaaaaa-0000-4000-8000-000000000001";

describe("recusar o pedido do titular", () => {
  it("o motivo é obrigatório (de 10 a 500 letras)", () => {
    expect(refuseReasonProblem("não")).toContain("pelo menos 10 letras");
    expect(refuseReasonProblem("x".repeat(501))).toContain("500");
    expect(refuseReasonProblem("As notas fiscais ficam por 5 anos (obrigação legal).")).toBeNull();
    expect(ERASURE_TEXTS.refused("Clínica Sol", "As notas fiscais ficam por 5 anos.")).toBe("A Clínica Sol analisou o seu pedido para apagar os dados deste atendimento e não vai apagar agora. Motivo: As notas fiscais ficam por 5 anos. Se tiver dúvida, responda por aqui.");
  });

  it("recusa só o que está aguardando, guarda quem e por quê, e a pessoa recebe o motivo", async () => {
    const t: Record<string, MemRow[]> = {
      data_subject_requests: [{ id: "r1", agency_id: AG, bot_id: "b1", conversation_id: "c1", status: "aguardando", refused_at: null }],
      bots: [{ id: "b1", agency_id: AG, client_id: "cl1", client_name: "Clínica Sol", name: "Lia" }],
      conversations: [{ id: "c1", channel: "widget", wa_id: null, ig_id: null, last_contact_at: new Date().toISOString() }],
    };
    const db = memoryDb(t);
    expect(await refuseRequest(db, "r1", "ana@agencia.com", "  As notas fiscais ficam por 5 anos   (obrigação legal)  ")).toEqual({ told: true });
    expect(t.data_subject_requests[0]).toMatchObject({ status: "recusado", refused_by: "ana@agencia.com", refuse_reason: "As notas fiscais ficam por 5 anos (obrigação legal)" });
    expect(t.data_subject_requests[0].contact_notified_at).toBeTruthy();
    expect(saved).toEqual([{ conversation_id: "c1", role: "assistant", author: "sistema", content: "A Clínica Sol analisou o seu pedido para apagar os dados deste atendimento e não vai apagar agora. Motivo: As notas fiscais ficam por 5 anos (obrigação legal). Se tiver dúvida, responda por aqui." }]);
    // já recusado: não recusa de novo
    expect(await refuseRequest(db, "r1", "ana@agencia.com", "outro motivo qualquer")).toBeNull();
  });
});

describe("encerrar as sessões de outra pessoa da equipe", () => {
  const member = (id: string, role: string, extra: MemRow = {}): MemRow => ({ id, agency_id: AG, user_id: `u-${id}`, email: `${id}@agencia.com`, role, scope: "all", display_name: null, avatar_url: null, invited_by: null, invited_at: "2026-10-01T10:00:00Z", invite_expires_at: null, accepted_at: "2026-10-01T10:00:00Z", removed_at: null, sessions_revoked_at: null, ...extra });
  const setup = () => {
    const t: Record<string, MemRow[]> = { agency_members: [member("dono", "owner"), member("admin", "admin"), member("editor", "editor"), member("convidado", "attendant", { user_id: null, accepted_at: null })] };
    const mem = memoryDb(t);
    const calls: string[] = [];
    const db = { from: mem.from.bind(mem), rpc: async (fn: string, a: { p_user: string }) => (calls.push(`${fn}:${a.p_user}`), { data: 2, error: null }) } as unknown as SupabaseClient;
    return { t, db, calls };
  };

  it("a mesma regra de remover: o dono não, a si mesmo não, administrador só pelo dono", async () => {
    const { db } = setup();
    const by = (actorRole: "owner" | "admin", actorMemberId: string, memberId: string) => endMemberSessions(db, { agencyId: AG, memberId, actorRole, actorMemberId });
    expect(await by("admin", "admin", "dono")).toMatchObject({ ok: false, message: expect.stringContaining("dono") });
    expect(await by("admin", "admin", "admin")).toMatchObject({ ok: false, message: expect.stringContaining("Segurança") });
    expect(await by("admin", "editor", "admin")).toMatchObject({ ok: false, message: expect.stringContaining("Só o dono") });
    expect(await by("owner", "dono", "convidado")).toMatchObject({ ok: false, message: expect.stringContaining("ainda não entrou") });
  });

  it("marca a pessoa e apaga as sessões no Auth; a sessão aberta antes cai", async () => {
    const { t, db, calls } = setup();
    const now = new Date("2026-10-21T15:00:00Z");
    const r = await endMemberSessions(db, { agencyId: AG, memberId: "editor", actorRole: "admin", actorMemberId: "admin", now });
    expect(r).toMatchObject({ ok: true, ended: 2 });
    expect(t.agency_members[2].sessions_revoked_at).toBe(now.toISOString());
    expect(calls).toEqual(["end_user_sessions:u-editor"]);
    const before = [{ method: "otp", timestamp: Date.parse("2026-10-21T14:00:00Z") / 1000 }];
    const after = [{ method: "oauth", timestamp: Date.parse("2026-10-21T15:05:00Z") / 1000 }];
    expect(sessionRevoked(before, now.toISOString())).toBe(true);
    expect(sessionRevoked(after, now.toISOString())).toBe(false);
    expect(sessionRevoked(before, null)).toBe(false);
    // token sem o horário da entrada: não derruba (o Auth já cortou a renovação)
    expect(sessionRevoked([{ method: "otp" }], now.toISOString())).toBe(false);
  });
});
