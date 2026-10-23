"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { ActionForm } from "@/components/ui/action-form";
import { buyCredit } from "@/app/painel/(configuracoes)/cobranca/actions";
import { CREDIT_MIN_BRL, CREDIT_SHORTCUTS_BRL, OVERAGE_PRICE_BRL, PIX_MAX_BRL, brlCents, num } from "@/lib/plans";
import { cn } from "@/lib/utils";

/** Botão de uma forma de pagamento: só ele mostra o "enviando" quando é o escolhido. */
function PayButton({ via, pendingLabel, className, disabled, children }: { via: "cartao" | "pix"; pendingLabel: string; className: string; disabled: boolean; children: React.ReactNode }) {
  const { pending, data } = useFormStatus();
  const mine = pending && data?.get("via") === via;
  return (
    <button type="submit" name="via" value={via} disabled={pending || disabled} aria-busy={mine} className={className}>
      {mine && <Loader2 size={15} className="animate-spin" />}
      {mine ? pendingLabel : children}
    </button>
  );
}

/**
 * Compra de crédito: atalhos ou outro valor. No cartão, com confirmação (cobra na hora, sem
 * reembolso); pelo Pix, abre a página de pagamento da Stripe (nada é cobrado antes do Pix).
 * Redesenho, etapa 5: dentro do modal "Comprar crédito", com os valores em cartões e quantos
 * atendimentos a mais cada um paga; o Cancelar fecha o modal.
 */
export function CreditBuyForm({ enabled }: { enabled: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const [choice, setChoice] = useState<string>(String(CREDIT_SHORTCUTS_BRL[1]));
  const [other, setOther] = useState("");
  const value = choice === "outro" ? Number(other.replace(/\D/g, "")) || 0 : Number(choice);
  const card = (on: boolean) => cn("flex cursor-pointer flex-col gap-0.5 rounded-[14px] border p-3 transition-colors duration-[120ms]", on ? "border-brand bg-brand-soft/60" : "border-line hover:border-line-strong");
  return (
    <div ref={root}>
      <ActionForm
        action={buyCredit}
        confirm={(submitter) => (submitter?.value === "pix" ? null : { title: `Cobrar ${brlCents(value)} agora?`, description: "No cartão da assinatura. O crédito vale 12 meses e não é reembolsável.", confirmLabel: "Cobrar no cartão" })}
        className="flex flex-col gap-4"
      >
        <div role="radiogroup" aria-label="Valor" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {CREDIT_SHORTCUTS_BRL.map((v) => (
            <label key={v} className={card(choice === String(v))}>
              <input type="radio" name="amount" value={String(v)} checked={choice === String(v)} onChange={() => setChoice(String(v))} className="sr-only" />
              <span className="tabular text-[15px] font-medium text-ink">{brlCents(v)}</span>
              <span className="text-xs text-muted">≈ {num(Math.floor(v / OVERAGE_PRICE_BRL))} a mais</span>
            </label>
          ))}
        </div>
        <label className={cn(card(choice === "outro"), "flex-row flex-wrap items-center gap-2")}>
          <input type="radio" name="amount" value="outro" checked={choice === "outro"} onChange={() => setChoice("outro")} className="sr-only" />
          <span className="text-sm font-medium text-ink">Outro valor</span>
          <span className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">R$</span>
            <input
              name="other"
              inputMode="numeric"
              value={other}
              onChange={(e) => {
                setOther(e.target.value);
                setChoice("outro");
              }}
              onFocus={() => setChoice("outro")}
              placeholder={String(CREDIT_MIN_BRL)}
              aria-label="Outro valor, em reais"
              className="input w-[120px] py-1.5 pl-9 text-sm"
            />
          </span>
          {choice === "outro" && value >= CREDIT_MIN_BRL && <span className="text-xs text-muted">≈ {num(Math.floor(value / OVERAGE_PRICE_BRL))} atendimentos a mais</span>}
        </label>
        <p className="text-xs text-muted">
          A partir de {brlCents(CREDIT_MIN_BRL)}. No cartão da assinatura, cobrado na hora; pelo Pix (até {brlCents(PIX_MAX_BRL)}), na página de pagamento da Stripe, com o QR e o copia e cola: o código vale 1 hora, e o crédito entra quando o banco confirma.
        </p>
        <div className="-mx-5 -mb-5 flex flex-wrap items-center justify-end gap-2 border-t border-line-2 px-5 py-3 sm:-mx-6 sm:px-6">
          <button type="button" onClick={() => root.current?.closest("dialog")?.dispatchEvent(new Event("bv-cancel"))} className="btn-ghost mr-auto">
            Cancelar
          </button>
          <PayButton via="pix" pendingLabel="Abrindo o Pix…" className="btn-ghost" disabled={!enabled || value < CREDIT_MIN_BRL || value > PIX_MAX_BRL}>
            Pagar com Pix
          </PayButton>
          <PayButton via="cartao" pendingLabel="Cobrando…" className="btn-primary" disabled={!enabled || value < CREDIT_MIN_BRL}>
            Comprar {value >= CREDIT_MIN_BRL ? brlCents(value) : "crédito"} no cartão
          </PayButton>
        </div>
      </ActionForm>
    </div>
  );
}

/** Reais digitados ("1.000", "50,00") em número inteiro; vazio ou inválido, 0. */
const toReais = (v: string) => {
  const n = Number(v.replace(/R\$|\s|\./g, "").replace(/,00$/, ""));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

/**
 * Os campos da recarga automática como uma regra que se lê (redesenho, etapa 5, a pedido do usuário
 * em 22/10: os três campos soltos ficavam estranhos): cada valor numa linha, com o rótulo à esquerda,
 * e o resumo em frase embaixo, que muda enquanto digita. Desligada, a regra fica apagada, mas os
 * valores continuam no formulário (para não se perderem ao salvar).
 */
export function AutoRechargeFields({ enabled, below, amount, limit }: { enabled: boolean; below: string; amount: string; limit: string }) {
  const [on, setOn] = useState(enabled);
  const [v, setV] = useState({ below, amount, limit });
  const n = { below: toReais(v.below), amount: toReais(v.amount), limit: toReais(v.limit) };
  const times = n.amount ? Math.floor(n.limit / n.amount) : 0;
  const row = (key: keyof typeof v, label: string, hint?: string) => (
    <label className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
      <span className="min-w-0">
        <span className="block text-sm text-ink">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
      <span className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">R$</span>
        <input name={key} inputMode="numeric" value={v[key]} onChange={(e) => setV({ ...v, [key]: e.target.value })} aria-label={label} className="input w-32 py-2 pl-9 text-right tabular" />
      </span>
    </label>
  );
  return (
    <div className="flex flex-col gap-4">
      <label className="flex items-center justify-between gap-4">
        <span className="min-w-0">
          <span className="block text-sm font-medium text-ink">Recarga automática</span>
          <span className="block text-xs text-muted">{on ? "Ligada: o saldo nunca fica a zero sem você ver." : "Desligada: quando o saldo acabar, os chatbots no excedente param."}</span>
        </span>
        <input type="checkbox" role="switch" name="auto" checked={on} onChange={(e) => setOn(e.target.checked)} className="switch" aria-label="Recarga automática ligada" />
      </label>
      <div className={cn("flex flex-col divide-y divide-line-2 rounded-[14px] border border-line transition-opacity duration-[120ms]", !on && "opacity-50")}>
        {row("below", "Quando o saldo ficar abaixo de")}
        {row("amount", "Recarregar com", `no cartão da assinatura · mínimo de ${brlCents(CREDIT_MIN_BRL)}`)}
        {row("limit", "No máximo, por mês", "a soma das recargas do mês")}
      </div>
      {on &&
        (n.amount && n.amount < CREDIT_MIN_BRL ? (
          <p className="rounded-[12px] bg-amber-soft px-3 py-2 text-sm text-amber-ink">A recarga precisa ser de pelo menos {brlCents(CREDIT_MIN_BRL)}.</p>
        ) : n.amount && n.limit < n.amount ? (
          <p className="rounded-[12px] bg-amber-soft px-3 py-2 text-sm text-amber-ink">O máximo do mês é menor que uma recarga: nenhuma recarga vai rodar.</p>
        ) : n.below && n.amount && n.limit ? (
          <p className="rounded-[12px] bg-raised px-3 py-2 text-sm text-ink-2">
            Quando o saldo cair abaixo de <strong className="tabular text-ink">{brlCents(n.below)}</strong>, compramos <strong className="tabular text-ink">{brlCents(n.amount)}</strong> no cartão da assinatura, até <strong className="tabular text-ink">{brlCents(n.limit)}</strong> por mês ({times === 1 ? "1 recarga" : `até ${times} recargas`}).
          </p>
        ) : null)}
    </div>
  );
}
