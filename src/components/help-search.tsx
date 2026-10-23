"use client";

import Link from "next/link";
import { useState } from "react";
import { Search } from "lucide-react";

export interface HelpEntry {
  slug: string;
  title: string;
  group: string;
  summary: string;
  /** título e texto sem acento e em minúsculas, para a busca */
  haystack: string;
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const tokens = (s: string) => s.split(/[^a-z0-9]+/).filter(Boolean);
/** Cada palavra buscada é o começo de alguma palavra do texto ("pin" acha "PIN", não "opinião"). */
const matches = (text: string, words: string[]) => {
  const t = tokens(text);
  return words.every((w) => t.some((x) => x.startsWith(w)));
};

/**
 * Busca da central de ajuda: sem texto, mostra os grupos (o conteúdo de children, do servidor);
 * com texto, as páginas em que todas as palavras aparecem, as do título primeiro.
 */
export function HelpSearch({ entries, children }: { entries: HelpEntry[]; children: React.ReactNode }) {
  const [q, setQ] = useState("");
  const words = tokens(norm(q)).filter((w) => w.length > 1);
  const found = words.length
    ? entries.filter((e) => matches(e.haystack, words)).sort((a, b) => Number(matches(norm(b.title), words.slice(0, 1))) - Number(matches(norm(a.title), words.slice(0, 1))))
    : null;

  return (
    <div className="flex flex-col gap-8">
      <label className="relative block">
        <span className="sr-only">Buscar na central de ajuda</span>
        <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar: WhatsApp, crédito, equipe, roteiro…" className="input py-3 pl-10 text-base" />
      </label>
      {found === null ? (
        children
      ) : found.length ? (
        <ul className="card flex flex-col divide-y divide-line-2 overflow-hidden" aria-live="polite">
          {found.map((e) => (
            <li key={e.slug}>
              <Link href={`/ajuda/${e.slug}`} className="flex flex-col gap-0.5 px-4 py-3 transition-colors duration-[120ms] hover:bg-raised/50">
                <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted">{e.group}</span>
                <span className="font-medium text-ink">{e.title}</span>
                <span className="text-sm text-muted">{e.summary}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted" aria-live="polite">
          Nada com essas palavras. Tente outra (por exemplo, &quot;WhatsApp&quot; ou &quot;cobrança&quot;) ou pergunte ao assistente da BoaVoz no WhatsApp, em Meu perfil.
        </p>
      )}
    </div>
  );
}
