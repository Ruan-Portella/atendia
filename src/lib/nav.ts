import { can, type AgencyRole, type Permission } from "@/lib/roles";

/*
 * Mapa do painel (redesenho, etapa 1): o menu fica com o dia a dia e os clientes; o que se ajusta
 * uma vez vai para Configurações, uma tela só com o menu de ajustes ao lado. O Ir para (Ctrl K)
 * lê daqui também. Sem dependência de servidor.
 */

export interface NavLink {
  href: string;
  label: string;
  perm: Permission;
  /** Só com o pacote (os modelos de chatbot são do Plataforma). */
  pack?: string;
  /** Outras palavras que levam a este lugar no Ir para. */
  keywords?: string;
  /** Só para quem vê todos os clientes da conta. */
  wholeAccount?: boolean;
}

export type DayToDayLink = NavLink & { icon: "inbox" | "contacts" | "megaphone" | "chart" | "users" | "layers" | "globe" | "bot" };

export const DAY_TO_DAY: DayToDayLink[] = [
  { href: "/painel/caixa", label: "Caixa de entrada", perm: "attend", icon: "inbox", keywords: "conversas atendimento fila" },
  { href: "/painel/contatos", label: "Contatos e leads", perm: "config", icon: "contacts", keywords: "pessoas leads clientes finais etiquetas" },
  { href: "/painel/campanhas", label: "Campanhas e réguas", perm: "config", icon: "megaphone", keywords: "disparo lembrete régua" },
  { href: "/painel/relatorios", label: "Relatórios", perm: "config", icon: "chart", keywords: "números mês relatório mensal" },
  { href: "/painel/clientes", label: "Clientes", perm: "attend", icon: "users", keywords: "chatbots" },
  // a pedido do usuário em 22/10: o modelo é um chatbot que se constrói, não um ajuste da conta; com o
  // Plataforma e para quem vê a conta inteira (a tela também confere)
  { href: "/painel/modelos", label: "Modelos", perm: "config", pack: "plataforma", wholeAccount: true, icon: "layers", keywords: "modelos de chatbot template herança lojas derivados" },
  // a demo também é um chatbot e uma ferramenta de venda (saiu das Configurações em 22/10)
  { href: "/painel/demos", label: "Demos", perm: "config", icon: "globe", keywords: "demos para prospects demonstração prospect vender" },
];

/**
 * O dia a dia do menu e do Ir para, pelo perfil (23/10/2026): no "Para o meu negócio", Clientes
 * vira Chatbots, que abre a página do próprio negócio (o cliente único; sem ele ainda, a tela de
 * criar), e as demos (ferramenta de venda da agência) saem. Pura.
 */
export function dayToDay(business: { clientId: string | null } | null): DayToDayLink[] {
  if (!business) return DAY_TO_DAY;
  return DAY_TO_DAY.filter((i) => i.href !== "/painel/demos").map((i) =>
    i.href === "/painel/clientes" ? { ...i, href: business.clientId ? `/painel/clientes/${business.clientId}` : "/painel/clientes", label: "Chatbots", icon: "bot", keywords: "chatbots assistente meu negócio setores respostas prontas" } : i,
  );
}

export const SETTINGS: Array<{ group: string; items: NavLink[] }> = [
  {
    group: "Conta",
    items: [
      { href: "/painel/marca", label: "Marca e domínio", perm: "brand", keywords: "logo cor domínio próprio retenção privacidade" },
      { href: "/painel/equipe", label: "Equipe e papéis", perm: "team", keywords: "convidar membros atendentes" },
      { href: "/painel/seguranca", label: "Segurança e auditoria", perm: "security", keywords: "segundo fator sessões auditoria titular excluir conta" },
    ],
  },
  {
    group: "Cobrança",
    items: [
      { href: "/painel/cobranca", label: "Assinatura e pacotes", perm: "billing", keywords: "plano cartão fatura" },
      { href: "/painel/cobranca/uso", label: "Uso e custo", perm: "billing", keywords: "atendimentos cota consumo" },
      { href: "/painel/cobranca/credito", label: "Crédito", perm: "billing", keywords: "pix recarga excedente" },
    ],
  },
  {
    group: "Integrações",
    items: [{ href: "/painel/integracoes", label: "Ações, webhooks e API", perm: "integrations", keywords: "chave api webhook registros entregas" }],
  },
];

/** A pessoa vê o lugar: o papel, o pacote e, quando pede, o escopo da conta inteira. */
export const allowed = (l: Pick<NavLink, "perm" | "pack" | "wholeAccount">, role: AgencyRole, packs: readonly string[], wholeAccount = true) => can(role, l.perm) && (!l.pack || packs.includes(l.pack)) && (!l.wholeAccount || wholeAccount);

/** Os grupos de ajustes que a pessoa vê (grupo vazio sai). */
export function settingsFor(role: AgencyRole, packs: readonly string[]) {
  return SETTINGS.map((g) => ({ group: g.group, items: g.items.filter((i) => allowed(i, role, packs)) })).filter((g) => g.items.length > 0);
}

/** Para onde vai o "Configurações" do menu: o primeiro ajuste que a pessoa pode abrir. */
export function firstSettingsHref(role: AgencyRole, packs: readonly string[]): string | null {
  return settingsFor(role, packs)[0]?.items[0]?.href ?? null;
}

/** O item de ajustes aceso: o de caminho mais longo que bate (Uso e custo, não Assinatura). */
export function activeSettingsHref(path: string, role: AgencyRole, packs: readonly string[]): string | null {
  const hits = settingsFor(role, packs)
    .flatMap((g) => g.items)
    .filter((i) => path === i.href || path.startsWith(i.href + "/"));
  return hits.sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;
}
