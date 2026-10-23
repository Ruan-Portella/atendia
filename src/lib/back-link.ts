/*
 * Voltar para onde a pessoa estava (23/10/2026, a pedido do usuário): os links que levam de uma
 * lista a uma tela de detalhe (o contato, a conversa, o cliente) levam junto `?de=` com a tela de
 * origem, e o "←" da tela de detalhe volta para ela. Só endereços do painel; o resto é ignorado.
 */

const LABELS: Array<[RegExp, string]> = [
  [/^\/painel\/caixa(\?|$)/, "Caixa de entrada"],
  [/^\/painel\/contatos\?(.*&)?aba=leads/, "Leads"],
  [/^\/painel\/contatos(\?|$)/, "Contatos e leads"],
  [/^\/painel\/relatorios(\?|$)/, "Relatórios"],
  [/^\/painel\/campanhas(\/|\?|$)/, "Campanhas e réguas"],
  [/^\/painel\/clientes\/[^/?]+\/contatos\//, "Contato"],
  [/^\/painel\/clientes\/[^/?]+/, "Cliente"],
  [/^\/painel\/clientes(\?|$)/, "Clientes"],
  [/^\/painel\/bots\//, "Chatbot"],
];

/** A tela de origem vinda do `?de=`, com o nome para o "←"; null quando não é um endereço do painel. Pura. */
export function backFrom(de: unknown): { href: string; label: string } | null {
  if (typeof de !== "string" || de.length > 400 || !de.startsWith("/painel/") || de.includes("//") || de.includes("\\")) return null;
  const hit = LABELS.find(([re]) => re.test(de));
  return { href: de, label: hit?.[1] ?? "Voltar" };
}

/** O link com a origem junto. Pura. */
export const withFrom = (href: string, from: string | null | undefined) => (from ? `${href}${href.includes("?") ? "&" : "?"}de=${encodeURIComponent(from)}` : href);
