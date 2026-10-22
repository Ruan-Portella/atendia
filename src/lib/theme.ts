/**
 * Tema do painel, da área do cliente e do backoffice (redesenho, 22/10): escuro por padrão; a
 * pessoa pode trocar para o claro ou seguir o aparelho. Fica num cookie do navegador, para a
 * página já chegar no tema certo, sem piscar. As páginas públicas ficam sempre no claro.
 */
export type Tema = "escuro" | "claro" | "sistema";

export const TEMA_COOKIE = "bv_tema";

/** O menu lateral recolhido no computador ("fechado"), também por navegador. */
export const MENU_COOKIE = "bv_menu";

export const TEMAS: Array<{ value: Tema; label: string }> = [
  { value: "escuro", label: "Escuro" },
  { value: "claro", label: "Claro" },
  { value: "sistema", label: "Do aparelho" },
];

export function temaOf(v: string | null | undefined): Tema {
  return v === "claro" || v === "sistema" ? v : "escuro";
}
