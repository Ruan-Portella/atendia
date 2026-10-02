import Link from "next/link";
import { notFound } from "next/navigation";
import { Kpi } from "@/components/kpi";
import { AgencyActions } from "@/components/admin/pause-controls";
import { requireAdmin } from "@/lib/platform-admin";
import { agencyStatus, daysAgoIso, getAgencies, kindLabel, usd, usdBrl } from "@/lib/backoffice";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe";
import { brl, num } from "@/lib/plans";
import { relativeTime } from "@/lib/utils";

export const metadata = { title: "Cliente" };

const STATUS_LABEL = { pagante: "Pagante", teste: "Em teste", teste_vencido: "Teste vencido", cancelada: "Cancelada" } as const;
const BOT_STATUS: Record<string, string> = { live: "publicado", draft: "rascunho", training: "lendo fontes", error: "com erro" };

export default async function AdminClient({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdmin(`/admin/clientes/${id}`);
  const agency = (await getAgencies()).find((a) => a.id === id);
  if (!agency) notFound();

  const db = createAdminClient();
  const since30 = daysAgoIso(30);
  const { data: bots } = await db.from("bots").select("id, name, client_name, status, is_demo, created_at").eq("agency_id", id).order("created_at");
  const botIds = (bots ?? []).map((b) => b.id as string);
  const [{ data: wa }, { data: ig }, { data: usage }, { data: monthly }, convCounts] = await Promise.all([
    botIds.length ? db.from("whatsapp_channels").select("bot_id, display_phone, disconnected_at").in("bot_id", botIds) : Promise.resolve({ data: [] }),
    botIds.length ? db.from("instagram_channels").select("bot_id, username, disconnected_at").in("bot_id", botIds) : Promise.resolve({ data: [] }),
    db.from("usage").select("period, conversations").eq("agency_id", id).order("period", { ascending: false }).limit(6),
    db.from("ai_usage_monthly").select("period, kind, calls, cost_usd").eq("agency_id", id).order("period", { ascending: false }).limit(40),
    Promise.all(botIds.map(async (b) => [b, (await db.from("conversations").select("id", { count: "exact", head: true }).eq("bot_id", b).gte("started_at", since30)).count ?? 0] as const)),
  ]);
  const conv30 = new Map(convCounts);
  const waBy = new Map((wa ?? []).map((w) => [w.bot_id as string, w]));
  const igBy = new Map((ig ?? []).map((i) => [i.bot_id as string, i]));

  // custo de IA por mês (totais fechados) e por tipo
  const months = new Map<string, { cost: number; calls: number; kinds: Array<{ kind: string; cost: number }> }>();
  for (const r of monthly ?? []) {
    const m = months.get(r.period as string) ?? { cost: 0, calls: 0, kinds: [] };
    m.cost += Number(r.cost_usd) || 0;
    m.calls += Number(r.calls) || 0;
    m.kinds.push({ kind: r.kind as string, cost: Number(r.cost_usd) || 0 });
    months.set(r.period as string, m);
  }

  const testMode = process.env.STRIPE_SECRET_KEY?.startsWith("sk_test") ?? false;
  const invoices = stripe && agency.stripeCustomerId ? (await stripe.invoices.list({ customer: agency.stripeCustomerId, limit: 6 }).catch(() => null))?.data ?? [] : [];
  const fx = usdBrl();
  const st = agencyStatus(agency);

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/admin/clientes" className="text-xs font-semibold text-muted">← Clientes</Link>
          <h1 className="text-[26px] font-bold">{agency.name}</h1>
          <p className="text-sm text-muted">{agency.email ?? "sem e-mail"} · desde {new Date(agency.createdAt).toLocaleDateString("pt-BR")} · {agency.planName} ({STATUS_LABEL[st]}{st === "teste" ? `, até ${new Date(agency.trialEndsAt).toLocaleDateString("pt-BR")}` : ""})</p>
        </div>
        {agency.stripeCustomerId && (
          <a href={`https://dashboard.stripe.com/${testMode ? "test/" : ""}customers/${agency.stripeCustomerId}`} target="_blank" rel="noreferrer" className="btn-ghost">Abrir no Stripe ↗</a>
        )}
      </div>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Conversas no mês" value={`${num(agency.conversationsMonth)} / ${num(agency.quota)}`} sub={`${agency.quota ? Math.round((agency.conversationsMonth / agency.quota) * 100) : 0}% da cota`} />
        <Kpi label="IA no mês" value={usd(agency.aiCostMonthUsd)} sub={`≈ ${brl(agency.aiCostMonthUsd * fx)}`} />
        <Kpi label="Mensalidade" value={agency.priceBrl ? brl(agency.priceBrl) : "—"} sub={agency.priceBrl ? `margem ${brl(agency.priceBrl - agency.aiCostMonthUsd * fx)}` : "sem plano pago"} />
        <Kpi label="Chatbots" value={`${agency.liveBots}/${agency.bots}`} sub={`publicados · WhatsApp ${agency.whatsapp} · Instagram ${agency.instagram}`} />
      </section>

      <AgencyActions agency={agency} />

      <section className="card overflow-x-auto">
        <h2 className="px-5 pt-4 text-lg font-bold">Chatbots</h2>
        <table className="mt-2 w-full min-w-[640px] text-sm">
          <thead className="border-b border-line text-left text-xs text-muted">
            <tr><th className="px-5 py-2 font-semibold">Bot</th><th className="px-3 py-2 font-semibold">Situação</th><th className="px-3 py-2 font-semibold">WhatsApp</th><th className="px-3 py-2 font-semibold">Instagram</th><th className="px-5 py-2 text-right font-semibold">Conversas (30 dias)</th></tr>
          </thead>
          <tbody>
            {(bots ?? []).map((b) => {
              const w = waBy.get(b.id as string);
              const i = igBy.get(b.id as string);
              return (
                <tr key={b.id as string} className="border-b border-line-2 last:border-0">
                  <td className="px-5 py-2.5"><span className="font-semibold">{b.name as string}</span><div className="text-xs text-muted">{b.client_name as string}{b.is_demo ? " · demo" : ""}</div></td>
                  <td className="px-3 py-2.5">{BOT_STATUS[b.status as string] ?? (b.status as string)}</td>
                  <td className="px-3 py-2.5 text-xs">{w ? (w.disconnected_at ? <span className="text-danger">desconectado</span> : ((w.display_phone as string | null) ?? "conectado")) : <span className="text-muted">—</span>}</td>
                  <td className="px-3 py-2.5 text-xs">{i ? (i.disconnected_at ? <span className="text-danger">desconectado</span> : `@${(i.username as string | null) ?? "conectado"}`) : <span className="text-muted">—</span>}</td>
                  <td className="px-5 py-2.5 text-right tabular">{num(conv30.get(b.id as string) ?? 0)}</td>
                </tr>
              );
            })}
            {!bots?.length && <tr><td colSpan={5} className="px-5 py-5 text-center text-muted">Nenhum chatbot.</td></tr>}
          </tbody>
        </table>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card flex flex-col gap-3 p-5">
          <h2 className="text-lg font-bold">Uso e custo por mês</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="py-1.5 font-semibold">Mês</th><th className="py-1.5 text-right font-semibold">Conversas</th><th className="py-1.5 text-right font-semibold">Custo de IA</th></tr></thead>
            <tbody>
              {(usage ?? []).map((u) => {
                const m = months.get(u.period as string);
                return (
                  <tr key={u.period as string} className="border-t border-line-2">
                    <td className="py-2">{u.period as string}</td>
                    <td className="py-2 text-right tabular">{num(Number(u.conversations) || 0)}</td>
                    <td className="py-2 text-right tabular" title={m?.kinds.map((k) => `${kindLabel(k.kind)}: ${usd(k.cost, 4)}`).join("\n")}>{m ? usd(m.cost) : "—"}</td>
                  </tr>
                );
              })}
              {!usage?.length && <tr><td colSpan={3} className="py-3 text-center text-muted">Sem uso registrado.</td></tr>}
            </tbody>
          </table>
          <p className="text-xs text-muted">O custo do mês corrente entra nos totais mensais pelo job diário; o valor de hoje está nos cartões acima.</p>
        </section>

        <section className="card flex flex-col gap-3 p-5">
          <h2 className="text-lg font-bold">Faturas (Stripe)</h2>
          {invoices.length ? (
            <ul className="flex flex-col divide-y divide-line-2 text-sm">
              {invoices.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between gap-3 py-2">
                  <span>{new Date((inv.created ?? 0) * 1000).toLocaleDateString("pt-BR")} · {inv.status === "paid" ? "paga" : inv.status === "open" ? "em aberto" : inv.status}</span>
                  <span className="tabular">{brl((inv.amount_paid || inv.amount_due || 0) / 100)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">{agency.stripeCustomerId ? "Nenhuma fatura." : "Ainda não é cliente no Stripe."}</p>
          )}
          {agency.lastActivity && <p className="mt-auto text-xs text-muted">Última conversa {relativeTime(agency.lastActivity)}.</p>}
        </section>
      </div>
    </>
  );
}
