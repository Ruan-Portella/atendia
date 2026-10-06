import Link from "next/link";

/** Selo do excedente do plano (leva B1', parte 4b). Com `link`, leva para Cobrança > Limites do plano. */
export function PlanPausedBadge({ link = false }: { link?: boolean }) {
  const cls = "rounded-full bg-amber-soft px-2 py-0.5 text-xs font-semibold text-amber-ink";
  return link ? (
    <Link href="/painel/cobranca/limites" className={`${cls} hover:underline`} title="Escolher o que fica ativo">
      Pausado pelo plano
    </Link>
  ) : (
    <span className={cls}>Pausado pelo plano</span>
  );
}
