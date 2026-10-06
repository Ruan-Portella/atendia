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
 */

export interface OptionItem {
  id: string;
  title: string;
}

export type MessageComponent = { type: "options"; options: OptionItem[] } | { type: "link"; url: string; label: string };

export const LIMITS = { buttons: 3, buttonTitle: 20, list: 10, listTitle: 24, listDetail: 72, title: 60, linkLabel: 20, body: 1024, text: 600 } as const;

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
  return `\n[opções mostradas: ${c.options.map((o, i) => `${i + 1}) ${o.title}`).join("; ")}]`;
}

/** O componente guardado (JSON) de volta, conferido. Pura. */
export function parseComponents(json: string | null | undefined): MessageComponent | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as MessageComponent;
    if (v?.type === "options" && Array.isArray(v.options) && v.options.every((o) => typeof o?.id === "string" && typeof o?.title === "string")) return v;
    if (v?.type === "link" && typeof v.url === "string" && /^https:\/\//.test(v.url) && typeof v.label === "string") return v;
  } catch {
    // guardado com defeito: sem componente
  }
  return null;
}

/** WhatsApp: botões de resposta, lista interativa ou botão com link. Pura. */
export type WhatsAppPlan =
  | { kind: "buttons"; buttons: Array<{ id: string; title: string }> }
  | { kind: "list"; rows: Array<{ id: string; title: string; description?: string }> }
  | { kind: "link"; label: string; url: string };

export function whatsappPlan(c: MessageComponent): WhatsAppPlan {
  if (c.type === "link") return { kind: "link", label: c.label, url: c.url };
  if (asButtons(c.options)) return { kind: "buttons", buttons: c.options.map((o) => ({ id: o.id, title: o.title })) };
  // título cortado na lista: o inteiro vai na descrição do item
  return {
    kind: "list",
    rows: c.options.map((o) => {
      const title = shortTitle(o.title, LIMITS.listTitle);
      return { id: o.id, title, ...(title !== o.title ? { description: o.title.slice(0, LIMITS.listDetail) } : {}) };
    }),
  };
}

/** Corpo curto quando o texto passa do limite da mensagem com botões (o texto vai antes, inteiro). */
export const SHORT_BODY = { options: "Escolha uma opção:", link: "Toque para abrir:" } as const;

/** Instagram: respostas rápidas (até 13, título de até 20) e o resumo numerado numa mensagem própria. Pura. */
export function instagramPlan(c: Extract<MessageComponent, { type: "options" }>): { summary: string; quickReplies: Array<{ title: string; payload: string }> } {
  return {
    summary: `Responda com o número ou toque numa opção:\n${numberedSummary(c.options)}`,
    quickReplies: c.options.slice(0, 13).map((o) => ({ title: shortTitle(o.title, LIMITS.buttonTitle), payload: o.id })),
  };
}

/** Instagram: o link vai no texto (o botão de link não aparece no instagram.com pelo computador). Pura. */
export const instagramLinkText = (text: string, c: Extract<MessageComponent, { type: "link" }>) => `${text.trim()}\n\n${c.label}: ${c.url}`.trim();
