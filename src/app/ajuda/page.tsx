import Link from "next/link";
import { HelpSearch, type HelpEntry } from "@/components/help-search";
import { HelpGroups } from "@/components/help-groups";
import { groupHelp, helpArticles, helpSummary } from "@/lib/help-center";

export const metadata = { title: { absolute: "Central de ajuda · BoaVoz" } };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Entrada da central de ajuda: a busca e os grupos, com uma página por assunto do guia do painel (redesenho, 23/10/2026: os grupos em cartões com o ícone e os assuntos em linhas). */
export default function HelpHome() {
  const groups = groupHelp(helpArticles());
  const entries: HelpEntry[] = groups.flatMap((g) => g.articles.map((a) => ({ slug: a.slug, title: a.title, group: g.title, summary: helpSummary(a), haystack: norm(`${a.title} ${a.plain}`) })));

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <span className="eyebrow">Central de ajuda</span>
        <h1 className="text-3xl font-normal leading-[1.1] md:text-[40px]">Como podemos ajudar?</h1>
        <p className="text-[17px] leading-relaxed text-ink-2">Tudo sobre o painel: chatbots, canais, atendimento, equipe, campanhas e cobrança. Para integrar sistemas, veja a <Link href="/docs" className="font-medium text-brand underline">documentação</Link>.</p>
      </div>
      <HelpSearch entries={entries}>
        <HelpGroups groups={groups} />
      </HelpSearch>
    </div>
  );
}
