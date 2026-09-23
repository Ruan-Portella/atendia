import type { Metadata } from "next";

const bubble = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H10l-5 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="#6a736e"/></svg>`;

/**
 * Ícone das páginas que o cliente final vê (demo, portal, widget, área do cliente, domínio
 * da agência): um balão neutro no lugar do ícone da plataforma (public/favicon.ico, icon.svg).
 */
export const NEUTRAL_ICONS: Metadata["icons"] = {
  icon: `data:image/svg+xml,${encodeURIComponent(bubble)}`,
  apple: [],
};
