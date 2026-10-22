import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * O alto de Campanhas e réguas (redesenho, etapa 5): o título, as duas abas (Campanhas e Réguas, cada
 * uma com o seu endereço) e o botão da aba aberta.
 */
export function CampaignsHeader({ active, action }: { active: "campanhas" | "reguas"; action?: React.ReactNode }) {
  const tabs = [
    { key: "campanhas", label: "Campanhas", href: "/painel/campanhas", hint: "Envios para um público, quando você quiser." },
    { key: "reguas", label: "Réguas", href: "/painel/campanhas/reguas", hint: "Mensagens automáticas: aniversário, lembrete, pós-atendimento…" },
  ] as const;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-normal sm:text-[28px]">Campanhas e réguas</h1>
          <p className="text-sm text-muted">{tabs.find((t) => t.key === active)?.hint} Saem pelo WhatsApp de cada chatbot.</p>
        </div>
        {action}
      </div>
      <nav aria-label="Campanhas e réguas" className="flex gap-1 self-start rounded-[14px] bg-panel p-1 shadow-[inset_0_0_0_1px_var(--color-line)]">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            aria-current={active === t.key ? "page" : undefined}
            className={cn("rounded-[10px] px-4 py-1.5 text-sm font-medium transition-colors duration-[120ms]", active === t.key ? "bg-raised text-ink shadow-[inset_0_0_0_1px_var(--color-line)]" : "text-muted hover:text-ink")}
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
