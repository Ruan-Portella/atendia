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
}

export const DAY_TO_DAY: Array<NavLink & { icon: "inbox" | "contacts" | "megaphone" | "chart" | "users" }> = [
  { href: "/painel/caixa", label: "Caixa de entrada", perm: "attend", icon: "inbox", keywords: "conversas atendimento fila" },
  { href: "/painel/contatos", label: "Contatos e leads", perm: "config", icon: "contacts", keywords: "pessoas leads clientes finais etiquetas" },
  { href: "/painel/campanhas", label: "Campanhas e réguas", perm: "config", icon: "megaphone", keywords: "disparo lembrete régua" },
  { href: "/painel/relatorios", label: "Relatórios", perm: "config", icon: "chart", keywords: "números mês relatório mensal" },
  { href: "/painel/clientes", label: "Clientes", perm: "attend", icon: "users", keywords: "chatbots" },
];

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
  {
    group: "Biblioteca",
    items: [
      { href: "/painel/modelos", label: "Modelos de chatbot", perm: "config", pack: "plataforma", keywords: "template herança" },
      { href: "/painel/demos", label: "Demos para prospects", perm: "config", keywords: "demonstração" },
    ],
  },
];

export const allowed = (l: Pick<NavLink, "perm" | "pack">, role: AgencyRole, packs: readonly string[]) => can(role, l.perm) && (!l.pack || packs.includes(l.pack));

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
