import Link from "next/link";
import { requirePermission } from "@/lib/agency";
import { FirstWeekNote } from "@/components/first-week-note";
import { firstWeekUntil } from "@/lib/withdrawal";
import { createAdminClient } from "@/lib/supabase/admin";
import { CREDIT_MIN_BRL, OVERAGE_PRICE_BRL, PIX_MAX_BRL, brlCents, num } from "@/lib/plans";
import { OVERAGE_PRICE_CENTS, creditBalance } from "@/lib/billing-credit";
import { monthBoundsBR } from "@/lib/billing";
import { billingEnabled } from "@/lib/stripe";
import { dateBR } from "@/lib/retention";
import { periodLabel } from "@/lib/report";
import { Kpi } from "@/components/kpi";
import { BillingTabs } from "@/components/billing-tabs";
import { CreditBuyForm } from "@/components/credit-forms";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { saveAutoRecharge } from "../actions";

export const metadata = { title: "Crédito do excedente" };

const SOURCE: Record<string, string> = { compra: "Compra", recarga: "Recarga automática", ajuste: "Ajuste da BoaVoz" };
const reais = (cents: number | null) => (cents === null ? "" : String(Math.round(cents / 100)));
const isExpired = (iso: string) => Date.parse(iso) <= Date.now();

/**
 * Cobrança → Crédito (revisão de preços, parte 4c): o saldo pré-pago que paga o excedente (R$ 0,35
 * por atendimento além da cota de um chatbot), a compra, a recarga automática, os lotes (12 meses,
 * o que vence antes sai primeiro) e o uso do mês por chatbot. Pelo Pix (Lançamento, parte 6), a
 * Stripe volta para cá com ?pix=ok, e o crédito entra quando ela confirma.
 */
export default async function CreditoPage({ searchParams }: PageProps<"/painel/cobranca/credito">) {
  const [{ agency, bots }, sp] = await Promise.all([requirePermission("billing"), searchParams]);
  const db = createAdminClient();
  const { period, start } = monthBoundsBR();
  const [balance, { data: lots }, { data: used }] = await Promise.all([
    creditBalance(db, agency.id),
    db.from("credit_lots").select("id, amount_cents, remaining_cents, source, created_at, expires_at").eq("agency_id", agency.id).order("created_at", { ascending: false }).limit(50),
    db.from("atendimentos").select("bot_id, credit_cents").eq("agency_id", agency.id).eq("overage", true).gte("started_at", start.toISOString()).limit(20_000),
  ]);
  const open = (lots ?? []).filter((l) => Number(l.remaining_cents) > 0 && !isExpired(l.expires_at as string)).sort((a, b) => String(a.expires_at).localeCompare(String(b.expires_at)));
  const byBot = new Map<string, { count: number; cents: number }>();
  for (const u of used ?? []) {
    const k = (u.bot_id as string | null) ?? "";
    const cur = byBot.get(k) ?? { count: 0, cents: 0 };
    byBot.set(k, { count: cur.count + 1, cents: cur.cents + (Number(u.credit_cents) || 0) });
  }
  const monthCents = [...byBot.values()].reduce((t, v) => t + v.cents, 0);
  const subscribed = agency.billing_status !== "none";
  const overageBots = bots.filter((b) => b.overageEnabled);

  return (
    <div className="max-w-[960px]">
      <h1 className="text-2xl font-bold sm:text-[28px]">Cobrança</h1>
      <BillingTabs active="/painel/cobranca/credito" />
      <FirstWeekNote until={firstWeekUntil(agency)} />

      <p className="mt-5 text-sm text-muted">
        O crédito paga o excedente: com o excedente ligado num chatbot, cada atendimento além da cota do mês usa {brlCents(OVERAGE_PRICE_BRL)} do saldo da conta, na hora. Sem saldo, os chatbots que dependem do excedente entram no modo só humano. O crédito vale 12 meses (o que vence antes é usado primeiro) e não é reembolsável.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Kpi label="Saldo" value={brlCents(balance / 100)} sub={`cerca de ${num(Math.floor(balance / OVERAGE_PRICE_CENTS))} atendimentos a mais`} />
        <Kpi label={`Usado em ${periodLabel(period)}`} value={brlCents(monthCents / 100)} sub={`${num([...byBot.values()].reduce((t, v) => t + v.count, 0))} atendimentos a mais`} />
        <Kpi label="Vence primeiro" value={open[0] ? brlCents(Number(open[0].remaining_cents) / 100) : "—"} sub={open[0] ? `em ${dateBR(open[0].expires_at as string)}` : "nenhum crédito ativo"} />
      </div>

      {sp.pix === "ok" && (
        <p className="mt-4 rounded-lg bg-brand-soft px-3 py-2 text-sm text-brand">
          Pix enviado. O crédito entra assim que a Stripe confirma o pagamento, em geral em segundos: se o saldo ainda não mudou, recarregue a página daqui a pouco. Também avisamos por e-mail.
        </p>
      )}
      {!subscribed && (
        <p className="mt-4 rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink">
          O crédito paga o excedente dos chatbots com tamanho. <Link href="/painel/cobranca" className="font-semibold underline">Assine um tamanho</Link> antes de comprar.
        </p>
      )}
      {subscribed && overageBots.length === 0 && (
        <p className="mt-4 rounded-lg bg-ground px-3 py-2 text-sm text-ink-2">
          Nenhum chatbot está com o excedente ligado: o crédito só é usado depois que você ligar o excedente em <Link href="/painel/cobranca/uso" className="font-semibold underline">Uso e custo</Link>.
        </p>
      )}

      <section className="card mt-6 p-5">
        <h2 className="text-lg font-bold">Comprar crédito</h2>
        <p className="mt-1 text-sm text-muted">A partir de {brlCents(CREDIT_MIN_BRL)}: no cartão da assinatura, cobrado na hora, ou pelo Pix (até {brlCents(PIX_MAX_BRL)}), na página de pagamento da Stripe, com o QR e o copia e cola. O código Pix vale 1 hora, e o crédito entra quando o banco confirma.</p>
        <div className="mt-3">
          <CreditBuyForm enabled={billingEnabled && subscribed} />
        </div>
      </section>

      <section className="card mt-4 p-5">
        <h2 className="text-lg font-bold">Recarga automática</h2>
        <p className="mt-1 text-sm text-muted">Quando o saldo cai abaixo do valor escolhido, compramos outra recarga no cartão da assinatura, até o limite do mês. Com o pagamento da assinatura atrasado, a recarga não roda.</p>
        <ActionForm action={saveAutoRecharge} className="mt-3 flex flex-wrap items-end gap-3 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="auto" defaultChecked={Boolean(agency.credit_auto_enabled)} />
            ligada
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Abaixo de (R$)</span>
            <input name="below" inputMode="numeric" defaultValue={reais(agency.credit_auto_below_cents) || "20"} className="input w-[96px] py-1" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Comprar (R$, mín. {CREDIT_MIN_BRL})</span>
            <input name="amount" inputMode="numeric" defaultValue={reais(agency.credit_auto_amount_cents) || "100"} className="input w-[96px] py-1" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Limite por mês (R$)</span>
            <input name="limit" inputMode="numeric" defaultValue={reais(agency.credit_auto_month_limit_cents) || "300"} className="input w-[110px] py-1" />
          </label>
          <SubmitButton className="btn-ghost" pendingLabel="Salvando…">Salvar</SubmitButton>
        </ActionForm>
      </section>

      <h2 className="mt-8 text-lg font-bold">Uso do mês por chatbot</h2>
      <div className="card mt-3 overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="border-b border-line-2 text-left text-xs font-semibold uppercase tracking-[0.06em] text-muted">
              <th className="px-4 py-2 font-semibold">Chatbot</th>
              <th className="px-3 py-2 text-right font-semibold">Atendimentos a mais</th>
              <th className="px-4 py-2 text-right font-semibold">Crédito usado</th>
            </tr>
          </thead>
          <tbody>
            {[...byBot].map(([id, v]) => (
              <tr key={id || "x"} className="border-b border-line-2 last:border-0">
                <td className="px-4 py-2">{bots.find((b) => b.botId === id)?.name ?? "Chatbot excluído"}</td>
                <td className="px-3 py-2 text-right tabular">{num(v.count)}</td>
                <td className="px-4 py-2 text-right tabular">{brlCents(v.cents / 100)}</td>
              </tr>
            ))}
            {byBot.size === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-4 text-center text-muted">Nenhum atendimento a mais neste mês.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 className="mt-8 text-lg font-bold">Compras e recargas</h2>
      <div className="card mt-3 overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-line-2 text-left text-xs font-semibold uppercase tracking-[0.06em] text-muted">
              <th className="px-4 py-2 font-semibold">Data</th>
              <th className="px-3 py-2 font-semibold">Origem</th>
              <th className="px-3 py-2 text-right font-semibold">Valor</th>
              <th className="px-3 py-2 text-right font-semibold">Resta</th>
              <th className="px-4 py-2 font-semibold">Vale até</th>
            </tr>
          </thead>
          <tbody>
            {(lots ?? []).map((l) => {
              const expired = isExpired(l.expires_at as string);
              return (
                <tr key={l.id as number} className={`border-b border-line-2 last:border-0 ${expired ? "text-muted" : ""}`}>
                  <td className="px-4 py-2">{dateBR(l.created_at as string)}</td>
                  <td className="px-3 py-2">{SOURCE[l.source as string] ?? (l.source as string)}</td>
                  <td className="px-3 py-2 text-right tabular">{brlCents(Number(l.amount_cents) / 100)}</td>
                  <td className="px-3 py-2 text-right tabular">{brlCents(Number(l.remaining_cents) / 100)}</td>
                  <td className="px-4 py-2">{expired ? `venceu em ${dateBR(l.expires_at as string)}` : dateBR(l.expires_at as string)}</td>
                </tr>
              );
            })}
            {!(lots ?? []).length && (
              <tr>
                <td colSpan={5} className="px-4 py-4 text-center text-muted">Nenhuma compra ainda.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
