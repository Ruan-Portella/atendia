import Link from "next/link";
import { RefreshCw, Wallet } from "lucide-react";
import { requirePermission } from "@/lib/agency";
import { FirstWeekNote } from "@/components/first-week-note";
import { firstWeekUntil } from "@/lib/withdrawal";
import { createAdminClient } from "@/lib/supabase/admin";
import { CREDIT_MIN_BRL, OVERAGE_PRICE_BRL, brlCents, num } from "@/lib/plans";
import { OVERAGE_PRICE_CENTS, creditBalance } from "@/lib/billing-credit";
import { monthBoundsBR } from "@/lib/billing";
import { billingEnabled } from "@/lib/stripe";
import { dateBR } from "@/lib/retention";
import { periodLabel } from "@/lib/report";
import { Kpi } from "@/components/kpi";
import { AutoRechargeFields, CreditBuyForm } from "@/components/credit-forms";
import { DialogButton, SettingGroup, SettingRow } from "@/components/ui/setting-row";
import { HowItWorks, StatusPill } from "@/components/ui/form-section";
import { FlashToast } from "@/components/ui/flash-toast";
import { cn } from "@/lib/utils";
import { saveAutoRecharge } from "../actions";

export const metadata = { title: "Crédito do excedente" };

const SOURCE: Record<string, string> = { compra: "Compra", recarga: "Recarga automática", ajuste: "Ajuste da BoaVoz" };
const reais = (cents: number | null) => (cents === null ? "" : String(Math.round(cents / 100)));
const isExpired = (iso: string) => Date.parse(iso) <= Date.now();
const TABS = [
  ["compras", "Compras e recargas"],
  ["uso", "Uso do mês"],
] as const;

/**
 * Cobrança → Crédito (revisão de preços, parte 4c): o saldo pré-pago que paga o excedente (R$ 0,35
 * por atendimento além da cota de um chatbot), a compra, a recarga automática, os lotes (12 meses,
 * o que vence antes sai primeiro) e o uso do mês por chatbot. Pelo Pix (Lançamento, parte 6), a
 * Stripe volta para cá com ?pix=ok, e o crédito entra quando ela confirma. Redesenho, etapa 5: a
 * compra num modal, a recarga automática numa linha com o modal, e as compras e o uso em abas.
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
  const tab = sp.aba === "uso" ? "uso" : "compras";
  const auto = agency.credit_auto_enabled ? { below: brlCents((agency.credit_auto_below_cents ?? 0) / 100), amount: brlCents((agency.credit_auto_amount_cents ?? 0) / 100), limit: brlCents((agency.credit_auto_month_limit_cents ?? 0) / 100) } : null;

  return (
    <div className="flex flex-col gap-6">
      {sp.pix === "ok" && <FlashToast message="Pix enviado. O crédito entra assim que a Stripe confirma, em geral em segundos; também avisamos por e-mail." />}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 className="text-2xl font-normal sm:text-[28px]">Crédito</h1>
          <p className="text-sm text-muted">O saldo que paga o excedente: cada atendimento além da cota de um chatbot com o excedente ligado usa {brlCents(OVERAGE_PRICE_BRL)}.</p>
          <HowItWorks label="Como funciona o crédito">
            <p>Com o excedente ligado num chatbot, cada atendimento além da cota do mês usa {brlCents(OVERAGE_PRICE_BRL)} do saldo da conta, na hora. Sem saldo, os chatbots que dependem do excedente entram no modo só humano.</p>
            <p>O crédito vale 12 meses (o que vence antes é usado primeiro) e não é reembolsável. A compra é a partir de {brlCents(CREDIT_MIN_BRL)}, no cartão da assinatura ou pelo Pix.</p>
          </HowItWorks>
        </div>
        <DialogButton label="Comprar crédito" icon={<Wallet size={15} />} className="btn-primary" title="Comprar crédito" description="O crédito vale 12 meses e não é reembolsável." footer="none" size="lg">
          <CreditBuyForm enabled={billingEnabled && subscribed} />
        </DialogButton>
      </div>
      <div className="[&>p]:mt-0 empty:hidden">
        <FirstWeekNote until={firstWeekUntil(agency)} />
      </div>

      {!subscribed && (
        <div className="card flex flex-wrap items-center gap-3 px-4 py-3.5">
          <span className="min-w-0 flex-1 text-sm text-amber-ink">O crédito paga o excedente dos chatbots com tamanho: assine um tamanho antes de comprar.</span>
          <Link href="/painel/cobranca" className="btn-primary py-1.5 text-xs">
            Assinar
          </Link>
        </div>
      )}
      {subscribed && overageBots.length === 0 && (
        <div className="card flex flex-wrap items-center gap-3 px-4 py-3.5">
          <span className="min-w-0 flex-1 text-sm text-ink-2">Nenhum chatbot está com o excedente ligado: o crédito só é usado depois que você ligar.</span>
          <Link href="/painel/cobranca/uso" className="btn-ghost py-1.5 text-xs">
            Ligar em Uso e custo
          </Link>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi label="Saldo" value={brlCents(balance / 100)} sub={`cerca de ${num(Math.floor(balance / OVERAGE_PRICE_CENTS))} atendimentos a mais`} />
        <Kpi label={`Usado em ${periodLabel(period)}`} value={brlCents(monthCents / 100)} sub={`${num([...byBot.values()].reduce((t, v) => t + v.count, 0))} atendimentos a mais`} />
        <Kpi label="Vence primeiro" value={open[0] ? brlCents(Number(open[0].remaining_cents) / 100) : "—"} sub={open[0] ? `em ${dateBR(open[0].expires_at as string)}` : "nenhum crédito ativo"} />
      </div>

      <SettingGroup>
        <SettingRow
          icon={<RefreshCw size={18} />}
          title="Recarga automática"
          badge={<StatusPill tone={auto ? "ok" : "muted"}>{auto ? "Ligada" : "Desligada"}</StatusPill>}
          summary={auto ? `Abaixo de ${auto.below}, compra ${auto.amount}, até ${auto.limit} por mês` : "Quando o saldo cai, compra outra recarga no cartão da assinatura"}
          description="Quando o saldo cai abaixo do valor escolhido, compramos outra recarga no cartão da assinatura, até o limite do mês. Com o pagamento da assinatura atrasado, a recarga não roda."
          action={saveAutoRecharge}
        >
          <AutoRechargeFields enabled={Boolean(agency.credit_auto_enabled)} below={reais(agency.credit_auto_below_cents) || "20"} amount={reais(agency.credit_auto_amount_cents) || "100"} limit={reais(agency.credit_auto_month_limit_cents) || "300"} />
        </SettingRow>
      </SettingGroup>

      <div className="flex flex-col gap-3">
        <nav aria-label="Crédito" className="-mx-1 flex overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
          <span className="flex shrink-0 gap-1 rounded-[14px] bg-panel p-1 shadow-[inset_0_0_0_1px_var(--color-line)]">
            {TABS.map(([key, label]) => (
              <Link
                key={key}
                href={`/painel/cobranca/credito?aba=${key}`}
                scroll={false}
                aria-current={tab === key ? "page" : undefined}
                className={cn("flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[10px] px-3.5 py-1.5 text-sm font-medium transition-colors duration-[120ms]", tab === key ? "bg-raised text-ink shadow-[inset_0_0_0_1px_var(--color-line)]" : "text-muted hover:text-ink")}
              >
                {label}
                <span className="tabular text-xs font-normal text-muted">{key === "compras" ? (lots ?? []).length || "" : byBot.size || ""}</span>
              </Link>
            ))}
          </span>
        </nav>

        {tab === "compras" ? (
          (lots ?? []).length === 0 ? (
            <p className="card px-5 py-8 text-center text-sm text-muted">Nenhuma compra ainda.</p>
          ) : (
            <ul className="card flex flex-col divide-y divide-line-2 overflow-hidden">
              {(lots ?? []).map((l) => {
                const expired = isExpired(l.expires_at as string);
                const left = Number(l.remaining_cents);
                return (
                  <li key={l.id as number} className={cn("flex flex-wrap items-center gap-3 px-4 py-3", expired && "opacity-60")}>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-sm font-medium text-ink">{SOURCE[l.source as string] ?? (l.source as string)}</span>
                        {expired ? <StatusPill>venceu</StatusPill> : left === 0 ? <StatusPill>usado</StatusPill> : null}
                      </span>
                      <span className="block text-xs text-muted">
                        {dateBR(l.created_at as string)} · {expired ? `venceu em ${dateBR(l.expires_at as string)}` : `vale até ${dateBR(l.expires_at as string)}`}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="block tabular text-sm text-ink">{brlCents(Number(l.amount_cents) / 100)}</span>
                      {!expired && left > 0 && <span className="block tabular text-xs text-muted">resta {brlCents(left / 100)}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          )
        ) : byBot.size === 0 ? (
          <p className="card px-5 py-8 text-center text-sm text-muted">Nenhum atendimento a mais neste mês.</p>
        ) : (
          <ul className="card flex flex-col divide-y divide-line-2 overflow-hidden">
            {[...byBot]
              .sort((a, b) => b[1].cents - a[1].cents)
              .map(([id, v]) => (
                <li key={id || "x"} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{bots.find((b) => b.botId === id)?.name ?? "Chatbot excluído"}</span>
                  <span className="tabular text-xs text-muted">{num(v.count)} a mais</span>
                  <span className="w-24 text-right tabular text-sm text-ink">{brlCents(v.cents / 100)}</span>
                </li>
              ))}
          </ul>
        )}
      </div>
    </div>
  );
}
