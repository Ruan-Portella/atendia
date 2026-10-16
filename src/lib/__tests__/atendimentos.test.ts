import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { botQuotaEmail, contactKeyHash, openAtendimento, quotaAlertLevel, sizeLabel } from "../atendimentos";
import { SIZE_QUOTAS, botQuota } from "../quota";
import { ANSWERS_PER_ATENDIMENTO, BOT_SIZES } from "../plans";

process.env.CONTACT_HASH_KEY ??= "chave-de-teste-com-mais-de-16-caracteres";

describe("cota do mês, por chatbot", () => {
  it("a cota vem do tamanho; o Volume é por pacote; sem tamanho, zero", () => {
    expect(botQuota({ size: "P" })).toBe(160);
    expect(botQuota({ size: "M" })).toBe(340);
    expect(botQuota({ size: "G" })).toBe(680);
    expect(botQuota({ size: "volume", volume_packs: 3 })).toBe(3000);
    expect(botQuota({ size: "volume", volume_packs: null })).toBe(0);
    expect(botQuota({ size: null })).toBe(0);
    expect(botQuota({ size: "XL" })).toBe(0);
  });

  it("a cota combinada fora da tabela (sob medida) vale no lugar da do tamanho", () => {
    expect(botQuota({ size: "P", quota_override: 5000 })).toBe(5000);
    expect(botQuota({ size: "G", quota_override: 0 })).toBe(0);
  });

  it("a tabela que vai para o banco bate com os tamanhos", () => {
    expect(SIZE_QUOTAS).toEqual({ P: 160, M: 340, G: 680, volume: 1000 });
    expect(ANSWERS_PER_ATENDIMENTO).toBe(40);
    expect(Object.values(BOT_SIZES).map((s) => s.priceBrl)).toEqual([49, 99, 199, 299]);
  });

  it("nome do tamanho nas telas", () => {
    expect(sizeLabel({ size: "M", volumePacks: null, override: null })).toBe("M");
    expect(sizeLabel({ size: "volume", volumePacks: 1, override: null })).toBe("Volume (1 pacote)");
    expect(sizeLabel({ size: "volume", volumePacks: 3, override: null })).toBe("Volume (3 pacotes)");
    expect(sizeLabel({ size: "P", volumePacks: null, override: 900 })).toBe("sob medida");
    expect(sizeLabel({ size: null, volumePacks: null, override: null })).toBe("sem tamanho");
  });
});

describe("avisos de cota do chatbot (cada um sai uma vez: o contador sobe de 1 em 1)", () => {
  it("80%, 95% e 100%, sem tolerância", () => {
    expect(quotaAlertLevel(128, 160)).toBe(80);
    expect(quotaAlertLevel(127, 160)).toBeNull();
    expect(quotaAlertLevel(129, 160)).toBeNull();
    expect(quotaAlertLevel(152, 160)).toBe(95);
    expect(quotaAlertLevel(160, 160)).toBe(100);
    expect(quotaAlertLevel(161, 160)).toBeNull();
    expect(quotaAlertLevel(1, 0)).toBeNull();
  });

  it("cota pequena: 95% cai no 100% e não repete", () => {
    expect(quotaAlertLevel(4, 5)).toBe(80);
    expect(quotaAlertLevel(5, 5)).toBe(100);
  });

  it("os e-mails dizem o chatbot, os números e que só ele para", () => {
    const bot = { name: "Zé", clientName: "Bar do Zé" };
    const [s80, l80] = botQuotaEmail(80, bot, 128, 160, "outubro de 2026", "https://x/uso");
    expect(s80).toBe("Zé (Bar do Zé): 80% dos atendimentos do mês");
    expect(l80.join(" ")).toContain("128 de 160");
    expect(l80.join(" ")).toContain("só este chatbot");
    const [s100, l100] = botQuotaEmail(100, { name: "Zé", clientName: null }, 160, 160, "outubro de 2026", "https://x/uso");
    expect(s100).toBe("Zé: a cota de atendimentos do mês acabou");
    expect(l100.join(" ")).toContain("modo só humano");
    expect(l100.join(" ")).toContain("40 respostas");
    expect(l100.join(" ")).not.toContain("tolerância");
  });
});

describe("abertura do atendimento", () => {
  afterEach(() => vi.restoreAllMocks());

  /** Banco falso: devolve a linha de open_atendimento e guarda os parâmetros. */
  function fake(row: Record<string, unknown> | null, error: { message: string } | null = null) {
    const calls: Array<Record<string, unknown>> = [];
    const db = {
      rpc: vi.fn(async (_fn: string, args: Record<string, unknown>) => (calls.push(args), { data: row ? [row] : null, error })),
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
    } as unknown as SupabaseClient;
    return { db, calls };
  }
  const bot = { id: "b1", agency_id: "a1" };

  it("a chave do contato vai em hash, diferente por canal, e a cota de cada tamanho e o limite de respostas vão junto", async () => {
    const { db, calls } = fake({ status: "aberto", atendimento_id: 7 });
    const r = await openAtendimento(db, bot, { channel: "whatsapp", contactKey: "contato-1", conversationId: "c1" });
    expect(r).toEqual({ blocked: null, isNew: false, id: 7, overage: false });
    expect(calls[0].p_contact_key_hash).toBe(contactKeyHash("whatsapp", "contato-1"));
    expect(calls[0].p_contact_key_hash).not.toContain("contato-1");
    expect(contactKeyHash("widget", "contato-1")).not.toBe(contactKeyHash("whatsapp", "contato-1"));
    expect(calls[0].p_size_quotas).toEqual(SIZE_QUOTAS);
    expect(calls[0].p_answer_limit).toBe(40);
    expect(calls[0].p_overage_price).toBe(0.35);
  });

  it("sem vaga: a cota do chatbot acabou", async () => {
    expect((await openAtendimento(fake({ status: "cota" }).db, bot, { channel: "widget", contactKey: "v1", conversationId: null })).blocked).toBe("quota_exceeded");
  });

  it("novo: conta 1", async () => {
    const r = await openAtendimento(fake({ status: "novo", atendimento_id: 9, used: 10, quota: 160 }).db, bot, { channel: "whatsapp", contactKey: "k", conversationId: "c" });
    expect(r).toEqual({ blocked: null, isNew: true, id: 9, overage: false });
  });

  it("erro do banco não para o bot", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await openAtendimento(fake(null, { message: "timeout" }).db, bot, { channel: "whatsapp", contactKey: "k", conversationId: "c" });
    expect(r.blocked).toBeNull();
  });
});
