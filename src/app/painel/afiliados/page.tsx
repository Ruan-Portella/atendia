import { Gift, Link2, Percent, Receipt } from "lucide-react";
import { requireAgency } from "@/lib/agency";
import { createClient } from "@/lib/supabase/server";
import { CopyButton } from "@/components/copy-button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { appUrl, relativeTime } from "@/lib/utils";
import { brl } from "@/lib/plans";
import { billingEnabled } from "@/lib/stripe";
import { creditSummary, MIN_REDEEM_CENTS, REFERRAL_RATE } from "@/lib/referral-credit";
import { redeemCredit } from "./actions";

export const metadata = { title: "Afiliados" };

const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

export default async function AfiliadosPage() {
  const { agency, plan } = await requireAgency();
  const supabase = await createClient();
  const [{ data: refs }, credit, { data: redemptions }] = await Promise.all([
    supabase.from("referrals").select("id, status, commission_cents, created_at").eq("referrer_id", agency.id).order("created_at", { ascending: false }),
    creditSummary(supabase, agency.id),
    supabase.from("credit_redemptions").select("id, amount_cents, created_at").eq("agency_id", agency.id).order("created_at", { ascending: false }).limit(20),
  ]);
  const link = appUrl(`/?ref=${agency.referral_code}`);
  const paying = (refs ?? []).filter((r) => r.status === "paying").length;
  const pct = Math.round(REFERRAL_RATE * 100);
  const canRedeem = credit.availableCents >= MIN_REDEEM_CENTS;
  const monthly = plan.priceBrl * 100;
  const monthsCovered = monthly > 0 ? credit.availableCents / monthly : 0;

  return (
    <div className="flex max-w-[760px] flex-col gap-5">
      <div>
        <h1 className="text-[28px] font-bold">Indique e ganhe {pct}% em crédito, para sempre</h1>
        <p className="text-sm text-muted">Toda agência que assinar pelo seu link gera {pct}% do que ela paga, todo mês, como crédito na sua assinatura. Sem esperar pagamento, sem PIX: você troca por desconto quando quiser.</p>
      </div>

      <div className="card flex flex-wrap items-center gap-3 p-5">
        <Link2 size={16} className="shrink-0 text-muted" />
        <code className="min-w-0 flex-1 truncate rounded-lg bg-ground px-3 py-2.5 text-sm">{link}</code>
        <CopyButton text={link} label="Copiar link" className="btn-dark" />
      </div>

      {/* crédito */}
      <div className="grid gap-3.5 md:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-3 rounded-xl bg-brand px-5 py-5 text-ground">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.06em] text-[#c7d9d1]"><Gift size={14} />Crédito disponível</div>
          <div className="display text-[38px] font-bold leading-none tabular">{money(credit.availableCents)}</div>
          <p className="text-[13px] text-[#c7d9d1]">
            {credit.availableCents === 0
              ? "Assim que uma indicação sua pagar a primeira fatura, o crédito aparece aqui."
              : monthly > 0
                ? `Dá para cobrir ${monthsCovered >= 1 ? `${Math.floor(monthsCovered)} ${Math.floor(monthsCovered) === 1 ? "mês" : "meses"}` : `${Math.round(monthsCovered * 100)}%`} do seu plano ${plan.name} (${brl(plan.priceBrl)}/mês).`
                : "Quando você assinar um plano, o crédito abate as primeiras faturas."}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <ConfirmAction
              action={redeemCredit}
              danger={false}
              title={`Converter ${money(credit.availableCents)} em desconto?`}
              description={
                <>
                  O valor entra como crédito na sua conta de cobrança e é abatido automaticamente da próxima fatura. Se sobrar, continua nas seguintes. Não dá para voltar a crédito de indicação depois.
                  {!agency.stripe_customer_id && " Você ainda não assinou: o crédito fica esperando e desconta da sua primeira fatura."}
                </>
              }
              confirmLabel="Converter em desconto"
              disabled={!canRedeem || !billingEnabled}
              className="btn bg-ground text-brand hover:bg-white"
            >
              <Percent size={15} />
              Usar como desconto na assinatura
            </ConfirmAction>
            {!canRedeem && credit.availableCents > 0 && <span className="text-xs text-[#c7d9d1]">mínimo {brl(MIN_REDEEM_CENTS / 100)}</span>}
            {!billingEnabled && <span className="text-xs text-[#c7d9d1]">cobrança ainda não configurada</span>}
          </div>
        </div>
        <div className="grid gap-3.5">
          <div className="card px-[18px] py-4"><div className="kpi-label">Indicações</div><div className="display text-[28px] font-bold leading-tight tabular">{refs?.length ?? 0}</div><div className="text-[13px] text-muted">{paying} pagando</div></div>
          <div className="card px-[18px] py-4"><div className="kpi-label">Gerado até hoje</div><div className="display text-[28px] font-bold leading-tight tabular">{money(credit.earnedCents)}</div><div className="text-[13px] text-muted">{money(credit.redeemedCents)} já virou desconto</div></div>
        </div>
      </div>

      {/* como funciona */}
      <div className="card grid gap-4 p-5 text-sm leading-relaxed text-ink-2 sm:grid-cols-3">
        <div><div className="mb-1 font-semibold text-ink">1. Compartilhe o link</div>Quem clicar fica marcado por 30 dias. Se criar conta nesse prazo, é sua indicação.</div>
        <div><div className="mb-1 font-semibold text-ink">2. Ela assina, você ganha</div>A cada fatura que ela pagar, {pct}% do valor vira crédito seu. Enquanto ela for cliente.</div>
        <div><div className="mb-1 font-semibold text-ink">3. Troque por desconto</div>Um clique lança o crédito na sua cobrança. Ele sai da próxima fatura automaticamente; com 3 ou 4 indicações, seu plano fica de graça.</div>
      </div>

      {/* indicações */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-line bg-ground px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.06em] text-muted"><span>Suas indicações</span><span>Gerado</span></div>
        {(refs ?? []).length === 0 && <p className="p-5 text-sm text-muted">Nenhuma indicação ainda. Compartilhe o link em grupos de agências, no seu Instagram ou com quem te pergunta “que ferramenta você usa”.</p>}
        {(refs ?? []).map((r) => (
          <div key={r.id} className="flex items-center gap-3 border-b border-line-2 px-4 py-3 text-sm last:border-0">
            <span className="text-muted">{relativeTime(r.created_at)}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${r.status === "paying" ? "bg-brand-soft text-brand" : r.status === "churned" ? "bg-ground text-muted" : "bg-amber-soft text-amber-ink"}`}>{r.status === "paying" ? "Assinante" : r.status === "churned" ? "Cancelou" : "Em teste"}</span>
            <span className="ml-auto tabular">{money(r.commission_cents)}</span>
          </div>
        ))}
      </div>

      {/* histórico */}
      {(redemptions ?? []).length > 0 && (
        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-line bg-ground px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.06em] text-muted"><Receipt size={13} />Descontos lançados</div>
          {(redemptions ?? []).map((d) => (
            <div key={d.id} className="flex items-center gap-3 border-b border-line-2 px-4 py-3 text-sm last:border-0">
              <span className="text-muted">{new Date(d.created_at).toLocaleDateString("pt-BR")}</span>
              <span>Crédito lançado na assinatura</span>
              <span className="ml-auto tabular text-brand">− {money(d.amount_cents)}</span>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-muted">O crédito é um saldo na sua conta de cobrança (Stripe). Ele não aparece na tela de pagamento, só na fatura, já descontado. Se cancelar a assinatura, o saldo fica guardado para quando voltar.</p>
    </div>
  );
}
