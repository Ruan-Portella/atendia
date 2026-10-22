import Link from "next/link";
import { HelpSearch, type HelpEntry } from "@/components/help-search";
import { groupHelp, helpArticles, helpSummary } from "@/lib/help-center";

export const metadata = { title: { absolute: "Central de ajuda · BoaVoz" } };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Entrada da central de ajuda: a busca e os grupos, com uma página por assunto do guia do painel. */
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
        <div className="grid gap-6 sm:grid-cols-2">
          {groups.map((g) => (
            <section key={g.title} className="rounded-xl border border-line bg-panel p-5">
              <h2 className="text-base font-medium text-ink">{g.title}</h2>
              <ul className="mt-3 flex flex-col gap-1.5">
                {g.articles.map((a) => (
                  <li key={a.slug}>
                    <Link href={`/ajuda/${a.slug}`} className="text-sm text-ink-2 hover:text-brand hover:underline">
                      {a.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </HelpSearch>
    </div>
  );
}
