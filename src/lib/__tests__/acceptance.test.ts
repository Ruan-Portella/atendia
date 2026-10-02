import { describe, expect, it } from "vitest";
import { ACCEPTANCE_VERSION, ACTIVITIES, acceptanceEmail, addBusinessDays, connectBlock, parseAnswers, statusFor, type ActivityAnswers, type Compliance } from "../acceptance";

const allNo = Object.fromEntries(ACTIVITIES.map((a) => [a.id, "nao"])) as ActivityAnswers;
const compliance = (status: Compliance["status"], extra: Partial<Compliance> = {}): Compliance => ({ status, answers: allNo, answeredAt: "2026-10-02T12:00:00Z", answeredBy: null, reviewDueAt: null, reviewNote: null, ...extra });

describe("pergunta de atividades", () => {
  it("tudo não: ativo; sim ou não sei em algum item: revisão com o canal funcionando", () => {
    expect(statusFor(allNo)).toBe("ativo");
    expect(statusFor({ ...allNo, saude: "sim" })).toBe("em_revisao");
    expect(statusFor({ ...allNo, dinheiro: "nao_sei" })).toBe("em_revisao");
  });

  it("sim em vender IA como produto segura o WhatsApp (vence os outros itens)", () => {
    expect(statusFor({ ...allNo, ia_produto: "sim" })).toBe("aguardando_revisao");
    expect(statusFor({ ...allNo, ia_produto: "sim", saude: "nao_sei" })).toBe("aguardando_revisao");
    expect(statusFor({ ...allNo, ia_produto: "nao_sei" })).toBe("em_revisao");
  });

  it("lê as respostas do formulário e recusa se faltar alguma ou vier valor estranho", () => {
    const fd = new FormData();
    for (const a of ACTIVITIES) fd.set(`atividade_${a.id}`, "nao");
    expect(parseAnswers(fd)).toEqual(allNo);
    fd.set("atividade_saude", "talvez");
    expect(parseAnswers(fd)).toBeNull();
    fd.delete("atividade_saude");
    expect(parseAnswers(fd)).toBeNull();
  });

  it("prazo da revisão em dias úteis (pula o fim de semana)", () => {
    // quinta 01/10/2026 → segunda 05/10; sexta 02/10 → terça 06/10
    expect(addBusinessDays(new Date("2026-10-01T15:00:00Z"), 2).toISOString()).toBe("2026-10-05T15:00:00.000Z");
    expect(addBusinessDays(new Date("2026-10-02T15:00:00Z"), 2).toISOString()).toBe("2026-10-06T15:00:00.000Z");
    expect(addBusinessDays(new Date("2026-10-03T15:00:00Z"), 2).toISOString()).toBe("2026-10-06T15:00:00.000Z");
  });
});

describe("o que impede conectar", () => {
  it("sem aceite não conecta; com aceite e negócio ativo ou em revisão, conecta", () => {
    expect(connectBlock({ channel: "whatsapp", compliance: null, accepted: false })).toMatch(/Falta o aceite/);
    expect(connectBlock({ channel: "whatsapp", compliance: null, accepted: true })).toBeNull();
    expect(connectBlock({ channel: "whatsapp", compliance: compliance("em_revisao"), accepted: true })).toBeNull();
  });

  it("aguardando a revisão da IA segura só o WhatsApp; o Instagram conecta", () => {
    const c = compliance("aguardando_revisao", { reviewDueAt: "2026-10-06T15:00:00Z" });
    expect(connectBlock({ channel: "whatsapp", compliance: c, accepted: true })).toBe("O WhatsApp só ativa depois da revisão da BoaVoz, com resposta até 06/10.");
    expect(connectBlock({ channel: "whatsapp", compliance: c, accepted: true, neutral: true })).toBe("O WhatsApp só ativa depois da revisão, com resposta até 06/10.");
    expect(connectBlock({ channel: "instagram", compliance: c, accepted: true })).toBeNull();
  });

  it("bloqueado não conecta nenhum canal da Meta, mesmo com aceite (e diz o motivo)", () => {
    const c = compliance("bloqueado", { reviewNote: "tabacaria" });
    expect(connectBlock({ channel: "instagram", compliance: c, accepted: true })).toBe("Este negócio não pode usar o Instagram por aqui (tabacaria).");
    expect(connectBlock({ channel: "whatsapp", compliance: c, accepted: false })).toMatch(/não pode usar o WhatsApp/);
  });
});

describe("cópia do aceite", () => {
  it("leva a versão, o canal, o negócio e o link da política, com a agência como quem atende", () => {
    const m = acceptanceEmail({ name: "Zé", clientName: "Bar do Zé", channel: "whatsapp", agencyName: "Ruan Marketing", policyUrl: "https://x/conectar/t/uso-aceitavel" });
    expect(m.subject).toBe("Cópia do seu aceite: WhatsApp de Bar do Zé");
    const body = m.lines.join("\n");
    expect(body).toContain(`versão ${ACCEPTANCE_VERSION}`);
    expect(body).toContain("https://x/conectar/t/uso-aceitavel");
    expect(body).toContain("Ruan Marketing");
    expect(body).not.toMatch(/boavoz/i);
  });
});
