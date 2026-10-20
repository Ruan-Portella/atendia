import { describe, expect, it } from "vitest";
import { DEFAULT_POST_RULE, OLD_PRICE, isPostHit, maskPrices, postAgeDays, postDate, postPriceNote, postPriceRuleOf, postTitleWithAge, withPostAges } from "../post-context";

/*
 * Posts do Instagram na conversa (E1, parte 1): a data e a idade do post no fuso de Brasília, o
 * preço tirado dos posts velhos na regra "limite" (também das frases do portão) e a regra no prompt.
 */

const NOW = Date.parse("2026-10-20T11:00:00-03:00");

describe("data e idade do post", () => {
  it("usa o calendário de Brasília (02:00 UTC ainda é o dia anterior)", () => {
    expect(postDate("2026-08-12T02:00:00Z")).toBe("11/08/2026");
    expect(postDate("2026-08-12T14:03:22+0000")).toBe("12/08/2026");
  });

  it("conta os dias pelo calendário: ontem à noite já é 1 dia", () => {
    expect(postAgeDays("2026-10-20T08:00:00-03:00", NOW)).toBe(0);
    expect(postAgeDays("2026-10-19T23:30:00-03:00", NOW)).toBe(1);
    expect(postAgeDays("2026-08-12T14:00:00-03:00", NOW)).toBe(69);
    // data no futuro (relógio da Meta adiantado) não vira idade negativa
    expect(postAgeDays("2026-10-21T10:00:00-03:00", NOW)).toBe(0);
  });

  it("o título diz de hoje, de ontem ou há quantos dias", () => {
    expect(postTitleWithAge("2026-10-20T08:00:00-03:00", NOW)).toBe("Post do Instagram de 20/10/2026 (de hoje)");
    expect(postTitleWithAge("2026-10-19T09:00:00-03:00", NOW)).toBe("Post do Instagram de 19/10/2026 (de ontem)");
    expect(postTitleWithAge("2026-08-12T14:00:00-03:00", NOW)).toBe("Post do Instagram de 12/08/2026 (há 69 dias)");
  });
});

describe("preço de post antigo", () => {
  it("tira os valores em reais, mas não datas, horários nem tamanhos", () => {
    expect(maskPrices("Vestido R$ 89,90, saia R$59 e o combo 1.299,00. Blusa 39,90 reais; meia 15 reais.")).toBe(`Vestido ${OLD_PRICE}, saia ${OLD_PRICE} e o combo ${OLD_PRICE}. Blusa ${OLD_PRICE}; meia ${OLD_PRICE}.`);
    expect(maskPrices("Chegou dia 12/08 às 14:30, tamanhos 36 a 44, 3 cores")).toBe("Chegou dia 12/08 às 14:30, tamanhos 36 a 44, 3 cores");
  });
});

describe("a regra do chatbot", () => {
  it("vem do chatbot, com o padrão quando falta ou não vale", () => {
    expect(postPriceRuleOf({})).toEqual(DEFAULT_POST_RULE);
    expect(postPriceRuleOf({ post_price_rule: "limite", post_price_max_days: 15 })).toEqual({ rule: "limite", maxDays: 15 });
    expect(postPriceRuleOf({ post_price_rule: "sempre", post_price_max_days: 0 })).toEqual({ rule: "sempre", maxDays: 30 });
    expect(postPriceRuleOf({ post_price_rule: "outra" })).toEqual(DEFAULT_POST_RULE);
  });

  it("o prompt muda com a regra", () => {
    expect(postPriceNote(DEFAULT_POST_RULE)).toContain("citando a data do post");
    expect(postPriceNote(DEFAULT_POST_RULE)).toContain("confirmar a disponibilidade");
    const limit = postPriceNote({ rule: "limite", maxDays: 20 });
    expect(limit).toContain("mais de 20 dias");
    expect(limit).toContain(OLD_PRICE);
    expect(postPriceNote({ rule: "sempre", maxDays: 30 })).toContain("pode informar");
    // a ação de estoque vale mais que o post, em qualquer regra
    for (const rule of ["citar", "limite", "sempre"] as const) expect(postPriceNote({ rule, maxDays: 30 })).toContain("vale mais que o post");
  });
});

describe("os trechos da busca", () => {
  const post = (posted_at: string) => ({
    content: "Legenda: Vestido midi floral R$ 129,90\nFoto (descrição automática): vestido azul. Texto na foto: \"R$ 129,90\".",
    metadata: { title: "Post do Instagram de 12/08/2026", url: "https://www.instagram.com/p/abc/", kind: "instagram_post", posted_at },
    gate_segments: [{ t: "Legenda: Vestido midi floral R$ 129,90", l: 0 }],
  });
  const site = { content: "Entrega em todo o Rio por R$ 15,00.", metadata: { title: "Entregas", url: "https://loja.com/entregas" }, gate_segments: null };

  it("só o trecho de post é de post", () => {
    expect(isPostHit(post("2026-08-12T14:00:00-03:00"))).toBe(true);
    expect(isPostHit(site)).toBe(false);
  });

  it("o post ganha a idade no título; o resto fica como veio", () => {
    const [p, s] = withPostAges([post("2026-08-12T14:00:00-03:00"), site], DEFAULT_POST_RULE, NOW);
    expect(p.metadata.title).toBe("Post do Instagram de 12/08/2026 (há 69 dias)");
    expect(p.content).toContain("R$ 129,90");
    expect(s).toBe(site);
  });

  it("na regra limite, o post velho perde o preço (no texto e nas frases do portão); o novo, não", () => {
    const rule = { rule: "limite" as const, maxDays: 30 };
    const [old, fresh, s] = withPostAges([post("2026-08-12T14:00:00-03:00"), post("2026-10-10T14:00:00-03:00"), site], rule, NOW);
    expect(old.content).not.toContain("129,90");
    expect(old.content).toContain(OLD_PRICE);
    expect(old.gate_segments?.[0].t).toBe(`Legenda: Vestido midi floral ${OLD_PRICE}`);
    expect(fresh.content).toContain("R$ 129,90");
    // preço do site não é de post: fica
    expect(s.content).toContain("R$ 15,00");
  });
});
