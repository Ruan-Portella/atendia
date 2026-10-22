"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface Group {
  group: string;
  items: Array<{ href: string; label: string }>;
}

/**
 * Menu de ajustes ao lado (como no Slack e no Linear): no computador, uma coluna com os grupos;
 * no celular, uma faixa que rola de lado. O verde diz onde você está.
 */
export function SettingsNav({ groups }: { groups: Group[] }) {
  const path = usePathname();
  // o de caminho mais longo que bate: em Uso e custo, acende ele e não Assinatura
  const active = groups
    .flatMap((g) => g.items)
    .filter((i) => path === i.href || path.startsWith(i.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav aria-label="Configurações" className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:-mx-6 sm:px-6 lg:sticky lg:top-7 lg:mx-0 lg:flex-col lg:gap-5 lg:overflow-visible lg:px-0 lg:pb-0">
      {groups.map((g) => (
        <div key={g.group} className="flex shrink-0 gap-1 lg:flex-col lg:gap-0.5">
          <div className="hidden px-3 pb-1 font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted lg:block">{g.group}</div>
          {g.items.map((i) => {
            const on = i.href === active;
            return (
              <Link
                key={i.href}
                href={i.href}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "relative shrink-0 whitespace-nowrap rounded-[10px] px-3 py-2 text-sm transition-colors duration-[120ms]",
                  on ? "bg-raised font-medium text-ink" : "text-ink-2 hover:bg-raised/60 hover:text-ink",
                )}
              >
                {on && <span aria-hidden className="absolute inset-y-2 left-0 hidden w-[3px] rounded-full bg-brand lg:block" />}
                {i.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
