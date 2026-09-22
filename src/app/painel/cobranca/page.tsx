import { requireAgency } from "@/lib/agency";
import { PLANS, brl, num } from "@/lib/plans";
import { billingEnabled } from "@/lib/stripe";
import { PlanButtons } from "@/components/plan-buttons";
import { daysUntil } from "@/lib/utils";

export const metadata = { title: "Cobrança" };

export default async function CobrancaPage({ searchParams }: PageProps<"/painel/cobranca">) {
  const sp = await searchParams;
  const { agency, plan, usage } = await requireAgency();
  const trialDays = plan.id === "trial" ? daysUntil(agency.trial_ends_at) : null;
  return (
    <div className="max-w-[900px]">
      <h1 className="text-[28px] font-bold">Cobrança</h1>
      <p className="text-sm text-muted">Plano atual: <strong>{plan.name}</strong>{trialDays !== null ? ` · ${trialDays} dias de teste restantes` : ""} · {num(usage)} de {num(plan.conversations)} conversas usadas este mês.</p>
      {sp.ok && <p className="mt-4 rounded-lg bg-brand-soft px-3 py-2 text-sm text-brand">Assinatura ativada. Obrigado!</p>}
      {sp.limite === "bots" && <p className="mt-4 rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink">Você chegou ao limite de chatbots do plano {plan.name}. Faça upgrade para adicionar mais clientes.</p>}
      {!billingEnabled && <p className="mt-4 rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink">Cobrança ainda não configurada neste servidor (STRIPE_SECRET_KEY). Todas as contas ficam em teste.</p>}
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {(["freelancer", "agencia", "escala"] as const).map((id) => {
          const p = PLANS[id];
          const current = plan.id === id;
          return (
            <div key={id} className={current ? "flex flex-col gap-3 rounded-2xl bg-brand p-6 text-ground" : "card flex flex-col gap-3 p-6"}>
              <div className="display text-xl font-bold">{p.name}</div>
              <div className="display text-4xl font-bold">{brl(p.priceBrl)}<span className="text-sm font-normal opacity-70">/mês</span></div>
              <div className={current ? "text-sm text-[#dfe9e4]" : "text-sm text-ink-2"}>{p.description}</div>
              <div className="mt-auto pt-2"><PlanButtons plan={id} current={current} enabled={billingEnabled} hasSubscription={Boolean(agency.stripe_customer_id) && plan.id !== "trial"} /></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
