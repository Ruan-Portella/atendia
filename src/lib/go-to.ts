import { allowed, dayToDay, settingsFor } from "@/lib/nav";
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
  run?: "tema-escuro" | "tema-claro" | "tema-sistema" | "sair" | "primeiros-passos" | "novo-cliente" | "novo-chatbot";
  /** Cor e rosto do chatbot (cliente e chatbot aparecem com o rosto). */
  color?: string | null;
  face?: unknown;
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

/**
 * As abas de dentro de cada tela e ajuste (23/10/2026, a pedido do usuário: mais atalhos no Ir
 * para). Só aparecem quando a tela de cima aparece (a mesma permissão).
 */
const SUB_PAGES: Record<string, Array<{ q: string; title: string; keywords: string }>> = {
  "/painel/contatos": [{ q: "?aba=leads", title: "Leads", keywords: "pedido orçamento agendar" }],
  "/painel/campanhas": [{ q: "/reguas", title: "Réguas", keywords: "lembrete automático aniversário volta" }],
  "/painel/seguranca": [
    { q: "?aba=pedidos", title: "Pedidos do titular", keywords: "lgpd apagar dados" },
    { q: "?aba=auditoria", title: "Auditoria", keywords: "quem fez histórico registro" },
    { q: "?aba=acessos", title: "Acessos", keywords: "login ip entrou sessões" },
    { q: "?aba=suporte", title: "Acesso do suporte", keywords: "boavoz ler conversas" },
    { q: "?aba=fator", title: "Segundo fator", keywords: "autenticador 2fa código" },
    { q: "?aba=conta", title: "Excluir a conta", keywords: "apagar encerrar" },
  ],
  "/painel/cobranca": [
    { q: "?aba=pacotes", title: "Pacotes", keywords: "integrações plataforma domínio" },
    { q: "?aba=faturas", title: "Faturas", keywords: "cartão pagamento nota boleto" },
  ],
  "/painel/integracoes": [
    { q: "?aba=webhooks", title: "Webhooks", keywords: "eventos entregas" },
    { q: "?aba=chaves", title: "Chaves de API", keywords: "token api key" },
    { q: "?aba=logs", title: "Registros", keywords: "logs chamadas entregas erros" },
  ],
};

/** As abas do chatbot e do cliente, para "sorriso roteiros" ir direto à aba (23/10/2026). */
export const BOT_TABS: Array<{ tab: string; title: string; keywords: string }> = [
  { tab: "conversas", title: "Conversas", keywords: "atendimentos histórico" },
  { tab: "evolucao", title: "Evolução", keywords: "meses números resultado" },
  { tab: "fontes", title: "Base de conhecimento", keywords: "fontes site pdf perguntas respostas conhecimento" },
  { tab: "personalidade", title: "Personalidade", keywords: "nome tom voz instruções saudação" },
  { tab: "aparencia", title: "Rosto e aparência", keywords: "cor olhos balão perguntas sugeridas" },
  { tab: "atendimento", title: "Atendimento humano", keywords: "equipe horário pesquisa satisfação" },
  { tab: "leads", title: "Captura de leads", keywords: "contato aviso lead" },
  { tab: "roteiros", title: "Roteiros", keywords: "passos fluxo identificação" },
  { tab: "acoes", title: "Ações", keywords: "integração api sistema contexto" },
  { tab: "instalacao", title: "Chat do site", keywords: "instalar código widget" },
  { tab: "whatsapp", title: "WhatsApp", keywords: "número conectar modelos" },
  { tab: "instagram", title: "Instagram", keywords: "conta conectar comentários direct" },
];
export const CLIENT_TABS: Array<{ tab: string; title: string; keywords: string }> = [
  { tab: "contatos", title: "Contatos", keywords: "pessoas" },
  { tab: "leads", title: "Leads", keywords: "pedido" },
  { tab: "campanhas", title: "Campanhas", keywords: "lembrete disparo consentimento fuso" },
  { tab: "conversas", title: "Conversas", keywords: "atendimentos" },
  { tab: "setores", title: "Setores", keywords: "fila rodízio equipe" },
  { tab: "respostas", title: "Respostas prontas", keywords: "atalho texto pronto" },
  { tab: "dados", title: "Dados do cliente", keywords: "nome site cadastro" },
  { tab: "relatorio", title: "Relatório e portal", keywords: "mensal link portal" },
  { tab: "acesso", title: "Acesso do cliente", keywords: "área do cliente gestor atendente" },
  { tab: "conformidade", title: "Conformidade", keywords: "aceite revisão meta" },
];

/**
 * As abas de dentro de um chatbot ou de um cliente que a busca pede: só quando alguma palavra da
 * busca não está no nome (senão "sofia" traria as 12 abas) e todas as que sobram estão na aba.
 */
export function innerTabs(parents: GoToItem[], tabs: Array<{ tab: string; title: string; keywords: string }>, query: string, max = 6): GoToItem[] {
  const words = fold(query.trim()).split(/\s+/).filter(Boolean);
  const out: GoToItem[] = [];
  for (const p of parents) {
    if (!p.href) continue;
    const own = fold([p.title, p.sub].filter(Boolean).join(" "));
    const rest = words.filter((w) => !own.includes(w));
    if (!rest.length || rest.length === words.length) continue;
    for (const t of tabs) {
      const hay = fold(`${t.title} ${t.keywords}`);
      if (rest.every((w) => hay.includes(w))) out.push({ id: `${p.id}-${t.tab}`, kind: p.kind, title: t.title, sub: p.title, href: `${p.href}?tab=${t.tab}`, color: p.color, face: p.face });
    }
  }
  return out.slice(0, max);
}

/** As telas, os ajustes e as ações que a pessoa pode abrir. */
export function staticGroups(role: AgencyRole, packs: readonly string[], wholeAccount = true, business: { clientId: string | null } | null = null): { pages: GoToItem[]; actions: GoToItem[]; settings: GoToItem[] } {
  const pages: GoToItem[] = dayToDay(business).filter((i) => allowed(i, role, packs, wholeAccount)).map((i) => ({ id: i.href, kind: "page", title: i.label, href: i.href, keywords: i.keywords }));
  const settings: GoToItem[] = [
    ...settingsFor(role, packs).flatMap((g) =>
      g.items.flatMap((i) => [
        { id: i.href, kind: "setting" as const, title: i.label, sub: `Configurações · ${g.group}`, href: i.href, keywords: i.keywords },
        ...(SUB_PAGES[i.href] ?? []).map((s) => ({ id: i.href + s.q, kind: "setting" as const, title: s.title, sub: i.label, href: i.href + s.q, keywords: s.keywords })),
      ]),
    ),
    ...pages.flatMap((p) => (SUB_PAGES[p.id] ?? []).map((s) => ({ id: p.id + s.q, kind: "setting" as const, title: s.title, sub: p.title, href: p.id + s.q, keywords: s.keywords }))),
    { id: "/painel/perfil", kind: "setting", title: "Meu perfil", sub: "Nome, foto, assinatura e avisos", href: "/painel/perfil", keywords: "senha whatsapp avisos celular disponível" },
    { id: "/painel/roadmap", kind: "setting", title: "Novidades e roadmap", sub: "O que vem por aí", href: "/painel/roadmap", keywords: "novidades sugestão" },
    { id: "/ajuda", kind: "setting", title: "Central de ajuda", sub: "Como fazer cada coisa", href: "/ajuda", keywords: "ajuda dúvida tutorial" },
  ];
  const actions: GoToItem[] = [
    ...(can(role, "config")
      ? [
          // no perfil do negócio não há cliente para cadastrar: o chatbot é do próprio negócio
          ...(business ? [] : [{ id: "novo-cliente", kind: "action" as const, title: "Novo cliente", sub: "Cadastrar um cliente", run: "novo-cliente" as const, keywords: "criar adicionar" }]),
          { id: "novo-chatbot", kind: "action" as const, title: "Novo chatbot", sub: business ? "Um assistente do seu negócio" : "Um chatbot para um cliente", run: "novo-chatbot" as const, keywords: "criar adicionar assistente bot" },
          { id: "nova-campanha", kind: "action" as const, title: "Nova campanha", sub: "Modelo aprovado para uma etiqueta", href: "/painel/campanhas/nova", keywords: "criar disparo" },
          { id: "primeiros-passos", kind: "action" as const, title: "Primeiros passos", sub: "Mostrar de novo a lista do começo", run: "primeiros-passos" as const, keywords: "começar onboarding checklist passo a passo ocultar mostrar" },
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
export function buildGroups(o: { query: string; role: AgencyRole; packs: readonly string[]; wholeAccount?: boolean; clients: GoToItem[]; remote: GoToGroup[]; business?: { clientId: string | null } | null }): GoToGroup[] {
  const { pages, actions, settings } = staticGroups(o.role, o.packs, o.wholeAccount, o.business ?? null);
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
  const allClients = [...o.clients, ...remote("Clientes").filter((c) => !o.clients.some((l) => l.id === c.id))];
  const clients = [...localClients, ...remote("Clientes").filter((c) => matches(c, q) && !localClients.some((l) => l.id === c.id))].slice(0, 5);
  const bots = remote("Chatbots");
  // "sorriso roteiros": as abas de dentro do chatbot e do cliente
  const inner = [...innerTabs(bots, BOT_TABS, q), ...innerTabs(allClients, CLIENT_TABS, q)].slice(0, 6);
  return [
    { title: "Contatos", items: remote("Contatos") },
    { title: "Conversas", items: remote("Conversas") },
    { title: "Abas", items: inner },
    { title: "Clientes", items: clients },
    { title: "Chatbots", items: bots.filter((b) => matches(b, q)) },
    { title: "Ações", items: actions.filter((a) => matches(a, q)).slice(0, 4) },
    { title: "Ajustes", items: [...pages, ...settings].filter((s) => matches(s, q)).slice(0, 5) },
  ].filter((g) => g.items.length);
}
