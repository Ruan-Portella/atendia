import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { slugify } from "./utils";

/*
 * Central de ajuda de quem usa o painel (Lançamento, parte 2, 19/10/2026): uma página por seção do
 * guia do painel (os arquivos de docs/assistente), a mesma fonte da base do assistente da
 * BoaVoz no WhatsApp. Atualizar o guia a cada leva atualiza as duas. Os guias do cliente ficam
 * no portal, com a marca da agência (client-guide.ts).
 */

export type HelpBlock = { kind: "p"; text: string } | { kind: "ul" | "ol"; items: string[] };

export interface HelpArticle {
  slug: string;
  title: string;
  blocks: HelpBlock[];
  /** O texto corrido, para a busca e o resumo da página. */
  plain: string;
}

/** Seções do guia que não viram página (falam do próprio assistente). */
const SKIP = new Set(["Sobre este assistente"]);

/** Os grupos da central, na ordem; cada seção do guia cai num deles (a que faltar vai para "Mais"). */
export const HELP_GROUPS: Array<{ title: string; sections: string[] }> = [
  { title: "Começar", sections: ["O que é o BoaVoz", "Como começar (primeiros passos)", "Onde fica cada coisa no painel", "Avisos (o sino)", "Ir para (Ctrl K)", "Tema escuro e claro", "Conta grátis", "Demos para prospects", "Roadmap e sugestões"] },
  { title: "Chatbots e IA", sections: ["A página do chatbot", "Rosto do chatbot", "Modelos de chatbot", "Base de conhecimento (fontes)", "Aviso do momento", "Perguntas sem resposta", "Personalidade e instruções", "Memória do assistente", "O que o assistente não faz", "Leads (captura de contatos)", "Áudios e fotos", "Roteiros", "Identificação pelo roteiro e lembrar o número"] },
  { title: "Canais", sections: ["Chat do site (widget)", "Conectar o WhatsApp de um cliente", "WhatsApp com o app do celular (coexistência)", "Contato do WhatsApp sem o número (nome de usuário)", "Problemas comuns na conexão", "Modelos de mensagem e janela de 24 horas", "Custo do WhatsApp", "Instagram Direct", "Posts do Instagram como fonte", "Regras da Meta e o portão do BoaVoz", "Botão de emergência"] },
  { title: "Atendimento e equipe", sections: ["Atendimento humano e conversas", "Caixa de entrada", "A lista e a conversa na Caixa de entrada", "Conversas anteriores da mesma pessoa", "As abas Conversas do cliente e do chatbot", "O que a IA fez em cada resposta", "Setores e feriados", "Transferir, notas internas, respostas prontas e adiar", "Citar, reagir e emojis na conversa", "Mandar foto ou PDF na conversa", "Chamados no chat do site", "Assinatura das mensagens da equipe", "Pesquisa de satisfação", "Equipe e papéis", "Meu perfil", "Avisos no WhatsApp para a equipe", "Avisos no celular e no computador", "Área do cliente (portal)", "A lista de clientes", "A página do cliente", "Relatórios", "Relatório mensal", "Evolução mês a mês", "Marca e domínio", "Cliente que veio de outra conta"] },
  { title: "Contatos e campanhas", sections: ["Contatos e leads", "Contatos", "Campanhas no WhatsApp", "Lembretes", "Réguas"] },
  { title: "Preços e cobrança", sections: ["Tamanhos e preços dos chatbots", "O que conta como um atendimento", "Excedente e crédito", "Pacotes da conta", "Assinatura, fatura e cancelamento", "Desistência em 7 dias e a primeira semana", "Pagamento atrasado", "Excluir a conta"] },
  { title: "Integrações e segurança", sections: ["Integrações: ações, webhooks e API", "Segurança e privacidade (LGPD)", "Página de status"] },
];

/** Blocos de um trecho de markdown simples: parágrafos e listas (- e 1.). Pura. */
export function helpBlocks(md: string): HelpBlock[] {
  const out: HelpBlock[] = [];
  for (const chunk of md.split(/\n\s*\n/)) {
    const lines = chunk.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    if (lines.every((l) => l.startsWith("- "))) out.push({ kind: "ul", items: lines.map((l) => l.slice(2).trim()) });
    else if (lines.every((l) => /^\d+\.\s/.test(l))) out.push({ kind: "ol", items: lines.map((l) => l.replace(/^\d+\.\s+/, "")) });
    else out.push({ kind: "p", text: lines.join(" ") });
  }
  return out;
}

/** As seções "## " do guia, cada uma uma página. Pura. */
export function parseHelpGuide(md: string): HelpArticle[] {
  const parts = md.split(/^## /m).slice(1);
  return parts
    .map((part) => {
      const nl = part.indexOf("\n");
      const title = (nl === -1 ? part : part.slice(0, nl)).trim();
      const blocks = helpBlocks(nl === -1 ? "" : part.slice(nl + 1));
      const plain = blocks.map((b) => (b.kind === "p" ? b.text : b.items.join(" "))).join(" ");
      return { slug: slugify(title), title, blocks, plain };
    })
    .filter((a) => !SKIP.has(a.title) && a.blocks.length);
}

let cache: HelpArticle[] | null = null;

/**
 * As páginas da central, lidas do guia do painel (no build; os arquivos vão junto no deploy). O guia
 * tem mais de um arquivo (cada um cabe numa fonte de texto do assistente): todos, na ordem do nome.
 */
export function helpArticles(): HelpArticle[] {
  const dir = join(process.cwd(), "docs", "assistente");
  cache ??= parseHelpGuide(
    readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .join("\n\n"),
  );
  return cache;
}

/** As páginas por grupo, na ordem dos grupos (o que não estiver em nenhum vai para "Mais"). Pura. */
export function groupHelp(articles: HelpArticle[]): Array<{ title: string; articles: HelpArticle[] }> {
  const used = new Set<string>();
  const groups = HELP_GROUPS.map((g) => {
    const list = g.sections.map((t) => articles.find((a) => a.title === t)).filter((a): a is HelpArticle => Boolean(a));
    list.forEach((a) => used.add(a.slug));
    return { title: g.title, articles: list };
  }).filter((g) => g.articles.length);
  const rest = articles.filter((a) => !used.has(a.slug));
  return rest.length ? [...groups, { title: "Mais", articles: rest }] : groups;
}

/** O resumo de uma página: o começo do texto, cortado na palavra. Pura. */
export function helpSummary(a: Pick<HelpArticle, "plain">, max = 160): string {
  if (a.plain.length <= max) return a.plain;
  const cut = a.plain.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:.]$/, "")}…`;
}
