import { describe, expect, it } from "vitest";
import { accountStopReason, allowance, billedAsMarketing, campaignNoticeEffect, costText, decideSend, estimateCampaign, missingSecrets, nextSendStatus, qualityDropped, reportNumbers, sendErrorOutcome, templateProblem, tickCallHint, tierLimit } from "../campaigns";
import { isPromoOptOutButton } from "../suppression";

const base: Parameters<typeof decideSend>[0] = { templateCategory: "MARKETING", suppressed: [], consent: "granted", regulated: false, age: null, contactGone: false };
const approved = (category: string, components: Array<{ type: string; format?: string; text?: string }> = [{ type: "BODY", text: "Oi {{1}}" }]) => ({ status: "APPROVED", category, components });

describe("campanhas: limite do portfólio", () => {
  it("nível da Meta em contatos únicos por 24 h", () => {
    expect(tierLimit("TIER_250")).toBe(250);
    expect(tierLimit("TIER_1K")).toBe(1000);
    expect(tierLimit("tier_10k")).toBe(10_000);
    expect(tierLimit("TIER_UNLIMITED")).toBe(Number.POSITIVE_INFINITY);
    // sem a informação, o menor nível
    expect(tierLimit(null)).toBe(250);
    expect(tierLimit("TIER_NOVO")).toBe(250);
  });

  it("saldo: o que falta nas 24 h, com o teto do tique", () => {
    expect(allowance({ limit: 250, recent: 0 })).toBe(150);
    expect(allowance({ limit: 250, recent: 200 })).toBe(50);
    expect(allowance({ limit: 250, recent: 300 })).toBe(0);
    expect(allowance({ limit: Number.POSITIVE_INFINITY, recent: 10_000, perTick: 40 })).toBe(40);
  });
});

describe("campanhas: conferência antes de cada envio", () => {
  it("marketing só com o aceite de novidades", () => {
    expect(decideSend(base)).toBe("send");
    expect(decideSend({ ...base, consent: "none" })).toBe("skipped_no_consent");
    expect(decideSend({ ...base, consent: "revoked" })).toBe("skipped_no_consent");
    expect(decideSend({ ...base, consent: "declined" })).toBe("skipped_no_consent");
  });

  it("lembrete de utilidade não pede o aceite de novidades", () => {
    expect(decideSend({ ...base, templateCategory: "UTILITY", consent: "none" })).toBe("send");
  });

  it("SAIR vale pela categoria do modelo", () => {
    expect(decideSend({ ...base, suppressed: ["marketing"] })).toBe("skipped_suppressed");
    expect(decideSend({ ...base, templateCategory: "UTILITY", consent: "none", suppressed: ["marketing"] })).toBe("send");
    expect(decideSend({ ...base, templateCategory: "UTILITY", consent: "none", suppressed: ["utility"] })).toBe("skipped_suppressed");
    expect(decideSend({ ...base, suppressed: ["all"] })).toBe("skipped_suppressed");
  });

  it("bebida ou remédio: só com 18+ confirmado", () => {
    expect(decideSend({ ...base, regulated: true, age: "sim" })).toBe("send");
    expect(decideSend({ ...base, regulated: true, age: null })).toBe("skipped_no_age");
    expect(decideSend({ ...base, regulated: true, age: "nao" })).toBe("skipped_no_age");
  });

  it("contato apagado vem antes de tudo", () => {
    expect(decideSend({ ...base, contactGone: true })).toBe("skipped_contact_deleted");
  });
});

describe("campanhas: erros e status da Meta", () => {
  it("131050 é descadastro; ritmo volta para a fila; o resto é falha", () => {
    expect(sendErrorOutcome(131050)).toBe("opted_out");
    expect(sendErrorOutcome(130429)).toBe("retry");
    expect(sendErrorOutcome(131056)).toBe("retry");
    expect(sendErrorOutcome(131026)).toBe("failed");
    expect(sendErrorOutcome(undefined)).toBe("failed");
  });

  it("status só avança", () => {
    expect(nextSendStatus("sending", "sent")).toBe("sent");
    expect(nextSendStatus("uncertain", "delivered")).toBe("delivered");
    expect(nextSendStatus("sent", "read")).toBe("read");
    expect(nextSendStatus("read", "delivered")).toBeNull();
    expect(nextSendStatus("delivered", "sent")).toBeNull();
    // pulado nas conferências não muda por status (nem deveria ter status)
    expect(nextSendStatus("skipped_no_consent", "sent")).toBeNull();
  });

  it("falha depois do envio: com erro ou descadastro", () => {
    expect(nextSendStatus("sent", "failed", 131026)).toBe("failed");
    expect(nextSendStatus("uncertain", "failed", 131050)).toBe("opted_out");
    expect(nextSendStatus("delivered", "failed")).toBeNull();
  });
});

describe("campanhas: o modelo na hora de enviar", () => {
  it("aprovado e na categoria certa", () => {
    expect(templateProblem("marketing", approved("MARKETING"))).toBeNull();
    expect(templateProblem("utility_reminder", approved("UTILITY"))).toBeNull();
  });

  it("pausa quando some, deixa de estar aprovado ou a Meta reclassifica o lembrete", () => {
    expect(templateProblem("marketing", null)).toMatch(/não existe/);
    expect(templateProblem("marketing", { ...approved("MARKETING"), status: "PAUSED" })).toMatch(/não está aprovado/);
    expect(templateProblem("utility_reminder", approved("MARKETING"))).toMatch(/utilidade para marketing/);
  });

  it("recurso que o BoaVoz ainda não envia", () => {
    expect(templateProblem("marketing", approved("MARKETING", [{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: "Oi" }]))).toMatch(/imagem/);
  });
});

describe("campanhas: diagnóstico do tique automático", () => {
  const call = (o: Partial<Parameters<typeof tickCallHint>[0]>) => tickCallHint({ created: "2026-10-08T23:00:00Z", status_code: null, timed_out: false, error: null, body: null, ...o });

  it("explica a resposta do BoaVoz", () => {
    expect(call({ status_code: 200, body: "{}" })).toMatch(/^ok/);
    expect(call({ status_code: 401, body: "unauthorized" })).toMatch(/CRON_SECRET/);
    expect(call({ status_code: 401, body: "<html>Authentication Required ... Vercel</html>" })).toMatch(/proteção da Vercel/);
    expect(call({ status_code: 302 })).toMatch(/proteção da Vercel/);
    expect(call({ status_code: 404 })).toMatch(/endereço errado/);
    expect(call({ status_code: 500 })).toMatch(/erro no BoaVoz/);
    expect(call({ error: "Couldn't resolve host name" })).toMatch(/não chegou/);
    expect(call({ timed_out: true })).toMatch(/a tempo/);
  });

  it("segredos que faltam no cofre (a liberação da Vercel é opcional)", () => {
    expect(missingSecrets({ pg_net: true, pg_cron: true, secrets: [] })).toEqual(["boavoz_campaigns_url", "boavoz_cron_secret"]);
    expect(missingSecrets({ pg_net: true, pg_cron: true, secrets: ["boavoz_campaigns_url", "boavoz_cron_secret"] })).toEqual([]);
  });
});

describe("campanhas: proteções da parte 3b", () => {
  it("nota de qualidade: pausa só quando cai desde o começo (ou a retomada)", () => {
    expect(qualityDropped("GREEN", "YELLOW")).toBe(true);
    expect(qualityDropped("YELLOW", "RED")).toBe(true);
    expect(qualityDropped("green", "red")).toBe(true);
    expect(qualityDropped("YELLOW", "GREEN")).toBe(false);
    expect(qualityDropped("RED", "RED")).toBe(false);
    // sem nota de um dos lados, não pausa
    expect(qualityDropped(null, "RED")).toBe(false);
    expect(qualityDropped("GREEN", "UNKNOWN")).toBe(false);
  });

  it("lembrete cobrado como marketing: reclassificado", () => {
    expect(billedAsMarketing("utility_reminder", "marketing")).toBe(true);
    expect(billedAsMarketing("utility_reminder", "utility")).toBe(false);
    expect(billedAsMarketing("marketing", "marketing")).toBe(false);
    expect(billedAsMarketing("utility_reminder", undefined)).toBe(false);
  });

  it("chatbot pausado, teste vencido e assinatura cancelada param; cota esgotada não", () => {
    expect(accountStopReason({ botPaused: true, planPaused: false, block: null })).toMatch(/pausado/);
    expect(accountStopReason({ botPaused: false, planPaused: true, block: null })).toMatch(/limite do plano/);
    expect(accountStopReason({ botPaused: false, planPaused: false, block: "trial_expired" })).toMatch(/teste grátis/);
    expect(accountStopReason({ botPaused: false, planPaused: false, block: "cancelled" })).toMatch(/cancelada/);
    expect(accountStopReason({ botPaused: false, planPaused: false, block: "quota_exceeded" })).toBeNull();
    expect(accountStopReason({ botPaused: false, planPaused: false, block: "paused" })).toBeNull();
    expect(accountStopReason({ botPaused: false, planPaused: false, block: null })).toBeNull();
  });
});

describe("campanhas: avisos da Meta", () => {
  it("qualidade: só o FLAGGED pausa, e só o número do aviso", () => {
    const e = campaignNoticeEffect("phone_number_quality_update", { display_phone_number: "5521999990000", event: "FLAGGED", current_limit: "TIER_1K" });
    expect(e?.where).toEqual({ phone: "5521999990000" });
    expect(e?.reason).toMatch(/qualidade/);
    expect(campaignNoticeEffect("phone_number_quality_update", { display_phone_number: "5521999990000", event: "UPGRADE" })).toBeNull();
    expect(campaignNoticeEffect("phone_number_quality_update", { event: "UNFLAGGED" })).toBeNull();
  });

  it("modelo pausado, desativado ou recusado pausa as campanhas dele", () => {
    const e = campaignNoticeEffect("message_template_status_update", { event: "PAUSED", message_template_name: "promo_sexta", message_template_language: "pt_BR", reason: "LOW_QUALITY" });
    expect(e?.where).toEqual({ templateName: "promo_sexta", templateLanguage: "pt_BR" });
    expect(e?.reason).toBe("a Meta pausou o modelo promo_sexta (motivo: LOW_QUALITY)");
    expect(campaignNoticeEffect("message_template_status_update", { event: "DISABLED", message_template_name: "x", reason: "NONE" })?.reason).toBe("a Meta desativou o modelo x");
    expect(campaignNoticeEffect("message_template_status_update", { event: "APPROVED", message_template_name: "x" })).toBeNull();
    expect(campaignNoticeEffect("message_template_status_update", { event: "PAUSED" })).toBeNull();
  });

  it("utilidade que vira marketing pausa só os lembretes, com a dica de pedir revisão", () => {
    const e = campaignNoticeEffect("template_category_update", { message_template_name: "lembrete_consulta", message_template_language: "pt_BR", previous_category: "UTILITY", new_category: "MARKETING" });
    expect(e?.where).toEqual({ templateName: "lembrete_consulta", templateLanguage: "pt_BR", kinds: ["utility_reminder"] });
    expect(e?.extra.join(" ")).toMatch(/revisão/);
    // aviso antecipado (correct_category) também pausa
    expect(campaignNoticeEffect("template_category_update", { message_template_name: "y", correct_category: "MARKETING" })).not.toBeNull();
    expect(campaignNoticeEffect("template_category_update", { message_template_name: "y", previous_category: "MARKETING", new_category: "UTILITY" })).toBeNull();
  });
});

describe("campanhas: estimativa", () => {
  it("custo pela categoria e dias pelo limite de 24 h", () => {
    expect(estimateCampaign({ contacts: 100, price: 0.35, limit: 250, recent: 0 })).toEqual({ contacts: 100, costBrl: 35, days: 1 });
    expect(estimateCampaign({ contacts: 1000, price: 0.035, limit: 1000, recent: 0 })).toEqual({ contacts: 1000, costBrl: 35, days: 1 });
    // 250 hoje, depois 250 por dia: 1.000 contatos levam 4 dias
    expect(estimateCampaign({ contacts: 1000, price: 0.35, limit: 250, recent: 0 }).days).toBe(4);
    // o portfólio já usou 200 hoje: sobram 50, e os outros 150 saem amanhã
    expect(estimateCampaign({ contacts: 200, price: 0.35, limit: 250, recent: 200 }).days).toBe(2);
    expect(estimateCampaign({ contacts: 50_000, price: 0.35, limit: Number.POSITIVE_INFINITY, recent: 0 }).days).toBe(1);
    expect(estimateCampaign({ contacts: 0, price: 0.35, limit: 250, recent: 0 })).toEqual({ contacts: 0, costBrl: 0, days: 0 });
  });

  it("custo em reais", () => {
    expect(costText(34.38).replace(/\s/g, " ")).toBe("≈ R$ 34,38");
  });
});

describe("campanhas: relatório (parte 4b)", () => {
  it("funil: lidas contam como entregues, e entregues como enviadas", () => {
    const n = reportNumbers({ status: { sent: 2, delivered: 3, read: 5, uncertain: 1, failed: 1, queued: 4, skipped_no_consent: 2, skipped_suppressed: 1 }, replied: 2, optOut: { sair: 1, whatsapp: 1 }, errors: { "131049": 1 } });
    expect(n).toEqual({ sent: 11, delivered: 8, read: 5, replied: 2, failed: 1, optOuts: 2, skipped: 3, pending: 4, uncertain: 1 });
  });

  it("o botão Parar promoções é descadastro de marketing", () => {
    expect(isPromoOptOutButton("Parar promoções")).toBe(true);
    expect(isPromoOptOutButton("SAIR")).toBe(false);
    expect(isPromoOptOutButton(null)).toBe(false);
  });
});
