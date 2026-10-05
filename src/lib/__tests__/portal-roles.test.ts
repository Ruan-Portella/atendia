import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isPortalRole, memberCan, safeMemberNext, type Membership } from "../member";
import { parseHoursForm } from "../handoff-hours";

const CLIENT = "11111111-1111-4111-8111-111111111111";

const who = (o: Partial<Pick<Membership, "role" | "allowHandoff" | "allowKnowledge" | "allowHours">>) => ({ role: "manager" as const, allowHandoff: true, allowKnowledge: true, allowHours: true, ...o });

describe("papéis do portal", () => {
  it("gestor faz o que a agência liberou; atendente só atende", () => {
    expect(memberCan(who({}), "manager")).toBe(true);
    expect(memberCan(who({}), "knowledge")).toBe(true);
    expect(memberCan(who({}), "hours")).toBe(true);
    expect(memberCan(who({ allowHours: false }), "hours")).toBe(false);
    expect(memberCan(who({ allowKnowledge: false }), "knowledge")).toBe(false);
    const agent = who({ role: "agent" });
    expect(memberCan(agent, "handoff")).toBe(true);
    expect(memberCan(agent, "manager")).toBe(false);
    expect(memberCan(agent, "knowledge")).toBe(false);
    expect(memberCan(agent, "hours")).toBe(false);
    // sem atender liberado, ninguém atende
    expect(memberCan(who({ allowHandoff: false }), "handoff")).toBe(false);
    expect(isPortalRole("manager")).toBe(true);
    expect(isPortalRole("owner")).toBe(false);
  });

  it("volta do segundo fator só para páginas deste cliente", () => {
    expect(safeMemberNext(CLIENT, `/cliente/${CLIENT}/conversas/abc-123`)).toBe(`/cliente/${CLIENT}/conversas/abc-123`);
    expect(safeMemberNext(CLIENT, `/cliente/${CLIENT}/privacidade`)).toBe(`/cliente/${CLIENT}/privacidade`);
    expect(safeMemberNext(CLIENT, "/cliente/22222222-2222-4222-8222-222222222222/privacidade")).toBe(`/cliente/${CLIENT}`);
    expect(safeMemberNext(CLIENT, `/cliente/${CLIENT}//evil.com`)).toBe(`/cliente/${CLIENT}`);
    expect(safeMemberNext(CLIENT, "https://evil.com")).toBe(`/cliente/${CLIENT}`);
    expect(safeMemberNext(CLIENT, null)).toBe(`/cliente/${CLIENT}`);
  });

  it("horário do formulário", () => {
    expect(parseHoursForm({ hours_open_1: "09:00", hours_close_1: "18:00", hours_open_6: "", hours_close_6: "" })).toEqual({ hours: { "1": ["09:00", "18:00"] } });
    expect(parseHoursForm({})).toEqual({ hours: null });
    expect(parseHoursForm({ hours_open_2: "18:00", hours_close_2: "09:00" })).toEqual({ error: "Horário de terça inválido: a abertura precisa vir antes do fechamento." });
    expect("error" in parseHoursForm({ hours_open_3: "9h", hours_close_3: "18:00" })).toBe(true);
  });
});

describe("ações do portal conferem o papel", () => {
  it("toda ação exportada diz a permissão que exige, menos as que valem para qualquer papel", () => {
    const src = readFileSync(join(__dirname, "../../app/cliente/actions.ts"), "utf8");
    // qualquer pessoa logada do portal: entrar, o próprio perfil e o próprio segundo fator
    const anyRole = new Set(["requestAccessLink", "confirmAccess", "memberUpdateProfile", "recordMemberMfa", "recordMemberMfaRemoved"]);
    const missing: string[] = [];
    for (const m of src.matchAll(/^export async function (\w+)\([^\n]*\{\n((?:.*\n){1,3})/gm)) {
      if (anyRole.has(m[1])) continue;
      const gated = /memberForAction\(clientId, "(handoff|knowledge|hours|manager)"\)|ownConversation\(|ownBot\(/.test(m[2]);
      if (!gated) missing.push(m[1]);
    }
    expect(missing).toEqual([]);
  });
});

describe("modo dados sensíveis", () => {
  it("o texto do aviso e da tela", async () => {
    const { sensitiveChangeText, sensitiveSavedText } = await import("../sensitive-mode");
    const on = { name: "Bia", on: true, days: 30, afterLabel: "30 dias", before: { sensitive_mode: false, sensitive_retention_days: null }, toggled: true, reduced: true };
    expect(sensitiveChangeText(on)).toBe("ligou o modo dados sensíveis do assistente Bia: as conversas dele passam a ser apagadas depois de 30 dias");
    expect(sensitiveSavedText({ ...on, on: false, afterLabel: "12 meses" })).toBe("Modo dados sensíveis desligado: vale o prazo de 12 meses.");
  });

  it("a agência liga pelo painel com a mesma regra do portal (dono e administrador)", () => {
    const src = readFileSync(join(__dirname, "../../app/painel/actions.ts"), "utf8");
    const fn = src.slice(src.indexOf("export async function setBotSensitiveMode("));
    expect(fn.slice(0, 200)).toContain('allowed("security")');
    expect(fn.slice(0, 2000)).toContain("applySensitiveMode(");
    const portal = readFileSync(join(__dirname, "../../app/cliente/actions.ts"), "utf8");
    expect(portal).toContain("applySensitiveMode(");
  });
});
