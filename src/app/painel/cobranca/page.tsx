import Link from "next/link";
import { requirePermission } from "@/lib/agency";
import { PACKS, brlCents, isPackId, num } from "@/lib/plans";
import { billingEnabled } from "@/lib/stripe";
import { choiceLabel, nextChoice, packChargeCents, remainingFraction, renewalLabel, sizeMonthlyCents } from "@/lib/billing";
import { sizeLabel } from "@/lib/atendimentos";
import { BillingTabs } from "@/components/billing-tabs";
import { SubscribeForm } from "@/components/subscribe-form";
import { PackButton, SizeChangeForm } from "@/components/billing-controls";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { openBillingPortal } from "./actions";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Cobrança" };

/**
 * Cobrança → Assinatura (revisão de preços, parte 4a): sem assinatura, escolhe o tamanho de cada
 * chatbot e os pacotes e paga no Checkout da Stripe; com assinatura, troca o tamanho de cada
 * chatbot (subir cobra o proporcional agora, descer vale no dia 1º), assina ou tira pacotes e abre
 * o portal (cartão, faturas e cancelar).
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
  const monthlyCents =
    billable.reduce((t, b) => t + sizeMonthlyCents(nextChoice(b)), 0) +
    packs.filter((p) => !p.endsAt).reduce((t, p) => t + PACKS[p.id].priceBrl * 100, 0);

  return (
    <div className="max-w-[960px]">
      <h1 className="text-2xl font-bold sm:text-[28px]">Cobrança</h1>
      <BillingTabs active="/painel/cobranca" />

      {sp.ok && !subscribed && <p className="mt-4 rounded-lg bg-brand-soft px-3 py-2 text-sm text-brand">Pagamento recebido. Estamos confirmando com a Stripe: recarregue a página em alguns segundos.</p>}
      {sp.ok && subscribed && <p className="mt-4 rounded-lg bg-brand-soft px-3 py-2 text-sm text-brand">Assinatura ativada. Obrigado!</p>}
      {!billingEnabled && <p className="mt-4 rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink">Cobrança ainda não configurada neste servidor (STRIPE_SECRET_KEY).</p>}
      {agency.billing_status === "past_due" && (
        <p className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          O último pagamento falhou: o excedente está suspenso até a fatura ser paga. Atualize o cartão em Pagamento e faturas. Sem pagamento em 2 semanas, a assinatura é cancelada e os chatbots ficam sem tamanho (a configuração fica guardada).
        </p>
      )}

      {!subscribed ? (
        <>
          <p className="mt-5 text-sm text-muted">
            Escolha o tamanho de cada chatbot e os pacotes da conta. A fatura fecha todo dia 1º; o primeiro mês é proporcional, e a cota do primeiro mês também. Canais (WhatsApp, Instagram e chat do site) não são cobrados.
          </p>
          <SubscribeForm bots={billable.map((b) => ({ id: b.botId, name: b.name, clientName: b.clientName, size: b.size, volumePacks: b.volumePacks }))} fraction={remainingFraction()} renewal={renewal} enabled={billingEnabled} />
        </>
      ) : (
        <>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">
              Próxima fatura em <strong className="text-ink">{renewal}</strong>: <strong className="text-ink tabular">{brlCents(monthlyCents / 100)}</strong> mais o excedente do mês, por uso.
            </p>
            <ActionForm action={openBillingPortal}>
              <SubmitButton className="btn-ghost" pendingLabel="Abrindo…" disabled={!billingEnabled}>Pagamento e faturas</SubmitButton>
            </ActionForm>
          </div>

          <div className="card mt-4 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-line-2 text-left text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                  <th className="px-4 py-2 font-semibold">Chatbot</th>
                  <th className="px-3 py-2 font-semibold">Agora</th>
                  <th className="px-3 py-2 text-right font-semibold">Cota do mês</th>
                  <th className="px-4 py-2 font-semibold">Trocar o tamanho</th>
                </tr>
              </thead>
              <tbody>
                {billable.map((b) => (
                  <tr key={b.botId} className="border-b border-line-2 last:border-0">
                    <td className="px-4 py-2">
                      <Link href={`/painel/bots/${b.botId}`} className="hover:underline">{b.name}</Link>
                      {b.clientName && <span className="block text-xs text-muted">{b.clientName}</span>}
                    </td>
                    <td className="px-3 py-2">
                      {sizeLabel(b)}
                      {b.size && <span className="block text-xs text-muted tabular">{brlCents(sizeMonthlyCents(b) / 100)}/mês</span>}
                      {b.pendingSize && <span className="block text-xs text-amber-ink">{choiceLabel(nextChoice(b))} a partir de {renewal}</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular">{num(b.quota)}</td>
                    <td className="px-4 py-2">
                      <SizeChangeForm botId={b.botId} botName={b.name} current={{ size: b.size, volumePacks: b.volumePacks }} pendingSize={b.pendingSize} pendingVolumePacks={b.pendingVolumePacks} monthQuota={b.quota} renewal={renewal} />
                    </td>
                  </tr>
                ))}
                {custom.map((b) => (
                  <tr key={b.botId} className="border-b border-line-2 last:border-0 text-muted">
                    <td className="px-4 py-2">{b.name}</td>
                    <td className="px-3 py-2">sob medida</td>
                    <td className="px-3 py-2 text-right tabular">{num(b.quota)}</td>
                    <td className="px-4 py-2">combinado com a BoaVoz</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="mt-8 text-lg font-bold">Pacotes da conta</h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-3">
            {Object.values(PACKS).map((p) => {
              const on = packs.find((x) => x.id === p.id);
              const need = p.requires ? packs.find((x) => x.id === p.requires && !x.endsAt) : true;
              return (
                <li key={p.id} className="card p-4 text-sm">
                  <span className="font-semibold">{p.name}</span> · {brlCents(p.priceBrl)}/mês
                  <span className="block text-muted">{p.description}</span>
                  <PackButton pack={p.id} name={p.name} state={on ? (on.endsAt ? "ending" : "on") : "off"} chargeCents={packChargeCents(p.id)} blockedBy={need ? null : PACKS[p.requires!].name} renewal={renewal} />
                </li>
              );
            })}
          </ul>
          <p className="mt-6 text-sm text-muted">
            Subir um tamanho ou assinar um pacote vale na hora: cobramos agora a diferença proporcional ao resto do mês, e a cota do mês sobe na mesma proporção. Descer, tirar o tamanho ou tirar um pacote vale no dia 1º (o mês já foi pago). Chatbot novo começa sem tamanho.
          </p>
        </>
      )}
    </div>
  );
}
