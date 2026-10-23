import Link from "next/link";
import { ChevronDown, Receipt } from "lucide-react";
import { requirePermission } from "@/lib/agency";
import { PACKS, brlCents, isPackId, num } from "@/lib/plans";
import { billingEnabled } from "@/lib/stripe";
import { choiceLabel, nextChoice, packChargeCents, remainingFraction, renewalLabel, sizeMonthlyCents } from "@/lib/billing";
import { sizeLabel } from "@/lib/atendimentos";
import { SubscribeForm } from "@/components/subscribe-form";
import { PackCard, SizeChangeButton } from "@/components/billing-controls";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { HowItWorks, StatusPill } from "@/components/ui/form-section";
import { FlashToast } from "@/components/ui/flash-toast";
import { openBillingPortal, reactivateSubscription, withdrawSubscription } from "./actions";
import { WithdrawalCard } from "@/components/withdrawal-card";
import { firstWeekUntil, withdrawalState } from "@/lib/withdrawal";
import { FirstWeekNote } from "@/components/first-week-note";
import { createAdminClient } from "@/lib/supabase/admin";
import { billingView, unpaidInvoices } from "@/lib/billing-view";
import { dateBR } from "@/lib/retention";
import { cn } from "@/lib/utils";

export const metadata = { title: "Cobrança" };

const INVOICE_TONE = { "em aberto": "danger", paga: "ok", rascunho: "muted", anulada: "muted", "não cobrável": "muted" } as const;

/**
 * Cobrança → Assinatura (revisão de preços, parte 4a): sem assinatura, escolhe o tamanho de cada
 * chatbot e os pacotes e paga no Checkout da Stripe; com assinatura, troca o tamanho de cada
 * chatbot (subir cobra o proporcional agora, descer vale no dia 1º), assina ou tira pacotes e abre
 * o portal (cartão e cancelar). Parte 4d: a prévia exata da próxima fatura (Stripe), as faturas em
 * aberto para pagar, o cancelamento agendado com "reativar" e as faturas recentes. Redesenho, etapa
 * 5: a situação num cartão no alto, os chatbots em linhas com o trocar num modal, os pacotes em
 * cartões e as faturas com a pílula.
 */
export default async function CobrancaPage({ searchParams }: PageProps<"/painel/cobranca">) {
  const sp = await searchParams;
  const { agency, bots } = await requirePermission("billing");
  const { data: packRows } = await createAdminClient().from("agency_packs").select("pack, ends_at").eq("agency_id", agency.id);
  const packs = (packRows ?? []).filter((p) => isPackId(p.pack)).map((p) => ({ id: p.pack as keyof typeof PACKS, endsAt: (p.ends_at as string | null) ?? null }));
  const subscribed = agency.billing_status !== "none";
  const renewal = renewalLabel();
  const billable = bots.filter((b) => b.override === null);
  const custom = bots.filter((b) => b.override !== null);
  const monthlyCents = billable.reduce((t, b) => t + sizeMonthlyCents(nextChoice(b)), 0) + packs.filter((p) => !p.endsAt).reduce((t, p) => t + PACKS[p.id].priceBrl * 100, 0);
  const view = await billingView(agency);
  const open = view.invoices.filter((i) => i.status === "em aberto");
  // sem assinatura: a da assinatura anterior que ficou sem pagamento vem antes de assinar de novo
  const unpaid = subscribed ? [] : await unpaidInvoices(agency.stripe_customer_id);
  // desistência nos 7 dias do primeiro pagamento (Trava da conta grátis, parte 2)
  const withdrawal = await withdrawalState(createAdminClient(), agency);
  const pastDue = agency.billing_status === "past_due";
  const status = pastDue ? { tone: "danger" as const, label: "Pagamento falhou" } : agency.billing_cancel_at ? { tone: "warn" as const, label: `Termina em ${dateBR(agency.billing_cancel_at)}` } : { tone: "ok" as const, label: "Ativa" };

  return (
    <div className="flex max-w-[960px] flex-col gap-6">
      {sp.ok && <FlashToast message={subscribed ? "Assinatura ativada. Obrigado!" : "Pagamento recebido. Estamos confirmando com a Stripe: recarregue a página em alguns segundos."} />}
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-normal sm:text-[28px]">Assinatura e pacotes</h1>
        <p className="text-sm text-muted">O tamanho de cada chatbot e os pacotes da conta. A fatura fecha todo dia 1º; canais (WhatsApp, Instagram e chat do site) não são cobrados.</p>
        <HowItWorks label="Como funciona a cobrança">
          <p>Subir um tamanho ou assinar um pacote vale na hora: cobramos agora a diferença proporcional ao resto do mês, e a cota do mês sobe na mesma proporção. Descer, tirar o tamanho ou tirar um pacote vale no dia 1º (o mês já foi pago).</p>
          <p>
            Chatbot novo começa sem tamanho. O Atendimento não tem IA nenhuma: é a caixa de entrada da sua equipe. O excedente (opcional) é pago com o{" "}
            <Link href="/painel/cobranca/credito" className="font-medium text-brand hover:underline">
              crédito
            </Link>
            , fora da assinatura. O primeiro mês é proporcional, e a cota do primeiro mês também.
          </p>
        </HowItWorks>
        {!billingEnabled && <p className="text-xs text-amber-ink">Cobrança ainda não configurada neste servidor (STRIPE_SECRET_KEY).</p>}
      </div>

      {!subscribed ? (
        <>
          {unpaid.map((i) => (
            <div key={i.id} className="card flex flex-wrap items-center gap-3 px-4 py-3.5">
              <span className="min-w-0 flex-1 text-sm text-danger">
                A assinatura anterior terminou com a fatura de <strong className="tabular">{brlCents(i.totalCents / 100)}</strong> sem pagamento ({i.description}). Para assinar de novo, pague primeiro.
              </span>
              {i.url && (
                <a href={i.url} target="_blank" rel="noreferrer" className="btn-primary py-1.5 text-xs">
                  Pagar na Stripe
                </a>
              )}
            </div>
          ))}
          {withdrawal.kind === "done" && <WithdrawalCard state={withdrawal} action={withdrawSubscription} />}
          <SubscribeForm bots={billable.map((b) => ({ id: b.botId, name: b.name, clientName: b.clientName, size: b.size, volumePacks: b.volumePacks }))} fraction={remainingFraction()} renewal={renewal} enabled={billingEnabled && unpaid.length === 0} />
        </>
      ) : (
        <>
          <section className="card flex flex-col gap-4 p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="kpi-label">Sua assinatura</span>
                  <StatusPill tone={status.tone}>{status.label}</StatusPill>
                </span>
                {agency.billing_cancel_at ? (
                  <p className="mt-2 text-sm text-ink-2">Sem próxima fatura: a assinatura termina no dia 1º.</p>
                ) : (
                  <>
                    <p className="mt-2 text-sm text-muted">Próxima fatura em {renewal}</p>
                    <p className="text-[28px] font-normal leading-tight tabular text-ink">{brlCents((view.next?.totalCents ?? monthlyCents) / 100)}</p>
                    {view.next && view.next.lines.length > 0 && (
                      <details className="group/next mt-1">
                        <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[13px] font-medium text-brand hover:underline [&::-webkit-details-marker]:hidden">
                          O que entra nela
                          <ChevronDown size={14} className="transition-transform duration-[220ms] group-open/next:rotate-180" />
                        </summary>
                        <ul className="mt-2 flex flex-col divide-y divide-line-2 rounded-[12px] border border-line text-[13px]">
                          {view.next.lines.map((l, n) => (
                            <li key={n} className="flex justify-between gap-4 px-3 py-1.5">
                              <span className="text-ink-2">{l.description}</span>
                              <span className="tabular text-ink">{brlCents(l.amountCents / 100)}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {agency.billing_cancel_at && (
                  <ActionForm action={reactivateSubscription}>
                    <SubmitButton className="btn-primary" pendingLabel="Reativando…">
                      Reativar
                    </SubmitButton>
                  </ActionForm>
                )}
                <ActionForm action={openBillingPortal}>
                  <SubmitButton className="btn-ghost" pendingLabel="Abrindo…" disabled={!billingEnabled}>
                    Cartão e cancelamento
                  </SubmitButton>
                </ActionForm>
              </div>
            </div>
            {pastDue && (
              <p className="rounded-[12px] bg-danger-soft px-3 py-2 text-sm text-danger">
                O último pagamento falhou: a IA está pausada em todos os chatbots até a fatura ser paga, e a equipe segue respondendo nas conversas. O crédito comprado fica guardado, e a recarga automática parou. Pague a fatura abaixo ou atualize o cartão em
                &ldquo;Cartão e cancelamento&rdquo;. Sem pagamento em 2 semanas, a assinatura é cancelada, os chatbots ficam sem tamanho e o WhatsApp e o Instagram desconectam (a configuração fica guardada).
              </p>
            )}
            {agency.billing_cancel_at && (
              <p className="rounded-[12px] bg-amber-soft px-3 py-2 text-sm text-amber-ink">
                A assinatura foi cancelada e termina em {dateBR(agency.billing_cancel_at)}. Nesse dia, os chatbots ficam sem tamanho, o WhatsApp e o Instagram desconectam (a configuração fica guardada) e os pacotes saem. O crédito fica guardado até vencer.
              </p>
            )}
            {open.map((i) => (
              <div key={i.id} className="flex flex-wrap items-center gap-3 rounded-[12px] border border-danger-line px-3 py-2">
                <span className="min-w-0 flex-1 text-sm text-danger">
                  Fatura em aberto de <strong className="tabular">{brlCents(i.totalCents / 100)}</strong> ({i.description})
                </span>
                {i.url && (
                  <a href={i.url} target="_blank" rel="noreferrer" className="btn-primary py-1.5 text-xs">
                    Pagar na Stripe
                  </a>
                )}
              </div>
            ))}
          </section>
          <div className="flex flex-col gap-3 [&>p]:mt-0">
            <FirstWeekNote until={firstWeekUntil(agency)} />
            <WithdrawalCard state={withdrawal} action={withdrawSubscription} />
          </div>

          <section className="flex flex-col gap-2">
            <h2 className="kpi-label px-1">Tamanho de cada chatbot</h2>
            <div className="card flex flex-col divide-y divide-line-2 overflow-hidden">
              {billable.map((b) => (
                <div key={b.botId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Link href={`/painel/bots/${b.botId}`} className="truncate text-[15px] font-medium text-ink hover:underline">
                        {b.name}
                      </Link>
                      <StatusPill tone={b.size ? "ok" : "muted"}>{sizeLabel(b)}</StatusPill>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted">
                      {[b.clientName, b.size ? `${brlCents(sizeMonthlyCents(b) / 100)}/mês` : null, b.size === "atendimento" ? "sem IA" : b.size ? `cota do mês: ${num(b.quota)}` : "fora do ar"].filter(Boolean).join(" · ")}
                    </span>
                    {b.pendingSize && (
                      <span className="mt-0.5 block text-xs text-amber-ink">
                        {choiceLabel(nextChoice(b))} a partir de {renewal}
                      </span>
                    )}
                  </span>
                  <SizeChangeButton botId={b.botId} botName={b.name} current={{ size: b.size, volumePacks: b.volumePacks }} pendingSize={b.pendingSize} pendingVolumePacks={b.pendingVolumePacks} monthQuota={b.quota} renewal={renewal} />
                </div>
              ))}
              {custom.map((b) => (
                <div key={b.botId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="truncate text-[15px] font-medium text-ink">{b.name}</span>
                      <StatusPill>sob medida</StatusPill>
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">Cota do mês: {num(b.quota)} · combinado com a BoaVoz</span>
                  </span>
                </div>
              ))}
              {billable.length + custom.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted">Nenhum chatbot ainda.</p>}
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="kpi-label px-1">Pacotes da conta</h2>
            <ul className="grid gap-3 sm:grid-cols-3">
              {Object.values(PACKS).map((p) => {
                const on = packs.find((x) => x.id === p.id);
                const need = p.requires ? packs.find((x) => x.id === p.requires && !x.endsAt) : true;
                return <PackCard key={p.id} pack={p.id} name={p.name} priceBrl={p.priceBrl} description={p.description} state={on ? (on.endsAt ? "ending" : "on") : "off"} chargeCents={packChargeCents(p.id)} blockedBy={need ? null : PACKS[p.requires!].name} renewal={renewal} />;
              })}
            </ul>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="kpi-label px-1">Faturas</h2>
            {view.invoices.length === 0 ? (
              <p className="card flex items-center justify-center gap-2 px-5 py-8 text-sm text-muted">
                <Receipt size={16} /> Nenhuma fatura ainda.
              </p>
            ) : (
              <div className="card flex flex-col divide-y divide-line-2 overflow-hidden">
                {view.invoices.map((i) => (
                  <div key={i.id} className={cn("flex flex-wrap items-center gap-3 px-4 py-3", i.status === "em aberto" && "bg-danger-soft/30")}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink">{i.description}</span>
                      <span className="block text-xs text-muted">{dateBR(i.created)}</span>
                    </span>
                    <span className="tabular text-sm text-ink">{brlCents(i.totalCents / 100)}</span>
                    <StatusPill tone={INVOICE_TONE[i.status]}>{i.status}</StatusPill>
                    <span className="flex w-[104px] justify-end gap-3 text-xs">
                      {i.url && (
                        <a href={i.url} target="_blank" rel="noreferrer" className={cn("font-medium hover:underline", i.status === "em aberto" ? "text-danger" : "text-brand")}>
                          {i.status === "em aberto" ? "Pagar" : "Ver"}
                        </a>
                      )}
                      {i.pdf && (
                        <a href={i.pdf} target="_blank" rel="noreferrer" className="font-medium text-brand hover:underline">
                          PDF
                        </a>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
