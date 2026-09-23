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
