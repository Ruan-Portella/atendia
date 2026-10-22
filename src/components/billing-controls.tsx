"use client";

import { useState } from "react";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { changeBotSize, changePack } from "@/app/painel/(configuracoes)/cobranca/actions";
import { choiceLabel, nextChoice, planSizeChange, type SizeChoice } from "@/lib/billing";
import { BOT_SIZES, brlCents, num, sizeOption, type BotSize, type PackId } from "@/lib/plans";

interface SizeProps {
  botId: string;
  botName: string;
  current: SizeChoice;
  pendingSize: BotSize | "none" | null;
  pendingVolumePacks: number | null;
  /** Cota do mês que o chatbot já tem. */
  monthQuota: number;
  renewal: string;
}

/**
 * Troca de tamanho de um chatbot assinado, com a prévia: subir cobra agora a diferença
 * proporcional (pede confirmação) e a cota do mês sobe junto; descer vale no dia 1º.
 */
export function SizeChangeForm({ botId, botName, current, pendingSize, pendingVolumePacks, monthQuota, renewal }: SizeProps) {
  const scheduled = nextChoice({ ...current, pendingSize, pendingVolumePacks });
  const [size, setSize] = useState<BotSize | "">(scheduled.size ?? "");
  const [packs, setPacks] = useState<number>(scheduled.volumePacks ?? current.volumePacks ?? 1);
  const next: SizeChoice = { size: size || null, volumePacks: size === "volume" ? packs : null };
  const plan = planSizeChange({ ...current, monthQuota, pendingSize, pendingVolumePacks }, next);
  const hint =
    plan.kind === "upgrade"
      ? `Cobra ${brlCents(plan.amountCents / 100)} agora (proporcional até ${renewal}); a cota do mês vai para ${num(plan.monthQuota)}.`
      : plan.kind === "downgrade"
        ? `Vale em ${renewal}. Até lá, segue ${choiceLabel(current)}.`
        : plan.kind === "cancel_pending"
          ? "Cancela a troca agendada."
          : plan.kind === "already_scheduled"
            ? `Agendado para ${renewal}.`
            : null;
  const confirmCharge = () =>
    plan.kind === "upgrade" && plan.amountCents > 0
      ? { title: `Cobrar ${brlCents(plan.amountCents / 100)} agora?`, description: `No cartão da assinatura, para ${botName} ficar ${choiceLabel(next)}. A cota do mês vai para ${num(plan.monthQuota)}.`, confirmLabel: "Cobrar e trocar" }
      : null;

  return (
    <ActionForm action={changeBotSize.bind(null, botId)} confirm={confirmCharge} className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <select name={`size:${botId}`} value={size} onChange={(e) => setSize(e.target.value as BotSize | "")} aria-label={`Tamanho de ${botName}`} className="input w-auto py-1 text-sm">
          <option value="">sem tamanho</option>
          {Object.values(BOT_SIZES).map((s) => (
            <option key={s.id} value={s.id}>
              {sizeOption(s, false)}
            </option>
          ))}
        </select>
        {size === "volume" && (
          <input name={`packs:${botId}`} type="number" min={1} max={1000} value={packs} onChange={(e) => setPacks(Math.max(1, Number(e.target.value) || 1))} aria-label="Pacotes do Volume" className="input w-[72px] py-1 text-sm" />
        )}
        <SubmitButton className="btn-ghost py-1 text-sm" pendingLabel="Trocando…" disabled={plan.kind === "same" || plan.kind === "already_scheduled"}>
          Trocar
        </SubmitButton>
      </div>
      {hint && <span className="max-w-[340px] text-xs text-muted">{hint}</span>}
    </ActionForm>
  );
}

interface PackProps {
  pack: PackId;
  name: string;
  state: "off" | "on" | "ending";
  /** Cobrança de agora para assinar (proporcional ao resto do mês), em centavos. */
  chargeCents: number;
  /** Precisa de outro pacote ativo antes. */
  blockedBy: string | null;
  renewal: string;
}

/** Assinar um pacote (cobra o proporcional, com confirmação), tirar no dia 1º ou manter. */
export function PackButton({ pack, name, state, chargeCents, blockedBy, renewal }: PackProps) {
  if (state === "off") {
    return (
      <ActionForm
        action={changePack.bind(null, pack, true)}
        confirm={() => ({ title: `Assinar o ${name}?`, description: `Cobra ${brlCents(chargeCents / 100)} agora no cartão da assinatura, proporcional até ${renewal}.`, confirmLabel: "Assinar e cobrar" })}
      >
        <SubmitButton className="btn-ghost mt-2 py-1 text-sm" pendingLabel="Assinando…" disabled={Boolean(blockedBy)}>
          Assinar · {brlCents(chargeCents / 100)} agora
        </SubmitButton>
        {blockedBy && <span className="mt-1 block text-xs text-muted">Precisa do {blockedBy} ativo.</span>}
      </ActionForm>
    );
  }
  if (state === "ending") {
    return (
      <ActionForm action={changePack.bind(null, pack, true)}>
        <span className="mt-2 block text-xs text-amber-ink">Sai em {renewal}.</span>
        <SubmitButton className="btn-ghost mt-1 py-1 text-sm" pendingLabel="Salvando…">Manter</SubmitButton>
      </ActionForm>
    );
  }
  return (
    <ActionForm action={changePack.bind(null, pack, false)}>
      <span className="mt-2 block text-xs font-semibold text-brand">Ativo</span>
      <SubmitButton className="btn-ghost mt-1 py-1 text-sm" pendingLabel="Salvando…">Tirar em {renewal}</SubmitButton>
    </ActionForm>
  );
}
