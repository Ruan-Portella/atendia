import { describe, expect, it } from "vitest";
import { botPriority, fitToLimit, memberPriority, planChanges, planLimits, type PlanBot, type PlanMember, type PlanSnapshot } from "../plan-limits";
import { decideMode, type ModeFacts } from "../conversation-mode";

describe("limites por plano", () => {
  it("Freelancer sem Integrações; o teste segue o Agência; webhooks = chatbots", () => {
    expect(planLimits("freelancer")).toEqual({ bots: 3, members: 2, webhooks: 0, integrations: false });
    expect(planLimits("agencia")).toEqual({ bots: 15, members: 5, webhooks: 15, integrations: true });
    expect(planLimits("trial").integrations).toBe(true);
    expect(planLimits("cancelado")).toMatchObject({ bots: 0, integrations: false });
  });
});

describe("fitToLimit", () => {
  const items = (n: number, paused: number[] = []) => Array.from({ length: n }, (_, i) => ({ id: `i${i}`, paused: paused.includes(i) }));

  it("pausa os últimos da ordem de prioridade", () => {
    expect(fitToLimit(items(5), 3)).toEqual({ pause: ["i3", "i4"], resume: [] });
  });

  it("dentro do limite, nada muda; com vaga, voltam os primeiros pausados", () => {
    expect(fitToLimit(items(3), 3)).toEqual({ pause: [], resume: [] });
    expect(fitToLimit(items(5, [1, 3, 4]), 4)).toEqual({ pause: [], resume: ["i1", "i3"] });
  });

  it("o dono nunca pausa, mesmo fora da ordem", () => {
    const list = [{ id: "a", paused: false }, { id: "b", paused: false }, { id: "dono", paused: false, keep: true }];
    expect(fitToLimit(list, 2)).toEqual({ pause: ["b"], resume: [] });
    expect(fitToLimit(list, 1)).toEqual({ pause: ["a", "b"], resume: [] });
  });
});

describe("prioridade", () => {
  const bot = (id: string, last: string | null, created: string): PlanBot => ({ id, name: id, client_name: null, created_at: created, paused_by_plan_at: null, last_activity: last });

  it("chatbots: conversa mais recente primeiro; sem conversa, os mais antigos", () => {
    const list = [bot("novo-parado", null, "2026-09-01"), bot("ativo", "2026-10-05", "2026-08-01"), bot("velho-parado", null, "2026-07-01"), bot("menos-ativo", "2026-09-20", "2026-06-01")];
    expect(list.sort(botPriority).map((b) => b.id)).toEqual(["ativo", "menos-ativo", "velho-parado", "novo-parado"]);
  });

  it("equipe: dono, admins, editores e atendentes que já entraram; convites por último", () => {
    const m = (id: string, role: PlanMember["role"], accepted: string | null, invited = "2026-09-01"): PlanMember => ({ id, email: `${id}@x.com`, display_name: null, role, user_id: null, invited_at: invited, accepted_at: accepted, removed_at: null, invite_expires_at: "2026-12-01", paused_by_plan_at: null });
    const list = [m("convite", "admin", null), m("editor", "editor", "2026-09-02"), m("dono", "owner", "2026-01-01"), m("admin2", "admin", "2026-09-10"), m("admin1", "admin", "2026-09-05")];
    expect(list.sort(memberPriority).map((x) => x.id)).toEqual(["dono", "admin1", "admin2", "editor", "convite"]);
  });
});

describe("planChanges", () => {
  const snap = (planId: string, o: Partial<PlanSnapshot> = {}): PlanSnapshot => ({ planId, planName: planId, limits: planLimits(planId), bots: [], members: [], webhooks: [], actions: { active: 0, pausedByPlan: 0 }, ...o });

  it("downgrade para o Freelancer: pausa as ações e os webhooks", () => {
    const c = planChanges(snap("freelancer", { webhooks: [{ id: "w1", name: "w", url: "https://x", active: true, created_at: "2026-09-01", paused_by_plan_at: null }], actions: { active: 4, pausedByPlan: 0 } }));
    expect(c.webhooks.pause).toEqual(["w1"]);
    expect(c.actions).toBe("pause");
  });

  it("de volta ao Agência: as ações voltam", () => {
    expect(planChanges(snap("agencia", { actions: { active: 0, pausedByPlan: 4 } })).actions).toBe("resume");
    expect(planChanges(snap("agencia", { actions: { active: 4, pausedByPlan: 0 } })).actions).toBeNull();
  });
});

describe("estado da conversa", () => {
  const facts: ModeFacts = { channel: "whatsapp", channelDisconnected: false, metaOrder: false, whatsappDisabled: false, metaPaymentIssue: false, boavozSuspended: false, humanInConversation: false, botPaused: false, botPauseNotify: false, humanOnly: null, coexistence: false };

  it("chatbot pausado pelo plano é modo só humano: a IA não responde e vira pedido de atendente", () => {
    const m = decideMode({ ...facts, humanOnly: "plan_paused" });
    expect(m).toMatchObject({ state: "so_humano", aiResponds: false, handoff: true, blockReason: "plan_paused", canSend: true });
  });
});
