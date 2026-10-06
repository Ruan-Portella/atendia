import { afterEach, describe, expect, it } from "vitest";
import { canTakeOver, humanAgentUntil, timeLeft } from "../presence";
import { RESUME_TEMPLATE_NAME, resumeStatus, resumeTemplateBody } from "../whatsapp-templates";
import type { Template } from "../template-text";

const NOW = Date.parse("2026-10-06T12:00:00Z");
const ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const ig = (lastUserHoursAgo: number) => ({ channel: "instagram", last_message_at: ago(lastUserHoursAgo), last_user_at: ago(lastUserHoursAgo), handoff_requested_at: null, takeover_at: null, handled_at: null });

describe("Instagram: atendimento humano até 7 dias (human_agent)", () => {
  afterEach(() => {
    delete process.env.INSTAGRAM_HUMAN_AGENT;
  });

  it("sem a tag liberada, só as 24 h", () => {
    expect(canTakeOver(ig(23), NOW)).toBe(true);
    expect(canTakeOver(ig(30), NOW)).toBe(false);
    expect(humanAgentUntil(ig(30), NOW)).toBeNull();
  });

  it("com a tag liberada, a equipe responde até 7 dias depois da última mensagem do contato", () => {
    process.env.INSTAGRAM_HUMAN_AGENT = "1";
    expect(canTakeOver(ig(30), NOW)).toBe(true);
    expect(humanAgentUntil(ig(30), NOW)?.toISOString()).toBe(new Date(Date.parse(ago(30)) + 7 * 86_400_000).toISOString());
    expect(canTakeOver(ig(24 * 7 + 1), NOW)).toBe(false);
    // o WhatsApp não muda: só as 24 h
    expect(canTakeOver({ ...ig(30), channel: "whatsapp" }, NOW)).toBe(false);
  });

  it("quanto falta, em português", () => {
    expect(timeLeft(new Date(NOW + 3 * 86_400_000 + 3_600_000), NOW)).toBe("3 dias");
    expect(timeLeft(new Date(NOW + 5 * 3_600_000), NOW)).toBe("5 horas");
    expect(timeLeft(new Date(NOW + 20 * 60_000), NOW)).toBe("20 minutos");
  });
});

describe("WhatsApp: modelo padrão de retomada", () => {
  const t = (o: Partial<Template>): Template => ({ id: "1", name: RESUME_TEMPLATE_NAME, status: "APPROVED", category: "UTILITY", language: "pt_BR", components: [], ...o }) as Template;

  it("texto com o nome do negócio fixo e o do contato em {{1}}", () => {
    expect(resumeTemplateBody("Pizzaria do Zé")).toBe("Olá, {{1}}! Aqui é a equipe de Pizzaria do Zé. Sua conversa com a gente ficou parada e queremos continuar o seu atendimento. Responda esta mensagem para seguirmos por aqui.");
    expect(resumeTemplateBody("{{2}} *X*")).toContain("equipe de 2 X.");
  });

  it("estado pela lista da Meta", () => {
    expect(resumeStatus([])).toBe("ausente");
    expect(resumeStatus([t({})])).toBe("aprovado");
    expect(resumeStatus([t({ status: "PENDING" })])).toBe("em_analise");
    expect(resumeStatus([t({ status: "REJECTED" })])).toBe("recusado");
    expect(resumeStatus([t({ category: "MARKETING" })])).toBe("reclassificado");
  });
});
