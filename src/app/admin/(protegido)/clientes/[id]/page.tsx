import Link from "next/link";
import { notFound } from "next/navigation";
import { Kpi } from "@/components/kpi";
import { AgencyActions, ChannelSuspension } from "@/components/admin/pause-controls";
import { AgencyFeatures } from "@/components/admin/release-controls";
import { SupportConversations } from "@/components/admin/support-conversations";
import { ContinuousChecks } from "@/components/admin/continuous-checks";
import { BotSizeForm } from "@/components/admin/bot-size-form";
import { BillingCard } from "@/components/admin/billing-card";
import { ClientTransferForm } from "@/components/admin/client-transfer-form";
import { FreeAccountCard } from "@/components/admin/free-account-card";
import { freeLinksOf } from "@/lib/person-signals";
import { WithdrawalAdminCard } from "@/components/admin/withdrawal-admin-card";
import { withdrawalState } from "@/lib/withdrawal";
import { DisputesAdminCard, type DisputeRow } from "@/components/admin/disputes-admin-card";
import { nextMonthTarget } from "@/lib/billing-sync";
import { creditBalance } from "@/lib/billing-credit";
import { targetMonthlyCents } from "@/lib/billing";
import { botQuotaStatus } from "@/lib/atendimentos";
import { continuousView } from "@/lib/continuous-check";
import { requireAdmin } from "@/lib/platform-admin";
import { AGENCY_STATUS_LABEL, agencyStatus, botChunkCounts, daysAgoIso, getAgencies, getMeasures, kindLabel, usd, usdBrl } from "@/lib/backoffice";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe";
import { brl, num } from "@/lib/plans";
import { relativeTime } from "@/lib/utils";

export const metadata = { title: "Agência" };

const BOT_STATUS: Record<string, string> = { live: "publicado", draft: "rascunho", training: "lendo fontes", error: "com erro" };

export default async function AdminClient({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdmin(`/admin/clientes/${id}`);
  const agency = (await getAgencies()).find((a) => a.id === id);
  if (!agency) notFound();

  const db = createAdminClient();
  const since30 = daysAgoIso(30);
  const [{ data: bots }, measures, continuous, quotas, { data: billing }, target, credit] = await Promise.all([
    db.from("bots").select("id, name, client_name, status, is_demo, paused_at, created_at").eq("agency_id", id).order("created_at"),
    getMeasures({ agencyId: id, active: true }),
    continuousView(db, { agencyId: id }),
    botQuotaStatus(db, id),
    db.from("agencies").select("billing_status, billing_cancel_at, stripe_subscription_id, credit_auto_enabled, test_answers_used, free_used_at, free_blocked_at, free_block_reason, free_released_at, first_paid_at, withdrawn_at").eq("id", id).maybeSingle(),
    nextMonthTarget(db, id),
    creditBalance(db, id),
  ]);
  const monthlyCents = targetMonthlyCents(target);
  const botIds = (bots ?? []).map((b) => b.id as string);
  const quotaBy = new Map(quotas.map((q) => [q.botId, q]));
  const [{ data: wa }, { data: ig }, { data: usage }, { data: monthly }, convCounts, chunkCounts] = await Promise.all([
    botIds.length ? db.from("whatsapp_channels").select("bot_id, display_phone, disconnected_at").in("bot_id", botIds) : Promise.resolve({ data: [] }),
    botIds.length ? db.from("instagram_channels").select("bot_id, username, disconnected_at").in("bot_id", botIds) : Promise.resolve({ data: [] }),
    db.rpc("atendimentos_by_month", { p_agency_id: id, p_months: 6 }),
    db.from("ai_usage_monthly").select("period, kind, calls, cost_usd").eq("agency_id", id).order("period", { ascending: false }).limit(40),
    Promise.all(botIds.map(async (b) => [b, (await db.from("conversations").select("id", { count: "exact", head: true }).eq("bot_id", b).gte("started_at", since30)).count ?? 0] as const)),
    botChunkCounts(botIds),
  ]);
  const conv30 = new Map(convCounts);
  // transferência de cliente (D', parte 5): os clientes desta conta e as transferências que a tocaram
  const [{ data: clientRows }, { data: transferRows }] = await Promise.all([
    db.from("clients").select("id, name").eq("agency_id", id).order("name"),
    db.from("client_transfers").select("id, client_name, from_agency_id, to_agency_id, requested_by, done_by, created_at").or(`from_agency_id.eq.${id},to_agency_id.eq.${id}`).order("created_at", { ascending: false }).limit(10),
  ]);
  const agencyName = new Map((await getAgencies()).map((a) => [a.id, a.name]));
  const freeLinks = await freeLinksOf(db, id);
  // desistência em 7 dias (Trava da conta grátis, parte 2)
  const billingStatus = (billing?.billing_status as string | undefined) ?? "none";
  const [withdrawal, { data: marked }, { data: withdrawalRows }] = await Promise.all([
    withdrawalState(db, { id, billing_status: billingStatus, first_paid_at: (billing?.first_paid_at as string | null | undefined) ?? null, withdrawn_at: (billing?.withdrawn_at as string | null | undefined) ?? null }),
    db.rpc("person_marked", { p_agency_id: id }),
    db.from("withdrawals").select("created_at, via, actor, refunded_cents, status, error").eq("agency_id", id).order("created_at", { ascending: false }).limit(10),
  ]);
  // contestações no cartão e avisos antecipados de fraude (Trava da conta grátis, parte 5)
  const { data: disputeRows } = await db.from("disputes").select("id, kind, amount_cents, reason, status, due_by, evidence, evidence_submitted_at, submitted_by, outcome, created_at").eq("agency_id", id).order("created_at", { ascending: false }).limit(10);
  const disputes: DisputeRow[] = (disputeRows ?? []).map((d) => ({ id: d.id as string, kind: d.kind as DisputeRow["kind"], amountCents: Number(d.amount_cents), reason: (d.reason as string | null) ?? null, status: d.status as string, dueBy: (d.due_by as string | null) ?? null, evidence: (d.evidence as DisputeRow["evidence"]) ?? null, submittedAt: (d.evidence_submitted_at as string | null) ?? null, submittedBy: (d.submitted_by as string | null) ?? null, outcome: (d.outcome as string | null) ?? null, createdAt: d.created_at as string }));
  const waBy = new Map((wa ?? []).map((w) => [w.bot_id as string, w]));
  const igBy = new Map((ig ?? []).map((i) => [i.bot_id as string, i]));

  // custo de IA por mês (totais fechados) e por tipo
  const months = new Map<string, { cost: number; calls: number; kinds: Array<{ kind: string; cost: number }> }>();
  // avaliações da IA (testes do backoffice) são custo da plataforma, não desta agência
  for (const r of (monthly ?? []).filter((x) => x.kind !== "avaliacao")) {
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
          <Link href="/admin/clientes" className="text-xs font-semibold text-muted">← Agências</Link>
          <h1 className="text-[26px] font-bold">{agency.name}</h1>
          <p className="text-sm text-muted">{agency.email ?? "sem e-mail"} · desde {new Date(agency.createdAt).toLocaleDateString("pt-BR")} · {AGENCY_STATUS_LABEL[st]}</p>
        </div>
        {agency.stripeCustomerId && (
          <a href={`https://dashboard.stripe.com/${testMode ? "test/" : ""}customers/${agency.stripeCustomerId}`} target="_blank" rel="noreferrer" className="btn-ghost">Abrir no Stripe ↗</a>
        )}
        <div className="flex flex-wrap gap-2">
          <Link href={`/admin/clientes/${id}/integracoes`} className="btn-ghost">Integrações (piloto)</Link>
          <Link href={`/admin/clientes/${id}/campanhas`} className="btn-ghost">Campanhas (teste)</Link>
        </div>
      </div>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Atendimentos no mês" value={`${num(agency.atendimentosMonth)} / ${num(agency.quota)}`} sub={`${agency.quota ? Math.round((agency.atendimentosMonth / agency.quota) * 100) : 0}% da cota`} />
        <Kpi label="IA no mês" value={usd(agency.aiCostMonthUsd)} sub={`≈ ${brl(agency.aiCostMonthUsd * fx)}`} />
        <Kpi label="Assinatura (próximo mês)" value={monthlyCents ? brl(monthlyCents / 100) : "—"} sub={monthlyCents ? `margem ${brl(monthlyCents / 100 - agency.aiCostMonthUsd * fx)} sobre a IA do mês` : "sem tamanho assinado"} />
        <Kpi label="Chatbots" value={`${agency.liveBots}/${agency.bots}`} sub={`publicados · WhatsApp ${agency.whatsapp} · Instagram ${agency.instagram}`} />
      </section>

      <BillingCard
        agencyId={id}
        status={(billing?.billing_status as string | undefined) ?? "none"}
        cancelAt={(billing?.billing_cancel_at as string | null | undefined) ?? null}
        subscriptionId={(billing?.stripe_subscription_id as string | null | undefined) ?? null}
        testMode={testMode}
        monthlyCents={monthlyCents}
        packs={target.packs}
        creditCents={credit}
        autoRecharge={Boolean(billing?.credit_auto_enabled)}
      />
      <FreeAccountCard
        agencyId={id}
        view={{
          billingStatus: (billing?.billing_status as string | undefined) ?? "none",
          testAnswersUsed: Number(billing?.test_answers_used ?? 0),
          freeUsedAt: (billing?.free_used_at as string | null | undefined) ?? null,
          blockedAt: (billing?.free_blocked_at as string | null | undefined) ?? null,
          blockReason: (billing?.free_block_reason as string | null | undefined) ?? null,
          releasedAt: (billing?.free_released_at as string | null | undefined) ?? null,
        }}
        links={freeLinks}
        names={agencyName}
      />
      <DisputesAdminCard agencyId={id} rows={disputes} />
      <WithdrawalAdminCard
        agencyId={id}
        state={withdrawal}
        marked={Boolean(marked)}
        subscribed={billingStatus !== "none"}
        rows={(withdrawalRows ?? []).map((w) => ({ createdAt: w.created_at as string, via: w.via as string, actor: w.actor as string, refundedCents: Number(w.refunded_cents), status: w.status as string, error: (w.error as string | null) ?? null }))}
      />
      <AgencyActions agency={agency} />
      <AgencyFeatures agencyId={id} features={agency.features} />
      <ChannelSuspension agencyId={id} bots={(bots ?? []).filter((b) => !b.is_demo).map((b) => ({ id: b.id as string, label: `${b.name} · ${b.client_name}` }))} measures={measures} />
      <ContinuousChecks {...continuous} testAllowed={false} agencyView />
      <ClientTransferForm
        agencyId={id}
        clients={(clientRows ?? []).map((c) => ({ id: c.id as string, name: c.name as string }))}
        transfers={(transferRows ?? []).map((t) => ({ id: Number(t.id), client_name: t.client_name as string, from: agencyName.get(t.from_agency_id as string) ?? "conta excluída", to: agencyName.get(t.to_agency_id as string) ?? "conta excluída", requested_by: t.requested_by as string, done_by: t.done_by as string, created_at: t.created_at as string }))}
      />

      <section className="card overflow-x-auto">
        <h2 className="px-5 pt-4 text-lg font-bold">Chatbots</h2>
        <table className="mt-2 w-full min-w-[880px] text-sm">
          <thead className="border-b border-line text-left text-xs text-muted">
            <tr><th className="px-5 py-2 font-semibold">Chatbot · cliente da agência</th><th className="px-3 py-2 font-semibold">Situação</th><th className="px-3 py-2 font-semibold">Tamanho e cota</th><th className="px-3 py-2 font-semibold">WhatsApp</th><th className="px-3 py-2 font-semibold">Instagram</th><th className="px-3 py-2 text-right font-semibold">Trechos da base</th><th className="px-5 py-2 text-right font-semibold">Conversas (30 dias)</th></tr>
          </thead>
          <tbody>
            {(bots ?? []).map((b) => {
              const w = waBy.get(b.id as string);
              const i = igBy.get(b.id as string);
              return (
                <tr key={b.id as string} className="border-b border-line-2 last:border-0">
                  <td className="px-5 py-2.5"><span className="font-semibold">{b.name as string}</span><div className="text-xs text-muted">{b.client_name as string}{b.is_demo ? " · demo" : ""}</div></td>
                  <td className="px-3 py-2.5">{BOT_STATUS[b.status as string] ?? (b.status as string)}{b.paused_at && <span className="text-danger"> · IA pausada pelo dono</span>}</td>
                  <td className="px-3 py-2.5">{(() => {
                    const q = quotaBy.get(b.id as string);
                    return q ? <BotSizeForm agencyId={id} botId={q.botId} size={q.size} volumePacks={q.volumePacks} override={q.override} used={q.used} quota={q.quota} overageEnabled={q.overageEnabled} overageCapBrl={q.overageCapBrl} overageUsed={q.overageUsed} /> : <span className="text-xs text-muted">demo</span>;
                  })()}</td>
                  <td className="px-3 py-2.5 text-xs">{w ? (w.disconnected_at ? <span className="text-danger">desconectado</span> : ((w.display_phone as string | null) ?? "conectado")) : <span className="text-muted">—</span>}</td>
                  <td className="px-3 py-2.5 text-xs">{i ? (i.disconnected_at ? <span className="text-danger">desconectado</span> : `@${(i.username as string | null) ?? "conectado"}`) : <span className="text-muted">—</span>}</td>
                  <td className="px-3 py-2.5 text-right tabular">{num(chunkCounts.get(b.id as string) ?? 0)}</td>
                  <td className="px-5 py-2.5 text-right tabular">{num(conv30.get(b.id as string) ?? 0)}</td>
                </tr>
              );
            })}
            {!bots?.length && <tr><td colSpan={7} className="px-5 py-5 text-center text-muted">Nenhum chatbot.</td></tr>}
          </tbody>
        </table>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card flex flex-col gap-3 p-5">
          <h2 className="text-lg font-bold">Uso e custo por mês</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="py-1.5 font-semibold">Mês</th><th className="py-1.5 text-right font-semibold">Atendimentos</th><th className="py-1.5 text-right font-semibold">Custo de IA</th></tr></thead>
            <tbody>
              {((usage ?? []) as Array<{ period: string; total: number }>).map((u) => {
                const m = months.get(u.period as string);
                return (
                  <tr key={u.period as string} className="border-t border-line-2">
                    <td className="py-2">{u.period as string}</td>
                    <td className="py-2 text-right tabular">{num(Number(u.total) || 0)}</td>
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

      <SupportConversations agencyId={id} bots={(bots ?? []).map((b) => ({ id: b.id as string, name: b.name as string, client_name: b.client_name as string }))} />
    </>
  );
}
