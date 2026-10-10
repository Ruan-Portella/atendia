import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { channelObject, complianceChanged, complianceSummary, consentSource, publicStatus, restrictionsOf, templateEventData, trackCompliance } from "../platform-events";
import { resetWebhookCache } from "../message-events";
import { campaignFinishedData } from "../campaigns";
import { WEBHOOK_EVENTS, WEBHOOK_EVENT_GROUPS } from "../webhooks";

describe("eventos sem conteúdo de conversa (C pública, parte 2b)", () => {
  it("os eventos novos estão na lista e nos grupos do editor", () => {
    for (const e of ["contact.opted_in", "contact.opted_out", "campaign.finished", "channel.connected", "channel.disconnected", "channel.issue", "template.status_changed", "bot.paused", "bot.resumed", "compliance.changed"] as const) {
      expect(WEBHOOK_EVENTS).toContain(e);
    }
    expect(WEBHOOK_EVENT_GROUPS.map((g) => g.label)).toEqual(["Mensagens", "Atendimento", "Contato", "Campanhas", "Canais", "Conformidade"]);
  });

  it("canal no evento: id estável pelo número ou pela conta, e o que o contato vê", () => {
    expect(channelObject({ type: "whatsapp", phoneNumberId: "123", display: "+55 21 99999-0000" })).toEqual({ id: "chn_wa_123", type: "whatsapp", display: "+55 21 99999-0000" });
    expect(channelObject({ type: "instagram", igUserId: "987", username: "loja" })).toEqual({ id: "chn_ig_987", type: "instagram", display: "@loja" });
    expect(channelObject({ type: "instagram", igUserId: "987", username: null }).display).toBeNull();
  });

  it("aviso de modelo da Meta vira template.status_changed (motivo NONE some)", () => {
    expect(templateEventData({ event: "APPROVED", message_template_name: "boas_vindas", message_template_language: "pt_BR", reason: "NONE" })).toEqual({
      template: { name: "boas_vindas", language: "pt_BR", category: null, status: "approved", reason: null },
    });
    expect(templateEventData({ event: "REJECTED", message_template_name: "promo", message_template_language: "pt_BR", message_template_category: "MARKETING", reason: "INVALID_FORMAT" })?.template).toMatchObject({ status: "rejected", category: "marketing", reason: "INVALID_FORMAT" });
    expect(templateEventData({ event: "PAUSED" })).toBeNull();
  });

  it("origem do aceite ou do descadastro a partir do que foi gravado", () => {
    expect(consentSource("chat")).toBe("chat");
    expect(consentSource("chat:sair:12")).toBe("chat");
    expect(consentSource("meta")).toBe("meta");
    expect(consentSource("panel:ana@agencia.com")).toBe("panel");
    expect(consentSource("api")).toBe("api");
  });

  it("estado público do negócio: revisão (as duas) e bloqueado; sem revisão é ativo", () => {
    expect(publicStatus("ativo")).toBe("active");
    expect(publicStatus("em_revisao")).toBe("review");
    expect(publicStatus("aguardando_revisao")).toBe("review");
    expect(publicStatus("bloqueado")).toBe("blocked");
    expect(publicStatus(null)).toBe("active");
  });

  it("medidas viram restrições sem repetição; o que é só registro não entra", () => {
    const r = restrictionsOf([
      { source: "boavoz", feature: "channel", channel: "whatsapp" },
      { source: "boavoz", feature: "channel", channel: "whatsapp" },
      { source: "boavoz", feature: "channel", channel: "all" },
      { source: "meta_order", feature: "channel", channel: "whatsapp" },
      { source: "meta_violation", feature: "regulados", channel: "whatsapp" },
      { source: "meta_restriction", feature: "restricao", channel: "whatsapp" },
      { source: "meta_order", feature: "outro", channel: "whatsapp" },
    ]);
    expect(r).toEqual([
      { type: "campaigns", channel: "whatsapp", source: "meta" },
      { type: "channel", channel: null, source: "boavoz" },
      { type: "channel", channel: "whatsapp", source: "boavoz" },
      { type: "channel", channel: "whatsapp", source: "meta" },
      { type: "regulated_flows", channel: "whatsapp", source: "meta" },
    ]);
  });

  it("muda quando o estado ou as restrições mudam", () => {
    const a = { status: "active" as const, restrictions: [] };
    expect(complianceChanged(a, { status: "active", restrictions: [] })).toBe(false);
    expect(complianceChanged(a, { status: "review", restrictions: [] })).toBe(true);
    expect(complianceChanged(a, { status: "active", restrictions: [{ type: "channel", channel: "instagram", source: "boavoz" }] })).toBe(true);
  });

  it("resumo e próximo passo sem o texto interno da revisão", () => {
    expect(complianceSummary({ status: "blocked", restrictions: [{ type: "channel", channel: "whatsapp", source: "boavoz" }] }).reason_summary).toContain("bloqueado na revisão");
    expect(complianceSummary({ status: "review", restrictions: [] }).next_step).toContain("Aguarde");
    expect(complianceSummary({ status: "active", restrictions: [] })).toEqual({ reason_summary: "Sem restrições em vigor.", next_step: null });
    const both = complianceSummary({ status: "active", restrictions: [{ type: "channel", channel: "whatsapp", source: "meta" }, { type: "channel", channel: "instagram", source: "boavoz" }] });
    expect(both.reason_summary).toContain("A Meta desativou a conta do WhatsApp");
    expect(both.reason_summary).toContain("O Instagram está suspenso pelo BoaVoz");
    expect(both.next_step).toContain("Gerenciador do WhatsApp");
    expect(both.next_step).toContain("suporte do BoaVoz");
  });

  it("totais do campaign.finished: incerto conta como enviado; contato apagado entra em suprimido", () => {
    const data = campaignFinishedData(
      { id: "c1", name: "Black Friday", kind: "utility_reminder" },
      { status: { sent: 2, delivered: 3, read: 4, uncertain: 1, failed: 1, skipped_no_consent: 5, skipped_no_age: 1, skipped_suppressed: 2, skipped_contact_deleted: 1 }, replied: 0, optOut: { sair: 2, whatsapp: 1 }, errors: {} },
    );
    expect(data.campaign).toEqual({ id: "cmp_c1", name: "Black Friday", kind: "reminder", sent: 10, delivered: 7, read: 4, failed: 1, skipped_no_consent: 5, skipped_no_age: 1, skipped_suppressed: 3, opted_out: 3 });
  });

  it("sem webhook ativo, a conformidade não é consultada e a mudança roda igual", async () => {
    resetWebhookCache();
    const from = vi.fn((table: string) => {
      const chain = { select: () => chain, eq: () => chain, is: () => Promise.resolve({ data: table === "webhooks" ? [] : null }) };
      return chain;
    });
    const db = { from } as unknown as SupabaseClient;
    const change = vi.fn(async () => "feito");
    expect(await trackCompliance(db, ["cli1"], "revisao:1", change)).toBe("feito");
    expect(change).toHaveBeenCalledOnce();
    expect(from.mock.calls.map((c) => c[0])).toEqual(["webhooks"]);
    resetWebhookCache();
  });
});
