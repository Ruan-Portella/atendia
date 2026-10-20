import { slugify } from "./utils";

/*
 * Perguntas prontas e links ig.me com origem (E1, parte 3a): os limites e o formato do link, puros
 * (o painel usa no navegador). As regras do servidor ficam em instagram-direct.ts.
 */

export const ICE_BREAKERS_MAX = 4;
export const ICE_BREAKER_MAX = 80;
export const REF_LINKS_MAX = 20;
export const REF_LABEL_MAX = 60;
export const REF_NOTE_MAX = 300;

/** Palavras-chave do Instagram (parte 3b): os limites do formulário. */
export const KEYWORDS_PER_BOT = 20;
export const WORDS_PER_KEYWORD = 5;
export const WORD_MAX = 30;
export const REPLY_MAX = 1000;
export const PUBLIC_REPLY_MAX = 300;
export const KEYWORD_POSTS_MAX = 100;

/** O ref a partir do nome do link ("QR do balcão" → "qr-do-balcao"). Pura. */
export function refFromLabel(label: string): string {
  return slugify(label).slice(0, 40).replace(/-+$/, "");
}

/**
 * O link para a bio, o QR e o anúncio: ig.me/<conta>?ref=<origem> (o formato da Meta; o /m/ é do
 * Messenger). Abre no app do Instagram; no computador, o Instagram não abre links ig.me. Pura.
 */
export const igMeLink = (username: string, ref: string) => `https://ig.me/${encodeURIComponent(username)}?ref=${encodeURIComponent(ref)}`;
