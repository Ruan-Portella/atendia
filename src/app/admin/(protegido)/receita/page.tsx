import Link from "next/link";
import { Kpi } from "@/components/kpi";
import { requireAdmin } from "@/lib/platform-admin";
import { getAgencies, getRevenue, monthStartBR } from "@/lib/backoffice";
import { createAdminClient } from "@/lib/supabase/admin";
import { brl, num } from "@/lib/plans";
import { currentPeriodBR } from "@/lib/utils";

export const metadata = { title: "Receita" };

export default async function AdminRevenue() {
  await requireAdmin("/admin/receita");
  const [revenue, agencies] = await Promise.all([getRevenue(), getAgencies()]);
  const { data: commissions } = await createAdminClient().from("referral_commissions").select("commission_cents").gte("created_at", monthStartBR(currentPeriodBR()).toISOString());
  const commissionCents = (commissions ?? []).reduce((t, c) => t + (Number(c.commission_cents) || 0), 0);
  const byCustomer = new Map(agencies.filter((a) => a.stripeCustomerId).map((a) => [a.stripeCustomerId!, a]));

  if (!revenue) {
    return (
      <>
        <h1 className="text-[26px] font-bold">Receita</h1>
        <p className="card p-5 text-sm text-muted">O Stripe não está configurado neste ambiente (falta STRIPE_SECRET_KEY).</p>
      </>
    );
  }
  if ("error" in revenue) {
    return (
      <>
        <h1 className="text-[26px] font-bold">Receita</h1>
        <p className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">Não deu para consultar o Stripe: {revenue.error}</p>
      </>
    );
  }

  return (
    <>
      <div>
        <h1 className="text-[26px] font-bold">Receita</h1>
        <p className="text-sm text-muted">
          Direto do Stripe{revenue.testMode ? " (modo de teste: valores de teste, não dinheiro de verdade)" : ""}. MRR = assinaturas ativas e com pagamento atrasado, sem descontos e cupons.
        </p>
      </div>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Receita mensal (MRR)" value={brl(revenue.mrrCents / 100)} sub={`${revenue.active} assinaturas ativas`} />
        <Kpi label="Recebido em 30 dias" value={brl(revenue.paid30dCents / 100)} sub="faturas pagas" />
        <Kpi label="Pagamento atrasado" value={num(revenue.pastDue)} sub={`${revenue.failed.length} faturas com tentativa falha`} />
        <Kpi label="Cancelamentos (30 dias)" value={num(revenue.canceled30d)} sub={`comissões de indicação no mês: ${brl(commissionCents / 100)}`} />
      </section>

      <section className="card flex flex-col gap-3 p-5">
        <h2 className="text-lg font-bold">Assinaturas por plano</h2>
        {revenue.byPlan.length ? (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="py-1.5 font-semibold">Plano</th><th className="py-1.5 text-right font-semibold">Assinaturas</th><th className="py-1.5 text-right font-semibold">MRR</th></tr></thead>
            <tbody>
              {revenue.byPlan.map((p) => (
                <tr key={p.plan} className="border-t border-line-2"><td className="py-2">{p.plan}</td><td className="py-2 text-right tabular">{num(p.count)}</td><td className="py-2 text-right tabular">{brl(p.mrrCents / 100)}</td></tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-muted">Nenhuma assinatura ativa.</p>
        )}
      </section>

      <section className="card flex flex-col gap-3 p-5">
        <h2 className="text-lg font-bold">Faturas com pagamento falho</h2>
        {revenue.failed.length ? (
          <ul className="flex flex-col divide-y divide-line-2 text-sm">
            {revenue.failed.map((f) => {
              const a = byCustomer.get(f.customer);
              return (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>{a ? <Link href={`/admin/clientes/${a.id}`} className="font-semibold hover:underline">{a.name}</Link> : f.customer} · {f.attempts} tentativa{f.attempts === 1 ? "" : "s"}</span>
                  <span className="flex items-center gap-3">
                    <span className="tabular">{brl(f.amountCents / 100)}</span>
                    {f.url && <a href={f.url} target="_blank" rel="noreferrer" className="text-xs font-semibold underline">fatura ↗</a>}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted">Nenhuma.</p>
        )}
      </section>
    </>
  );
}
