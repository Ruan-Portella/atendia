import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { groupHelp, helpArticles, helpSummary } from "@/lib/help-center";
import { HELP_GROUP_ICON } from "@/components/help-groups";

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

  const Icon = HELP_GROUP_ICON[group.title];
  const others = group.articles.filter((a) => a.slug !== slug);
  // redesenho (23/10/2026): o caminho no alto, o texto em largura de leitura e, ao lado no computador
  // (embaixo no celular), os outros assuntos do grupo
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_240px]">
      <article className="flex min-w-0 flex-col gap-6">
        <nav aria-label="Caminho" className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
          <Link href="/ajuda" className="font-medium hover:text-ink">
            Central de ajuda
          </Link>
          <ChevronRight size={14} aria-hidden />
          <span className="inline-flex items-center gap-1.5">
            {Icon && <Icon size={14} aria-hidden />}
            {group.title}
          </span>
        </nav>
        <h1 className="text-3xl font-normal leading-[1.1] md:text-[38px]" style={{ textWrap: "balance" }}>
          {article.title}
        </h1>
        <div className="flex max-w-[680px] flex-col gap-4 text-[16px] leading-relaxed text-ink-2">
          {article.blocks.map((b, i) =>
            b.kind === "p" ? (
              <p key={i}>{b.text}</p>
            ) : b.kind === "ul" ? (
              <ul key={i} className="flex list-disc flex-col gap-1.5 pl-5 marker:text-brand">
                {b.items.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            ) : (
              <ol key={i} className="flex list-decimal flex-col gap-1.5 pl-5 marker:text-brand">
                {b.items.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ol>
            ),
          )}
        </div>
        <p className="rounded-[14px] bg-raised/70 px-4 py-3 text-sm text-ink-2">Ainda com dúvida? Pergunte ao assistente da BoaVoz no WhatsApp (o número fica em Meu perfil, no painel) ou busque outro assunto na <Link href="/ajuda" className="font-medium text-brand underline">Central de ajuda</Link>.</p>
      </article>
      {others.length > 0 && (
        <aside className="flex flex-col gap-2 lg:sticky lg:top-6 lg:self-start">
          <h2 className="kpi-label px-1">Mais em {group.title}</h2>
          <ul className="card flex flex-col divide-y divide-line-2 overflow-hidden">
            {others.map((a) => (
              <li key={a.slug}>
                <Link href={`/ajuda/${a.slug}`} className="flex items-center gap-2 px-3.5 py-2.5 text-[13.5px] text-ink-2 transition-colors duration-[120ms] hover:bg-raised/50 hover:text-ink">
                  <span className="min-w-0 flex-1">{a.title}</span>
                  <ChevronRight size={14} className="shrink-0 text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  );
}
