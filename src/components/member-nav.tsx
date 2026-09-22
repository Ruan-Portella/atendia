"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/** Abas da área do cliente; só aparecem as que a agência liberou. */
export function MemberNav({ clientId, handoff, knowledge, waiting }: { clientId: string; handoff: boolean; knowledge: boolean; waiting: number }) {
  const path = usePathname();
  const base = `/cliente/${clientId}`;
  const tabs = [
    { href: base, label: "Relatório", active: path === base, badge: 0 },
    { href: `${base}/conversas`, label: handoff ? "Atendimento" : "Conversas", active: path.startsWith(`${base}/conversas`), badge: handoff ? waiting : 0 },
    ...(knowledge ? [{ href: `${base}/aprender`, label: "Ensinar o assistente", active: path.startsWith(`${base}/aprender`), badge: 0 }] : []),
  ];
  return (
    <nav className="mx-auto flex max-w-[980px] gap-1 overflow-x-auto px-4 [scrollbar-width:none] sm:px-6 print:hidden">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} className={cn("-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm", t.active ? "border-brand font-semibold text-brand" : "border-transparent font-medium text-ink-2 hover:text-ink")}>
          {t.label}
          {t.badge ? <span className="ml-1.5 rounded-full bg-amber-soft px-1.5 py-0.5 text-[11px] font-semibold text-amber-ink">{t.badge}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
