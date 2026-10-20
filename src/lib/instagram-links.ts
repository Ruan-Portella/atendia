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

/** O ref a partir do nome do link ("QR do balcão" → "qr-do-balcao"). Pura. */
export function refFromLabel(label: string): string {
  return slugify(label).slice(0, 40).replace(/-+$/, "");
}

/** O link para a bio, o QR e o anúncio. Pura. */
export const igMeLink = (username: string, ref: string) => `https://ig.me/m/${encodeURIComponent(username)}?ref=${encodeURIComponent(ref)}`;
