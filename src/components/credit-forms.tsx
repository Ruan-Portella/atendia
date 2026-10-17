"use client";

import { useState } from "react";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { buyCredit, resolveSpike } from "@/app/painel/cobranca/actions";
import { CREDIT_MIN_BRL, CREDIT_SHORTCUTS_BRL, brlCents } from "@/lib/plans";

/** Compra de crédito: atalhos ou outro valor, com confirmação (cobra na hora, sem reembolso). */
export function CreditBuyForm({ enabled }: { enabled: boolean }) {
  const [choice, setChoice] = useState<string>(String(CREDIT_SHORTCUTS_BRL[1]));
  const [other, setOther] = useState("");
  const value = choice === "outro" ? Number(other.replace(/\D/g, "")) || 0 : Number(choice);
  return (
    <ActionForm
      action={buyCredit}
      onSubmit={(e) => {
        if (!window.confirm(`Cobrar ${brlCents(value)} agora no cartão da assinatura? O crédito vale 12 meses e não é reembolsável.`)) e.preventDefault();
      }}
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
      <div>
        <SubmitButton className="btn-primary" pendingLabel="Cobrando…" disabled={!enabled || value < CREDIT_MIN_BRL}>
          Comprar {value >= CREDIT_MIN_BRL ? brlCents(value) : "crédito"}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

/** Pico no chat do site: "tráfego real" devolve o excedente; "ataque" deixa suspenso até o mês virar. */
export function SpikeButtons({ botId, reason, until }: { botId: string; reason: "pico" | "ataque"; until: string }) {
  if (reason === "ataque") return <span className="block text-xs text-danger">Marcado como ataque: excedente suspenso até {until}.</span>;
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <span className="text-xs font-semibold text-danger">Pico no chat do site: excedente suspenso</span>
      <ActionForm action={resolveSpike.bind(null, botId, "real")}>
        <SubmitButton className="btn-ghost py-1 text-xs" pendingLabel="Salvando…">É tráfego real</SubmitButton>
      </ActionForm>
      <ActionForm action={resolveSpike.bind(null, botId, "ataque")}>
        <SubmitButton className="btn-ghost py-1 text-xs" pendingLabel="Salvando…">É ataque</SubmitButton>
      </ActionForm>
    </div>
  );
}
