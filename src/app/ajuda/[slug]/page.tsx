import Link from "next/link";
import { notFound } from "next/navigation";
import { groupHelp, helpArticles, helpSummary } from "@/lib/help-center";

export function generateStaticParams() {
  return helpArticles().map((a) => ({ slug: a.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: PageProps<"/ajuda/[slug]">) {
  const { slug } = await params;
  const a = helpArticles().find((x) => x.slug === slug);
  return a ? { title: a.title, description: helpSummary(a) } : {};
}

/** Uma página da central de ajuda: uma seção do guia do painel e as outras do mesmo grupo. */
export default async function HelpArticlePage({ params }: PageProps<"/ajuda/[slug]">) {
  const { slug } = await params;
  const groups = groupHelp(helpArticles());
  const group = groups.find((g) => g.articles.some((a) => a.slug === slug));
  const article = group?.articles.find((a) => a.slug === slug);
  if (!group || !article) notFound();

  return (
    <article className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Link href="/ajuda" className="text-sm font-semibold text-muted hover:text-ink">
          ← Central de ajuda
        </Link>
        <span className="eyebrow">{group.title}</span>
        <h1 className="text-3xl font-bold leading-[1.1] md:text-[40px]">{article.title}</h1>
      </div>
      <div className="flex max-w-[680px] flex-col gap-4 text-[16px] leading-relaxed text-ink-2">
        {article.blocks.map((b, i) =>
          b.kind === "p" ? (
            <p key={i}>{b.text}</p>
          ) : b.kind === "ul" ? (
            <ul key={i} className="flex list-disc flex-col gap-1.5 pl-5">
              {b.items.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          ) : (
            <ol key={i} className="flex list-decimal flex-col gap-1.5 pl-5">
              {b.items.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ol>
          ),
        )}
      </div>
      {group.articles.length > 1 && (
        <section className="flex flex-col gap-3 border-t border-line pt-6">
          <h2 className="text-sm font-bold uppercase tracking-[0.06em] text-muted">Mais em {group.title}</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {group.articles
              .filter((a) => a.slug !== slug)
              .map((a) => (
                <li key={a.slug}>
                  <Link href={`/ajuda/${a.slug}`} className="block rounded-xl border border-line bg-white px-4 py-3 text-sm font-semibold text-ink hover:border-brand">
                    {a.title}
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      )}
    </article>
  );
}
