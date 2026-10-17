import Link from "next/link";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/painel/cobranca", label: "Assinatura" },
  { href: "/painel/cobranca/uso", label: "Uso e custo" },
  { href: "/painel/cobranca/credito", label: "Crédito" },
] as const;

/** Abas de Cobrança: assinatura (tamanhos e pacotes), uso e custo do mês e o crédito do excedente. */
export function BillingTabs({ active }: { active: (typeof TABS)[number]["href"] }) {
  return (
    <nav className="mt-4 flex gap-1 border-b border-line">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.href === active ? "page" : undefined}
          className={cn("-mb-px border-b-2 px-3 py-2 text-sm", t.href === active ? "border-brand font-semibold text-ink" : "border-transparent text-muted hover:text-ink")}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
