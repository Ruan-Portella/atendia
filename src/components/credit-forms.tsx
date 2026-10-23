"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { ActionForm } from "@/components/ui/action-form";
import { buyCredit } from "@/app/painel/(configuracoes)/cobranca/actions";
import { CREDIT_MIN_BRL, CREDIT_SHORTCUTS_BRL, PIX_MAX_BRL, brlCents } from "@/lib/plans";

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
 */
export function CreditBuyForm({ enabled }: { enabled: boolean }) {
  const [choice, setChoice] = useState<string>(String(CREDIT_SHORTCUTS_BRL[1]));
  const [other, setOther] = useState("");
  const value = choice === "outro" ? Number(other.replace(/\D/g, "")) || 0 : Number(choice);
  return (
    <ActionForm
      action={buyCredit}
      confirm={(submitter) => (submitter?.value === "pix" ? null : { title: `Cobrar ${brlCents(value)} agora?`, description: "No cartão da assinatura. O crédito vale 12 meses e não é reembolsável.", confirmLabel: "Cobrar no cartão" })}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-wrap gap-2">
        {CREDIT_SHORTCUTS_BRL.map((v) => (
          <label key={v} className={`card flex cursor-pointer items-center gap-2 px-3 py-2 text-sm ${choice === String(v) ? "border-brand" : ""}`}>
            <input type="radio" name="amount" value={String(v)} checked={choice === String(v)} onChange={() => setChoice(String(v))} />
            {brlCents(v)}
          </label>
        ))}
        <label className={`card flex cursor-pointer items-center gap-2 px-3 py-2 text-sm ${choice === "outro" ? "border-brand" : ""}`}>
          <input type="radio" name="amount" value="outro" checked={choice === "outro"} onChange={() => setChoice("outro")} />
          Outro: R$
          <input name="other" inputMode="numeric" value={other} onChange={(e) => (setOther(e.target.value), setChoice("outro"))} placeholder={String(CREDIT_MIN_BRL)} aria-label="Outro valor, em reais" className="input w-[96px] py-1 text-sm" />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <PayButton via="cartao" pendingLabel="Cobrando…" className="btn-primary" disabled={!enabled || value < CREDIT_MIN_BRL}>
          Comprar {value >= CREDIT_MIN_BRL ? brlCents(value) : "crédito"} no cartão
        </PayButton>
        <PayButton via="pix" pendingLabel="Abrindo o Pix…" className="btn-ghost" disabled={!enabled || value < CREDIT_MIN_BRL || value > PIX_MAX_BRL}>
          Pagar com Pix
        </PayButton>
      </div>
      {value > PIX_MAX_BRL && <p className="text-xs text-muted">Pelo Pix, até {brlCents(PIX_MAX_BRL)} por compra.</p>}
    </ActionForm>
  );
}

