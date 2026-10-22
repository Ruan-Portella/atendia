import { DAY_TO_DAY, settingsFor } from "@/lib/nav";
import { can, type AgencyRole } from "@/lib/roles";

/*
 * Ir para (Ctrl K), redesenho etapa 1: uma busca só para contato, conversa, cliente, chatbot,
 * ação e ajuste. O que é fixo (telas, ajustes, ações) filtra aqui, na hora; contatos, conversas
 * e chatbots vêm do servidor (api/painel/ir-para). Sem dependência de servidor.
 */

export type GoToKind = "page" | "contact" | "conversation" | "client" | "bot" | "action" | "setting";

export interface GoToItem {
  id: string;
  kind: GoToKind;
  title: string;
  sub?: string;
  href?: string;
  /** Ações que não são um endereço (tema, sair): o componente resolve pelo id. */
  run?: "tema-escuro" | "tema-claro" | "tema-sistema" | "sair";
  /** Cor do chatbot (cliente e chatbot aparecem com o rosto). */
  color?: string | null;
  keywords?: string;
}

export interface GoToGroup {
  title: string;
  items: GoToItem[];
}

/** Sem acento e em minúsculas: "Configurações" acha com "configuracoes". */
export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function matches(item: Pick<GoToItem, "title" | "sub" | "keywords">, query: string): boolean {
  const q = fold(query.trim());
  if (!q) return true;
  const hay = fold([item.title, item.sub, item.keywords].filter(Boolean).join(" "));
  return q.split(/\s+/).every((w) => hay.includes(w));
}

/** As telas, os ajustes e as ações que a pessoa pode abrir. */
export function staticGroups(role: AgencyRole, packs: readonly string[]): { pages: GoToItem[]; actions: GoToItem[]; settings: GoToItem[] } {
  const pages: GoToItem[] = DAY_TO_DAY.filter((i) => can(role, i.perm)).map((i) => ({ id: i.href, kind: "page", title: i.label, href: i.href, keywords: i.keywords }));
  const settings: GoToItem[] = [
    ...settingsFor(role, packs).flatMap((g) => g.items.map((i) => ({ id: i.href, kind: "setting" as const, title: i.label, sub: `Configurações · ${g.group}`, href: i.href, keywords: i.keywords }))),
    { id: "/painel/perfil", kind: "setting", title: "Meu perfil", sub: "Nome, foto, assinatura e avisos", href: "/painel/perfil", keywords: "senha whatsapp avisos celular disponível" },
    { id: "/painel/roadmap", kind: "setting", title: "Novidades e roadmap", sub: "O que vem por aí", href: "/painel/roadmap", keywords: "novidades sugestão" },
    { id: "/ajuda", kind: "setting", title: "Central de ajuda", sub: "Como fazer cada coisa", href: "/ajuda", keywords: "ajuda dúvida tutorial" },
  ];
  const actions: GoToItem[] = [
    ...(can(role, "config")
      ? [
          { id: "novo-cliente", kind: "action" as const, title: "Novo cliente", sub: "Cadastrar um cliente e o primeiro chatbot", href: "/painel/clientes/novo", keywords: "criar adicionar" },
          { id: "nova-campanha", kind: "action" as const, title: "Nova campanha", sub: "Modelo aprovado para uma etiqueta", href: "/painel/campanhas/nova", keywords: "criar disparo" },
        ]
      : []),
    ...(can(role, "team") ? [{ id: "convidar", kind: "action" as const, title: "Convidar para a equipe", sub: "Configurações · Equipe e papéis", href: "/painel/equipe", keywords: "convite membro atendente" }] : []),
    { id: "tema-escuro", kind: "action", title: "Tema escuro", run: "tema-escuro", keywords: "aparência cor noite" },
    { id: "tema-claro", kind: "action", title: "Tema claro", run: "tema-claro", keywords: "aparência cor dia" },
    { id: "tema-sistema", kind: "action", title: "Tema do aparelho", run: "tema-sistema", keywords: "aparência cor automático" },
    { id: "sair", kind: "action", title: "Sair", run: "sair", keywords: "logout sair da conta" },
  ];
  return { pages, actions, settings };
}

/**
 * Junta o que filtra na hora com o que veio do servidor, na ordem da tela: sem busca, as telas,
 * os primeiros clientes e as ações; com busca, contatos e conversas primeiro.
 */
export function buildGroups(o: { query: string; role: AgencyRole; packs: readonly string[]; clients: GoToItem[]; remote: GoToGroup[] }): GoToGroup[] {
  const { pages, actions, settings } = staticGroups(o.role, o.packs);
  const q = o.query.trim();
  if (!q) {
    return [
      { title: "Ir para", items: pages },
      { title: "Clientes", items: o.clients.slice(0, 5) },
      { title: "Ações", items: actions.filter((a) => !a.run) },
    ].filter((g) => g.items.length);
  }
  const remote = (title: string) => o.remote.find((g) => g.title === title)?.items ?? [];
  // clientes: os do menu filtram na hora; os que vieram do servidor completam (sem repetir)
  const localClients = o.clients.filter((c) => matches(c, q));
  const clients = [...localClients, ...remote("Clientes").filter((c) => !localClients.some((l) => l.id === c.id))].slice(0, 5);
  return [
    { title: "Contatos", items: remote("Contatos") },
    { title: "Conversas", items: remote("Conversas") },
    { title: "Clientes", items: clients },
    { title: "Chatbots", items: remote("Chatbots") },
    { title: "Ações", items: actions.filter((a) => matches(a, q)).slice(0, 4) },
    { title: "Ajustes", items: [...pages, ...settings].filter((s) => matches(s, q)).slice(0, 5) },
  ].filter((g) => g.items.length);
}
