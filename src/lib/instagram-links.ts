import { slugify } from "./utils";

/*
 * Perguntas prontas e links ig.me com origem (E1, parte 3a): os limites e o formato do link, puros
 * (o painel usa no navegador), e o aviso de quando a conta troca o nome. As regras do servidor ficam
 * em instagram-direct.ts.
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
 * O link para a bio, o QR e o anúncio: ig.me/<conta>?ref=<origem>, como na documentação da API do
 * Instagram com login do Instagram (a de mensagens mostra também ig.me/m/<conta>). Leva o nome da
 * conta: se a conta troca o nome, o link antigo para. Abre no app do Instagram; no computador, o
 * Instagram não abre links ig.me. Pura.
 */
export const igMeLink = (username: string, ref: string) => `https://ig.me/${encodeURIComponent(username)}?ref=${encodeURIComponent(ref)}`;

/** O perfil da conta (o link da fonte dos posts). Pura. */
export const igProfileUrl = (username: string) => `https://www.instagram.com/${encodeURIComponent(username)}/`;

/** O título padrão da fonte dos posts (acompanha o nome da conta). Pura. */
export const postsSourceTitle = (handle: string) => `Posts do Instagram (@${handle})`;

/** O aviso do nome antigo fica no painel por 30 dias depois da troca. */
export const RENAMED_NOTICE_DAYS = 30;

/**
 * A conta trocou o nome no Instagram: os links com o nome antigo (bio, QR impresso, anúncio) não
 * abrem mais o direct. O aviso do painel, até 30 dias depois da troca. Pura.
 */
export function renamedNotice(ch: { username?: string | null; previous_username?: string | null; username_changed_at?: string | null }, now = Date.now()): { from: string; to: string; at: string } | null {
  if (!ch.username || !ch.previous_username || !ch.username_changed_at) return null;
  return now - Date.parse(ch.username_changed_at) < RENAMED_NOTICE_DAYS * 86_400_000 ? { from: ch.previous_username, to: ch.username, at: ch.username_changed_at } : null;
}
