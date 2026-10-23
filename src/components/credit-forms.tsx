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
