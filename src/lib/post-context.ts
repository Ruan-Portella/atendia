import type { Segment } from "./gate/base";

/*
 * Posts do Instagram na conversa (E1, parte 1; spec Peça 9): as regras puras. O trecho de um post
 * chega à IA com a data e a idade no título ("Post do Instagram de 12/08/2026 (há 69 dias)"), e a
 * regra do preço de post do chatbot diz o que fazer com o preço que só aparece num post:
 *   - citar (padrão): diz o preço citando a data do post e que vai confirmar a disponibilidade;
 *   - limite: post com mais de X dias perde o preço no texto (a IA nem vê) e ela confirma com a equipe;
 *   - sempre: diz o preço do post, citando a data.
 * Uma ação de consulta de produto, preço ou estoque vale mais que o post. A leitura dos posts fica
 * em instagram-posts.ts.
 */

export type PostPriceRuleName = "citar" | "limite" | "sempre";

export interface PostPriceRule {
  rule: PostPriceRuleName;
  /** Só na regra "limite": a idade máxima do post, em dias, para o preço valer. */
  maxDays: number;
}

export const DEFAULT_POST_RULE: PostPriceRule = { rule: "citar", maxDays: 30 };

/** A regra do chatbot (bots.post_price_rule e post_price_max_days). Pura. */
export function postPriceRuleOf(bot: { post_price_rule?: string | null; post_price_max_days?: number | null }): PostPriceRule {
  const rule = bot.post_price_rule === "limite" || bot.post_price_rule === "sempre" ? bot.post_price_rule : "citar";
  const days = Number(bot.post_price_max_days);
  return { rule, maxDays: Number.isInteger(days) && days >= 1 && days <= 365 ? days : DEFAULT_POST_RULE.maxDays };
}

const TZ = "America/Sao_Paulo";

/** Data do post no fuso de Brasília (12/08/2026). Pura. */
export function postDate(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));
}

/** Dia do calendário de Brasília, em dias desde 1970. */
function brDay(ms: number): number {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
  return Math.round(Date.parse(`${ymd}T00:00:00Z`) / 86_400_000);
}

/** Dias desde o post, pelo calendário de Brasília (post de ontem à noite tem 1 dia). Pura. */
export function postAgeDays(iso: string, now = Date.now()): number {
  return Math.max(0, brDay(now) - brDay(Date.parse(iso)));
}

/** Título do trecho de um post (a data; a idade entra na hora da conversa). Pura. */
export const postTitle = (iso: string) => `Post do Instagram de ${postDate(iso)}`;

/** Título com a idade, como a IA lê. Pura. */
export function postTitleWithAge(iso: string, now = Date.now()): string {
  const age = postAgeDays(iso, now);
  return `${postTitle(iso)} (${age === 0 ? "de hoje" : age === 1 ? "de ontem" : `há ${age} dias`})`;
}

/** Valor em reais: "R$ 89,90", "R$89", "1.299,00", "89,90 reais", "35 reais". */
const PRICE_RE = /R\$\s*\d[\d.]*(?:,\d{1,2})?|\b\d{1,3}(?:\.\d{3})*,\d{2}\b(?:\s*reais\b)?|\b\d+\s*reais\b/gi;
export const OLD_PRICE = "(preço antigo)";

/** Tira os valores em reais do texto de um post antigo (regra "limite"). Pura. */
export function maskPrices(text: string): string {
  return text.replace(PRICE_RE, OLD_PRICE);
}

interface PostHitMeta {
  title?: string;
  url?: string;
  kind?: string;
  posted_at?: string;
}

/** O trecho é de um post do Instagram (fonte "instagram"). Pura. */
export const isPostHit = (h: { metadata?: PostHitMeta | null }) => h.metadata?.kind === "instagram_post" && typeof h.metadata.posted_at === "string";

/**
 * Os trechos de post que a busca trouxe, prontos para a conversa: a idade no título e, na regra
 * "limite", sem o preço dos posts mais velhos que o limite (no texto e nas frases que o portão
 * classificou, que é de onde ele remonta o texto). Os outros trechos ficam como vieram. Pura.
 */
export function withPostAges<T extends { content: string; metadata: PostHitMeta; gate_segments?: Segment[] | null }>(hits: T[], rule: PostPriceRule = DEFAULT_POST_RULE, now = Date.now()): T[] {
  return hits.map((h) => {
    if (!isPostHit(h)) return h;
    const at = h.metadata.posted_at!;
    const titled = { ...h, metadata: { ...h.metadata, title: postTitleWithAge(at, now) } };
    if (rule.rule !== "limite" || postAgeDays(at, now) <= rule.maxDays) return titled;
    return { ...titled, content: maskPrices(h.content), gate_segments: h.gate_segments?.map((s) => ({ ...s, t: maskPrices(s.t) })) ?? h.gate_segments };
  });
}

/**
 * A regra do preço de post no prompt: quando a base trouxe algum post, ou quando a mensagem traz o
 * post ou o story da loja de que a pessoa fala (a linha com 📎, `shared`). Pura.
 */
export function postPriceNote(rule: PostPriceRule, o: { shared?: boolean } = {}): string {
  const action = "Se houver uma ação para consultar produto, preço ou estoque, use-a: ela vale mais que o post.";
  const where = o.shared ? "A linha com 📎 na mensagem traz o post ou o story da loja de que a pessoa fala, com a data em que foi publicado: use o que ela mostra." : 'Os trechos que começam com "Post do Instagram de" são posts da loja, com a data em que foram publicados.';
  if (rule.rule === "sempre") return `${where} Preço que só aparece num post: pode informar, citando a data do post (ex.: "no post de 12/08 está R$ 89"). ${action}`;
  const cite = `Preço que só aparece num post: diga o preço citando a data do post (ex.: "no post de 12/08 estava R$ 89") e diga que vai confirmar a disponibilidade com a equipe. Nunca diga que o produto está disponível só porque está num post.`;
  if (rule.rule === "limite") return `${where} Em post com mais de ${rule.maxDays} dias o preço aparece como "${OLD_PRICE}": não informe preço desse post; diga que confirma o valor com a equipe. ${cite} ${action}`;
  return `${where} ${cite} ${action}`;
}
