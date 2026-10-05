import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACTION_GROUPS, ACTION_LABELS, actorText, auditCsv, auditFilters, targetNamer, type AuditRow } from "../audit-view";
import { SECURITY_ALERTS, isSecurityAlert } from "../security-alerts";
import { deviceOf } from "../access-log";

const SRC = join(__dirname, "..", "..");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "__tests__" || n === "node_modules" ? [] : files(p);
    return /\.(ts|tsx)$/.test(n) ? [p] : [];
  });

describe("tela de Segurança", () => {
  it("toda ação gravada na auditoria tem rótulo em português e tipo no filtro", () => {
    const actions = new Set<string>();
    for (const f of files(SRC)) {
      const code = readFileSync(f, "utf8");
      for (const m of code.matchAll(/(?:auditPanel|auditAdmin)\(\s*[^"`)]*?"([a-z_]+(?:\.[a-z_]+)+)"|action: "([a-z_]+(?:\.[a-z_]+)+)"/g)) actions.add(m[1] ?? m[2]);
    }
    // as que são montadas (retencao.${plan.kind})
    for (const k of ["reducao", "aumento", "desfazer"]) actions.add(`retencao.${k}`);
    const missing = [...actions].filter((a) => !ACTION_LABELS[a]);
    expect(missing).toEqual([]);
    expect(actions.size).toBeGreaterThan(60);
  });

  it("alertas: os eventos graves", () => {
    expect(isSecurityAlert("api.chave.criar")).toBe(true);
    expect(isSecurityAlert("suporte.liberar")).toBe(true);
    expect(isSecurityAlert("seguranca.mfa_remover")).toBe(true);
    expect(isSecurityAlert("conversa.assumir")).toBe(false);
    for (const a of Object.keys(SECURITY_ALERTS)) expect(ACTION_GROUPS[a.split(".")[0]], a).toBeTruthy();
  });

  it("filtros da URL: só valores conhecidos", () => {
    expect(auditFilters({ dias: "90", quem: "support", tipo: "canal", cliente: "11111111-1111-4111-8111-111111111111" })).toEqual({ days: 90, actor: "support", group: "canal", clientId: "11111111-1111-4111-8111-111111111111" });
    expect(auditFilters({ dias: "3", quem: "hacker", tipo: "x", cliente: "1 or 1=1" })).toEqual({ days: 30, actor: "", group: "", clientId: "" });
  });

  it("quem fez, alvo e CSV", () => {
    expect(actorText({ actor_type: "user", actor_id: "dono" }, "dono")).toBe("Você");
    expect(actorText({ actor_type: "member", actor_id: "ana@loja.com" }, "dono")).toBe("Área do cliente (ana@loja.com)");
    expect(actorText({ actor_type: "support", actor_id: "x@boavoz.com" }, "dono")).toBe("Equipe BoaVoz");
    const nameOf = targetNamer(new Map([["c1", "Pizzaria"]]), new Map([["b1", "Atendente"]]));
    expect(nameOf({ target_type: "bot", target_id: "b1" })).toBe("Chatbot Atendente");
    expect(nameOf({ target_type: "webhook", target_id: "w" })).toBe("Webhook");
    const row: AuditRow = { id: 1, actor_type: "support", actor_id: "x", action: "webhook.criar", target_type: "webhook", target_id: "w", before: null, after: { url: "https://a.com/h", name: "x;y" }, created_at: "2026-10-05T15:00:00Z" };
    const csv = auditCsv([row], "dono", nameOf);
    expect(csv.startsWith("﻿Data;Quem;Evento;Código;Alvo;Antes;Depois\r\n")).toBe(true);
    expect(csv).toContain(";Equipe BoaVoz;Webhook criado (URL nova);webhook.criar;Webhook;;");
    expect(csv).toContain('"{""url"":""https://a.com/h"",""name"":""x;y""}"');
  });

  it("aparelho a partir do navegador", () => {
    expect(deviceOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36")).toBe("Chrome no Windows");
    expect(deviceOf("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")).toBe("Safari no iPhone/iPad");
    expect(deviceOf(null)).toBe("");
  });
});
