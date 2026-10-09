import { describe, expect, it } from "vitest";
import { actionInputFromForm, webhookInputFromForm } from "../integrations-input";
import { TRIAL_KEY_PERMISSIONS } from "../integrations-plan";
import { can } from "../roles";

const form = (fields: Record<string, string | string[]>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
  return fd;
};

describe("formulários das Integrações", () => {
  it("ação: lê o cadastro e recusa parâmetros que não são JSON", () => {
    const a = actionInputFromForm(form({ name: "buscar_pedido", description: " Use para status ", url: "https://api.loja.com/x", params_schema: '{"type":"object","properties":{}}', min_level: "usuario", context_required: "signed", outcomes: "ok, sem_debito", active: "on" }));
    expect(a).toEqual({ name: "buscar_pedido", description: "Use para status", url: "https://api.loja.com/x", params_schema: { type: "object", properties: {} }, min_level: "usuario", context_required: "signed", outcomes: ["ok", "sem_debito"], active: true });
    expect(actionInputFromForm(form({ params_schema: "{nope" }))).toEqual({ error: "Os parâmetros não são um JSON válido." });
    // nível desconhecido vira o mais aberto; sem a caixa, desativada
    expect(actionInputFromForm(form({ min_level: "admin" }))).toMatchObject({ min_level: "anonimo", active: false, context_required: "none" });
  });

  it("webhook: só HTTPS público e ao menos um evento conhecido", () => {
    expect(webhookInputFromForm(form({ name: "Loja", url: "https://hooks.loja.com/boavoz", event: ["contact.linked", "evento.inventado"] }))).toEqual({ name: "Loja", url: "https://hooks.loja.com/boavoz", events: ["contact.linked"] });
    expect(webhookInputFromForm(form({ name: "Loja", url: "http://hooks.loja.com", event: "contact.linked" }))).toEqual({ error: "O webhook precisa ser HTTPS." });
    expect(webhookInputFromForm(form({ name: "Loja", url: "https://127.0.0.1/x", event: "contact.linked" }))).toEqual({ error: "Endereço interno não é aceito." });
    expect(webhookInputFromForm(form({ name: "Loja", url: "https://hooks.loja.com", event: "evento.inventado" }))).toEqual({ error: "Marque ao menos um evento." });
    expect(webhookInputFromForm(form({ name: "", url: "https://hooks.loja.com", event: "contact.linked" }))).toMatchObject({ error: expect.stringMatching(/nome/) });
  });

  it("quem mexe nas Integrações e o que o teste grátis libera", () => {
    expect(["owner", "admin", "editor", "agent"].map((r) => can(r as never, "integrations"))).toEqual([true, true, false, false]);
    expect(TRIAL_KEY_PERMISSIONS).not.toContain("messages");
    expect(TRIAL_KEY_PERMISSIONS).not.toContain("campaigns");
  });
});

describe("cabeçalhos personalizados", () => {
  it("lê Nome: valor e recusa os reservados", async () => {
    const { parseCustomHeaders } = await import("../custom-headers");
    expect(parseCustomHeaders("x-api-key: abc123\nX-Tenant: loja-1")).toEqual({ headers: { "x-api-key": "abc123", "X-Tenant": "loja-1" } });
    expect(parseCustomHeaders("webhook-signature: x")).toMatchObject({ error: expect.stringMatching(/reservado/) });
    expect(parseCustomHeaders("Content-Type: text/plain")).toMatchObject({ error: expect.stringMatching(/reservado/) });
    expect(parseCustomHeaders("sem dois pontos")).toMatchObject({ error: expect.stringMatching(/Nome: valor/) });
    expect(parseCustomHeaders("x-a: 1\nX-A: 2")).toMatchObject({ error: expect.stringMatching(/duas vezes/) });
  });
});
