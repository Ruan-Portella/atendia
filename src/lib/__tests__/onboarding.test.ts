import { describe, expect, it } from "vitest";
import { onboardingSteps, type OnboardingBot } from "../onboarding";

const bot = (over: Partial<OnboardingBot> = {}): OnboardingBot => ({ id: "b1", status: "draft", installed_at: null, readySources: 0, testConversations: 0, ...over });
const done = (steps: ReturnType<typeof onboardingSteps>) => steps.filter((s) => s.done).map((s) => s.key);

describe("onboardingSteps", () => {
  it("agência nova: nada feito e tudo aponta para criar o chatbot", () => {
    const steps = onboardingSteps({ bots: [], hasLogo: false });
    expect(done(steps)).toEqual([]);
    expect(steps.find((s) => s.key === "fontes")?.href).toBe("/painel/bots/novo");
  });

  it("marca os passos pelo que o chatbot já tem", () => {
    const steps = onboardingSteps({ bots: [bot({ readySources: 2, testConversations: 1 })], hasLogo: true });
    expect(done(steps)).toEqual(["bot", "fontes", "teste", "marca"]);
    expect(steps.find((s) => s.key === "instalar")?.href).toBe("/painel/bots/b1?tab=instalacao");
  });

  it("usa o chatbot mais adiantado, não o primeiro da lista", () => {
    const steps = onboardingSteps({ bots: [bot({ id: "novo" }), bot({ id: "pronto", status: "live", readySources: 1, testConversations: 3, installed_at: "2026-09-20T10:00:00Z" })], hasLogo: false });
    expect(done(steps)).toEqual(["bot", "fontes", "teste", "publicar", "instalar"]);
    expect(steps.find((s) => s.key === "teste")?.href).toBe("/painel/bots/pronto");
  });
});

describe("onboardingSteps pelo perfil do primeiro acesso", () => {
  it("sem perfil, os passos da agência (o site do cliente)", () => {
    expect(onboardingSteps({ bots: [], hasLogo: false, profile: null }).map((s) => s.key)).toEqual(["bot", "fontes", "teste", "publicar", "instalar", "marca"]);
    expect(onboardingSteps({ bots: [], hasLogo: false, profile: "agency" })[1].title).toBe("Treine com o site do cliente");
  });

  it("meu negócio: o WhatsApp conectado conta como levar para fora do painel", () => {
    const steps = onboardingSteps({ bots: [bot({ status: "live", readySources: 1, testConversations: 1, channels: 1 })], hasLogo: false, profile: "business" });
    expect(steps.find((s) => s.key === "instalar")).toMatchObject({ title: "Leve para o site ou o WhatsApp", done: true });
    expect(steps[1].title).toBe("Treine com o seu site");
    expect(done(steps)).toEqual(["bot", "fontes", "teste", "publicar", "instalar"]);
  });

  it("dev: chave, webhook, pacote e a primeira chamada", () => {
    const fresh = onboardingSteps({ bots: [], hasLogo: false, profile: "developer" });
    expect(fresh.map((s) => s.key)).toEqual(["bot", "fontes", "chave", "webhook", "pacote", "chamada"]);
    expect(done(fresh)).toEqual([]);
    expect(fresh.find((s) => s.key === "chamada")?.href).toBe("/docs/comeco-rapido");
    const steps = onboardingSteps({ bots: [bot({ readySources: 1 })], hasLogo: false, profile: "developer", dev: { keys: 1, keyUsed: true, webhooks: 0, integrations: true } });
    expect(done(steps)).toEqual(["bot", "fontes", "chave", "pacote", "chamada"]);
  });
});
