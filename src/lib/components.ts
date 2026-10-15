import { isChatLink } from "./gate/sales-channel";

/*
 * Mensagens ricas nativas (leva B1', Peça 5): a IA chama mostrar_opcoes ou mostrar_link e o canal
 * monta a mensagem a partir da chamada, sem outra chamada ao modelo. Formato único, convertido
 * por canal:
 *  - opções: até 3 com título de até 20 caracteres viram botões; de 4 a 10 (ou título maior), lista.
 *    WhatsApp: botões de resposta ou lista interativa. Instagram: respostas rápidas, com o resumo
 *    numerado numa mensagem própria (no instagram.com, pelo computador, as respostas rápidas não
 *    aparecem). Site: botões.
 *  - link: WhatsApp, botão com link (CTA URL); Instagram, o link no texto; site, botão.
 * O clique volta para a IA como mensagem com o título da opção. Um componente por mensagem.
 * Ações e API (C pública, parte 5b) usam o mesmo formato: a lista pode vir pedida (list), com a
 * descrição de cada item e o rótulo do botão que abre a lista; botão com ação leva o id de uma
 * referência (bvc:<ref>:acao), resolvido sem IA (action-confirm.ts).
 * Carrossel (parte 5d, só ações e API): de 1 a 10 cards com imagem ou vídeo, título, texto e os
 * botões do card (de resposta, ou um de link). WhatsApp: carrossel de mídia (texto do card até 160
 * caracteres, com o título no começo); 1 card vira mensagem com imagem. Instagram: o resumo
 * numerado com as respostas rápidas (o generic template fica para a parte 5d-2). Site: os cards.
 */

export interface OptionItem {
  id: string;
  title: string;
  /** Linha de baixo do item da lista (até 72 caracteres). */
  description?: string;
}

/**
 * Card do carrossel (C pública, parte 5d): imagem ou vídeo, título e texto opcionais, e os botões
 * do card: de resposta (o id volta no clique, como nas opções) ou um botão de link. Todos os cards
 * de um carrossel têm o mesmo tipo e a mesma quantidade de botões (regra do WhatsApp).
 */
export interface CarouselCard {
  media: { type: "image" | "video"; url: string };
  title?: string;
  text?: string;
  buttons?: OptionItem[];
  link?: { url: string; label: string };
}

export type MessageComponent =
  | { type: "options"; options: OptionItem[]; list?: boolean; button?: string }
  | { type: "link"; url: string; label: string }
  | { type: "carousel"; cards: CarouselCard[] };

export const LIMITS = { buttons: 3, buttonTitle: 20, list: 10, listTitle: 24, listDetail: 72, title: 60, linkLabel: 20, body: 1024, text: 600, cards: 10, cardButtons: 2, cardTitle: 80, cardText: 300, waCardText: 160 } as const;

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Título no limite do canal, cortado no fim de uma palavra (sem "…": o resumo numerado e a
 * descrição da lista mostram o título inteiro). Pura.
 */
export function shortTitle(title: string, max: number): string {
  if (title.length <= max) return title;
  const cut = title.slice(0, max + 1).lastIndexOf(" ");
  let t = (cut >= max * 0.5 ? title.slice(0, cut) : title.slice(0, max)).trim();
  // parêntese que ficou aberto no corte ("Frango (R$") sai inteiro
  const open = t.lastIndexOf("(");
  if (open > 0 && !t.slice(open).includes(")")) t = t.slice(0, open).trim();
  return t.replace(/[\s,;:–-]+$/, "");
}

const LIST_ITEM = /^\s*(?:[-•*▪·]|\d{1,2}[.)])\s+(.+?)\s*$/;
// pergunta de escolha: "qual", "quais", "prefere", "escolher", "opção" (não "quer"/"gostaria", que são genéricos)
const CHOICE_QUESTION = /\b(?:qual|quais|prefere|preferem|escolh\w*|op[cç](?:[aã]o|[oõ]es))\b[^?\n]*\?/i;

/**
 * Rede de segurança: a IA escreveu as alternativas em lista no texto em vez de chamar
 * mostrar_opcoes. Uma lista curta (2 a 10 itens de até 40 caracteres) junto de uma pergunta de
 * escolha vira opções; o texto volta sem a lista. Sem pergunta de escolha (lista só informativa),
 * nada muda. Pura.
 */
export function optionsFromText(text: string): { text: string; component: { type: "options"; options: OptionItem[] } } | null {
  const lines = text.split(/\r?\n/);
  // o último bloco de itens seguidos
  let end = -1;
  let start = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (LIST_ITEM.test(lines[i])) {
      if (end < 0) end = i;
      start = i;
    } else if (end >= 0) break;
  }
  if (end < 0) return null;
  const items = lines.slice(start, end + 1).map((l) => LIST_ITEM.exec(l)![1].replace(/\*\*|__|`/g, "").replace(/[.;,:]+$/, "").trim());
  if (items.length < 2 || items.length > LIMITS.list || items.some((t) => !t || t.length > 40 || /[.!?]\s/.test(t))) return null;
  const rest = [...lines.slice(0, start), ...lines.slice(end + 1)].join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!CHOICE_QUESTION.test(rest)) return null;
  const options = normalizeOptions(items);
  return options ? { text: rest, component: { type: "options", options } } : null;
}

/** Opções da IA prontas: sem vazias, sem repetidas, sem numeração; de 2 a 10 (título inteiro até 60). null = não dá para mostrar. Pura. */
export function normalizeOptions(raw: string[]): OptionItem[] | null {
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const r of raw) {
    const t = clean(String(r ?? "")).replace(/^(\d{1,2}[.)-]|[-•*])\s*/, "").slice(0, LIMITS.title).trim();
    const key = t.toLowerCase();
    if (!t || seen.has(key)) continue;
    seen.add(key);
    titles.push(t);
  }
  if (titles.length < 2) return null;
  return titles.slice(0, LIMITS.list).map((title, i) => ({ id: `op_${i + 1}`, title }));
}

/** Vira botões (até 3 e títulos curtos) ou lista. Pura. */
export const asButtons = (options: OptionItem[]) => options.length <= LIMITS.buttons && options.every((o) => o.title.length <= LIMITS.buttonTitle);

/** "1. Pizza\n2. Esfiha": o resumo que aparece em qualquer tela. Pura. */
export const numberedSummary = (options: OptionItem[]) => options.map((o, i) => `${i + 1}. ${o.title}`).join("\n");

/** Hosts dos endereços que aparecem num texto (com ou sem https://), sem o "www.". Pura. */
export function hostsIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/\b(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?=[/:?#\s)"'>,;.!]|$)/gi)) out.add(m[1].toLowerCase().replace(/^www\./, ""));
  return out;
}

/**
 * Link da IA: só https e de um site que já aparece na base ou na configuração do chatbot (a IA não
 * inventa endereço); nunca link de WhatsApp ou de DM (a conversa já é por ali). Pura.
 */
export function normalizeLink(url: string, label: string, allowedHosts: Set<string>): { type: "link"; url: string; label: string } | null {
  let u: URL;
  try {
    u = new URL(clean(url));
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || isChatLink(u.toString())) return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const known = [...allowedHosts].some((h) => host === h || host.endsWith(`.${h}`));
  if (!known) return null;
  const l = clean(label).slice(0, LIMITS.linkLabel).trim() || "Abrir";
  return { type: "link", url: u.toString(), label: l };
}

/** Texto da mensagem: o que a IA escreveu fora da ferramenta e o "texto" dela, sem repetir. Pura. */
export function joinShownText(stepText: string, toolText: string | null | undefined): string {
  const a = stepText.trim();
  const b = (toolText ?? "").trim();
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ");
  if (!b || norm(a).includes(norm(b))) return a;
  if (!a || norm(b).includes(norm(a))) return b;
  return `${a}\n\n${b}`;
}

/** O que a IA vê no histórico depois de mostrar opções ou link (para entender "2" ou "o segundo"). Pura. */
export function componentsNote(c: MessageComponent | null): string {
  if (!c) return "";
  if (c.type === "link") return `\n[link mostrado: ${c.label} (${c.url})]`;
  if (c.type === "carousel") return `\n[carrossel mostrado: ${c.cards.map((card, i) => `${i + 1}) ${cardName(card)}${card.buttons?.length ? ` (botões: ${card.buttons.map((b) => b.title).join(", ")})` : card.link ? ` (link: ${card.link.url})` : ""}`).join("; ")}]`;
  return `\n[opções mostradas: ${c.options.map((o, i) => `${i + 1}) ${o.title}`).join("; ")}]`;
}

/** Nome do card para a IA e para o resumo: o título, senão o começo do texto. Pura. */
export function cardName(card: CarouselCard): string {
  const t = card.title?.trim() || card.text?.trim().split("\n")[0] || "";
  return shortTitle(t, 40) || "item";
}

/**
 * Escolhas que dá para fazer na mensagem, na ordem: as opções, ou os botões de resposta dos cards
 * (com o nome do card no título, para o resumo numerado e as respostas rápidas). Link: nenhuma. Pura.
 */
export function choicesOf(c: MessageComponent | null | undefined): OptionItem[] {
  if (!c || c.type === "link") return [];
  if (c.type === "options") return c.options;
  return c.cards.flatMap((card) => (card.buttons ?? []).map((b) => ({ id: b.id, title: card.buttons!.length > 1 ? `${cardName(card)}: ${b.title}` : cardName(card) })));
}

/**
 * Toque num botão de card: a IA recebe o card junto ("Pedir esta: Pizza Calabresa"), porque o
 * título do botão costuma ser igual em todos os cards. null se o botão não é de um card. Pura.
 */
export function carouselClickText(c: MessageComponent | null | undefined, buttonId: string | null | undefined): string | null {
  if (!buttonId || c?.type !== "carousel") return null;
  for (const card of c.cards) {
    const b = card.buttons?.find((x) => x.id === buttonId);
    if (b) return `${b.title}: ${cardName(card)}`;
  }
  return null;
}

const validCard = (c: CarouselCard) =>
  Boolean(c) &&
  (c.media?.type === "image" || c.media?.type === "video") &&
  /^https:\/\//.test(String(c.media?.url ?? "")) &&
  (c.buttons === undefined || (Array.isArray(c.buttons) && c.buttons.every((o) => typeof o?.id === "string" && typeof o?.title === "string"))) &&
  (c.link === undefined || (typeof c.link?.url === "string" && /^https:\/\//.test(c.link.url) && typeof c.link.label === "string"));

/** O componente guardado (JSON) de volta, conferido. Pura. */
export function parseComponents(json: string | null | undefined): MessageComponent | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as MessageComponent;
    if (v?.type === "options" && Array.isArray(v.options) && v.options.every((o) => typeof o?.id === "string" && typeof o?.title === "string")) return v;
    if (v?.type === "link" && typeof v.url === "string" && /^https:\/\//.test(v.url) && typeof v.label === "string") return v;
    if (v?.type === "carousel" && Array.isArray(v.cards) && v.cards.length && v.cards.every(validCard)) return v;
  } catch {
    // guardado com defeito: sem componente
  }
  return null;
}

/** WhatsApp: botões de resposta, lista interativa ou botão com link. Pura. */
export interface WhatsAppCard {
  media: CarouselCard["media"];
  text: string;
  buttons?: Array<{ id: string; title: string }>;
  link?: { label: string; url: string };
}

export type WhatsAppPlan =
  | { kind: "buttons"; buttons: Array<{ id: string; title: string }> }
  | { kind: "list"; button: string; rows: Array<{ id: string; title: string; description?: string }> }
  | { kind: "link"; label: string; url: string }
  /** carrossel de mídia (2 a 10 cards) */
  | { kind: "carousel"; cards: WhatsAppCard[] }
  /** carrossel de 1 card: mensagem com a imagem (ou o vídeo) em cima, o texto do card e os botões */
  | { kind: "media"; card: WhatsAppCard };

/**
 * Texto do card no WhatsApp: o título no começo, no máximo 2 quebras de linha e 160 caracteres
 * (cortado no fim de uma palavra). Pura.
 */
export function waCardText(card: CarouselCard): string {
  const lines = [card.title, card.text].flatMap((s) => (s?.trim() ? s.trim().split(/\n+/) : [])).map((l) => l.trim()).filter(Boolean);
  const t = lines.length > 3 ? [lines[0], lines[1], lines.slice(2).join(" ")].join("\n") : lines.join("\n");
  return shortTitle(t, LIMITS.waCardText);
}

const waCard = (card: CarouselCard): WhatsAppCard => ({
  media: card.media,
  text: waCardText(card),
  ...(card.buttons?.length ? { buttons: card.buttons.slice(0, LIMITS.cardButtons).map((b) => ({ id: b.id, title: shortTitle(b.title, LIMITS.buttonTitle) })) } : {}),
  ...(card.link ? { link: { label: shortTitle(card.link.label, LIMITS.buttonTitle), url: card.link.url } } : {}),
});

/** Rótulo padrão do botão que abre a lista. */
export const LIST_BUTTON = "Ver opções";

export function whatsappPlan(c: MessageComponent): WhatsAppPlan {
  if (c.type === "link") return { kind: "link", label: c.label, url: c.url };
  if (c.type === "carousel") return c.cards.length === 1 ? { kind: "media", card: waCard(c.cards[0]) } : { kind: "carousel", cards: c.cards.slice(0, LIMITS.cards).map(waCard) };
  if (!c.list && asButtons(c.options)) return { kind: "buttons", buttons: c.options.map((o) => ({ id: o.id, title: o.title })) };
  // título cortado na lista: o inteiro vai na descrição do item (se o item não trouxe a dele)
  return {
    kind: "list",
    button: shortTitle(c.button?.trim() || LIST_BUTTON, LIMITS.buttonTitle),
    rows: c.options.map((o) => {
      const title = shortTitle(o.title, LIMITS.listTitle);
      const description = o.description ?? (title !== o.title ? o.title : undefined);
      return { id: o.id, title, ...(description ? { description: description.slice(0, LIMITS.listDetail) } : {}) };
    }),
  };
}

/** Corpo curto quando o texto passa do limite da mensagem com botões (o texto vai antes, inteiro). */
export const SHORT_BODY = { options: "Escolha uma opção:", link: "Toque para abrir:", carousel: "Veja as opções:" } as const;

/**
 * Instagram: respostas rápidas (até 13, título de até 20) e o resumo numerado numa mensagem
 * própria. Carrossel (até a parte 5d-2): os botões de resposta dos cards viram as opções, com o
 * nome do card; carrossel de links vai no texto (instagramCarouselText). Pura.
 */
export function instagramPlan(c: Exclude<MessageComponent, { type: "link" }>): { summary: string; quickReplies: Array<{ title: string; payload: string }> } {
  const options = choicesOf(c);
  return {
    summary: `Responda com o número ou toque numa opção:\n${numberedSummary(options)}`,
    quickReplies: options.slice(0, 13).map((o) => ({ title: shortTitle(o.title, LIMITS.buttonTitle), payload: o.id })),
  };
}

/** Instagram: carrossel de links (sem botões de resposta) vai no texto, um card por linha. Pura. */
export const instagramCarouselText = (text: string, c: Extract<MessageComponent, { type: "carousel" }>) =>
  [text.trim(), c.cards.map((card) => `${cardName(card)}${card.link ? `: ${card.link.url}` : ""}`).join("\n")].filter(Boolean).join("\n\n");

/** Instagram: o link vai no texto (o botão de link não aparece no instagram.com pelo computador). Pura. */
export const instagramLinkText = (text: string, c: Extract<MessageComponent, { type: "link" }>) => `${text.trim()}\n\n${c.label}: ${c.url}`.trim();
