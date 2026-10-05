import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { accessProblem, can, inviteOpen, inviteTokenHash, memberLimit, memberName, newInviteToken, scopeFromForm, type AgencyRole, type Permission } from "../team";
import { safeLocalPath } from "../utils";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

describe("papéis da equipe", () => {
  it("cada papel vê só o que pode", () => {
    const matrix: Record<AgencyRole, Permission[]> = {
      owner: ["attend", "config", "team", "security", "brand", "export", "billing"],
      admin: ["attend", "config", "team", "security", "brand", "export"],
      editor: ["attend", "config"],
      agent: ["attend"],
    };
    const perms: Permission[] = ["attend", "config", "team", "security", "brand", "export", "billing"];
    for (const [role, allowed] of Object.entries(matrix) as Array<[AgencyRole, Permission[]]>) {
      for (const p of perms) expect(can(role, p), `${role} ${p}`).toBe(allowed.includes(p));
    }
  });

  it("limite de pessoas por plano, com o dono", () => {
    expect(memberLimit("trial")).toBe(2);
    expect(memberLimit("freelancer")).toBe(2);
    expect(memberLimit("agencia")).toBe(5);
    expect(memberLimit("escala")).toBe(15);
    expect(memberLimit("plano-que-nao-existe")).toBe(1);
  });

  it("convite vale até vencer, ser aceito ou cancelado", () => {
    const now = Date.parse("2026-10-05T12:00:00Z");
    const base = { accepted_at: null, removed_at: null, invite_expires_at: "2026-10-06T12:00:00Z" };
    expect(inviteOpen(base, now)).toBe(true);
    expect(inviteOpen({ ...base, invite_expires_at: "2026-10-05T11:00:00Z" }, now)).toBe(false);
    expect(inviteOpen({ ...base, accepted_at: "2026-10-05T10:00:00Z" }, now)).toBe(false);
    expect(inviteOpen({ ...base, removed_at: "2026-10-05T10:00:00Z" }, now)).toBe(false);
    expect(inviteOpen({ ...base, invite_expires_at: null }, now)).toBe(false);
  });

  it("token do convite: guardado só em hash", () => {
    const t = newInviteToken();
    expect(t).toMatch(/^[\w-]{32}$/);
    expect(inviteTokenHash(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(inviteTokenHash(t)).toBe(inviteTokenHash(t));
    expect(newInviteToken()).not.toBe(t);
  });

  it("escopo do formulário: só ids válidos, sem repetir; 'todos' ignora a lista", () => {
    const fd = new FormData();
    fd.set("scope", "selected");
    for (const v of [`client:${UUID_A}`, `client:${UUID_A}`, `bot:${UUID_B}`, "bot:'; drop table", "outra:coisa"]) fd.append("scope_item", v);
    expect(scopeFromForm(fd)).toEqual({ scope: "selected", clientIds: [UUID_A], botIds: [UUID_B] });
    fd.set("scope", "all");
    expect(scopeFromForm(fd)).toEqual({ scope: "all", clientIds: [], botIds: [] });
  });

  it("dono e administrador veem tudo; escopo escolhido precisa de algo marcado", () => {
    const some = { scope: "selected" as const, clientIds: [UUID_A], botIds: [] };
    expect(accessProblem("admin", some)).toMatch(/veem todos/);
    expect(accessProblem("agent", { scope: "selected", clientIds: [], botIds: [] })).toMatch(/pelo menos um/);
    expect(accessProblem("agent", some)).toBeNull();
    expect(accessProblem("admin", { scope: "all", clientIds: [], botIds: [] })).toBeNull();
  });

  it("nome para mostrar", () => {
    expect(memberName({ display_name: " Viviane ", email: "vivi@agencia.com" })).toBe("Viviane");
    expect(memberName({ display_name: null, email: "vivi@agencia.com" })).toBe("vivi");
  });

  it("volta só para caminhos deste site", () => {
    expect(safeLocalPath("/convite/abc", "/")).toBe("/convite/abc");
    expect(safeLocalPath("//evil.com", "/")).toBe("/");
    expect(safeLocalPath("/\\evil.com", "/")).toBe("/");
    expect(safeLocalPath("https://evil.com", "/")).toBe("/");
    expect(safeLocalPath("/a\nb", "/")).toBe("/");
    expect(safeLocalPath(null, "/painel")).toBe("/painel");
  });
});

describe("ações do painel conferem o papel", () => {
  it("toda ação exportada chama allowed(), menos as que valem para qualquer papel", () => {
    const src = readFileSync(join(__dirname, "../../app/painel/actions.ts"), "utf8");
    // valem para qualquer pessoa logada da equipe: o próprio segundo fator, as próprias sessões, o próprio aviso
    const anyRole = new Set(["recordAgencyMfa", "recordMfaRemoved", "endOtherSessions", "hideOnboarding"]);
    const missing: string[] = [];
    for (const m of src.matchAll(/^export async function (\w+)\([^\n]*\{\n((?:.*\n){1,3})/gm)) {
      if (!anyRole.has(m[1]) && !m[2].includes("await allowed(")) missing.push(m[1]);
    }
    expect(missing).toEqual([]);
    expect(src.match(/^export async function /gm)?.length).toBeGreaterThan(50);
  });

  it("nenhuma tela ou rota acha a agência pelo dono (a equipe entra pelo vínculo)", () => {
    for (const f of ["app/api/files/[id]/route.ts", "app/api/demo/route.ts", "app/api/exportar/route.ts", "app/painel/actions.ts", "lib/access-log.ts"]) {
      const src = readFileSync(join(__dirname, "../..", f), "utf8");
      expect(src, f).not.toMatch(/eq\("owner_id"|agency\.owner_id/);
    }
  });
});
