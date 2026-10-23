import Link from "next/link";
import { BadgeDollarSign, Bot, ChevronRight, Compass, Headset, Megaphone, Radio, ShieldCheck } from "lucide-react";

/** O ícone de cada grupo da central de ajuda (os títulos de HELP_GROUPS). */
export const HELP_GROUP_ICON: Record<string, typeof Bot> = {
  Começar: Compass,
  "Chatbots e IA": Bot,
  Canais: Radio,
  "Atendimento e equipe": Headset,
  "Contatos e campanhas": Megaphone,
  "Preços e cobrança": BadgeDollarSign,
  "Integrações e segurança": ShieldCheck,
};

/**
 * Os grupos da central de ajuda (redesenho, 23/10/2026): um cartão por grupo, com o ícone, quantos
 * assuntos tem e cada assunto numa linha com a seta, no padrão das linhas do painel.
 */
export function HelpGroups({ groups }: { groups: Array<{ title: string; articles: Array<{ slug: string; title: string }> }> }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {groups.map((g) => {
        const Icon = HELP_GROUP_ICON[g.title] ?? Compass;
        return (
          <section key={g.title} className="card flex flex-col overflow-hidden">
            <div className="flex items-center gap-3 border-b border-line-2 px-4 py-3.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-brand-soft text-brand">
                <Icon size={18} />
              </span>
              <h2 className="min-w-0 flex-1 text-[15px] font-medium text-ink">{g.title}</h2>
              <span className="font-mono text-[11px] text-muted">{g.articles.length}</span>
            </div>
            <ul className="flex flex-col divide-y divide-line-2">
              {g.articles.map((a) => (
                <li key={a.slug}>
                  <Link href={`/ajuda/${a.slug}`} className="group/help flex items-center gap-2 px-4 py-2.5 text-sm text-ink-2 transition-colors duration-[120ms] hover:bg-raised/50 hover:text-ink">
                    <span className="min-w-0 flex-1">{a.title}</span>
                    <ChevronRight size={15} className="shrink-0 text-muted transition-transform duration-[120ms] group-hover/help:translate-x-0.5" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
