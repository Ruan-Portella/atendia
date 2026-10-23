"use client";

import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { Modal } from "@/components/ui/modal";
import { StatusPill } from "@/components/ui/form-section";
import { changeBotSize, changePack } from "@/app/painel/(configuracoes)/cobranca/actions";
import { choiceLabel, nextChoice, planSizeChange, type SizeChoice } from "@/lib/billing";
import { BOT_SIZES, brlCents, num, type BotSize, type PackId } from "@/lib/plans";
import { cn } from "@/lib/utils";

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
 * Os tamanhos em cartões (redesenho, etapa 5): o preço, a cota e para quem é; "Sem tamanho" por
 * último. `name` é o campo do formulário (size:<bot>).
 */
export function SizeCards({ name, value, onChange, volumePacks, onVolume, packsName }: { name: string; value: BotSize | ""; onChange: (v: BotSize | "") => void; volumePacks: number; onVolume: (n: number) => void; packsName: string }) {
  const options: Array<{ id: BotSize | ""; title: string; price: string; detail: string }> = [
    ...Object.values(BOT_SIZES).map((s) => ({
      id: s.id,
      title: s.name,
      price: s.id === "volume" ? `${brlCents(s.priceBrl)} por 1.000` : `${brlCents(s.priceBrl)}/mês`,
      detail: s.id === "volume" ? s.description : s.atendimentos ? `${num(s.atendimentos)} atendimentos · ${s.description}` : s.description,
    })),
    { id: "", title: "Sem tamanho", price: "—", detail: "fora do ar: todo chatbot no ar tem um tamanho" },
  ];
  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name={name} value={value} />
      <div role="radiogroup" aria-label="Tamanho" className="grid gap-2 sm:grid-cols-2">
        {options.map((o) => (
          <button
            key={o.id || "none"}
            type="button"
            role="radio"
            aria-checked={value === o.id}
            onClick={() => onChange(o.id)}
            className={cn("flex flex-col gap-0.5 rounded-[14px] border p-3 text-left transition-colors duration-[120ms]", value === o.id ? "border-brand bg-brand-soft/60" : "border-line hover:border-line-strong", o.id === "" && "sm:col-span-2")}
          >
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-ink">{o.title}</span>
              <span className="tabular text-xs font-medium text-ink-2">{o.price}</span>
            </span>
            <span className="text-xs leading-snug text-muted">{o.detail}</span>
          </button>
        ))}
      </div>
      {value === "volume" && (
        <div className="flex flex-wrap items-center gap-3 rounded-[12px] bg-raised px-3 py-2">
          <span className="text-sm text-ink-2">Pacotes de 1.000 atendimentos</span>
          <span className="flex items-center gap-1">
            <button type="button" aria-label="Menos um pacote" onClick={() => onVolume(Math.max(1, volumePacks - 1))} className="btn-icon h-8 w-8">
              <Minus size={14} />
            </button>
            <input name={packsName} type="number" min={1} max={1000} value={volumePacks} onChange={(e) => onVolume(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))} aria-label="Pacotes do Volume" className="input w-[72px] py-1 text-center text-sm" />
            <button type="button" aria-label="Mais um pacote" onClick={() => onVolume(Math.min(1000, volumePacks + 1))} className="btn-icon h-8 w-8">
              <Plus size={14} />
            </button>
          </span>
          <span className="tabular text-xs text-muted">
            {num(volumePacks * BOT_SIZES.volume.atendimentos)} atendimentos · {brlCents(volumePacks * BOT_SIZES.volume.priceBrl)}/mês
          </span>
        </div>
      )}
    </div>
  );
}

/** O formulário do modal de trocar o tamanho, com a prévia do que acontece (cobra agora ou vale no dia 1º). */
function SizeChangeFields({ botId, botName, current, pendingSize, pendingVolumePacks, monthQuota, renewal, onDone }: SizeProps & { onDone: () => void }) {
  const scheduled = nextChoice({ ...current, pendingSize, pendingVolumePacks });
  const [size, setSize] = useState<BotSize | "">(scheduled.size ?? "");
  const [packs, setPacks] = useState<number>(scheduled.volumePacks ?? current.volumePacks ?? 1);
  const next: SizeChoice = { size: size || null, volumePacks: size === "volume" ? packs : null };
  const plan = planSizeChange({ ...current, monthQuota, pendingSize, pendingVolumePacks }, next);
  const hint =
    plan.kind === "upgrade"
      ? { tone: "brand", text: `Cobra ${brlCents(plan.amountCents / 100)} agora no cartão da assinatura (proporcional até ${renewal}); a cota do mês vai para ${num(plan.monthQuota)}.` }
      : plan.kind === "downgrade"
        ? { tone: "muted", text: `Vale em ${renewal} (o mês já foi pago). Até lá, segue ${choiceLabel(current)}.` }
        : plan.kind === "cancel_pending"
          ? { tone: "muted", text: "Cancela a troca agendada: segue como está." }
          : plan.kind === "already_scheduled"
            ? { tone: "muted", text: `Essa troca já está agendada para ${renewal}.` }
            : null;
  const confirmCharge = () =>
    plan.kind === "upgrade" && plan.amountCents > 0 ? { title: `Cobrar ${brlCents(plan.amountCents / 100)} agora?`, description: `No cartão da assinatura, para ${botName} ficar ${choiceLabel(next)}. A cota do mês vai para ${num(plan.monthQuota)}.`, confirmLabel: "Cobrar e trocar" } : null;

  return (
    <ActionForm action={changeBotSize.bind(null, botId)} confirm={confirmCharge} onSuccess={onDone} className="flex flex-col gap-4">
      <SizeCards name={`size:${botId}`} value={size} onChange={setSize} volumePacks={packs} onVolume={setPacks} packsName={`packs:${botId}`} />
      {hint && <p className={cn("rounded-[12px] px-3 py-2 text-sm", hint.tone === "brand" ? "bg-brand-soft text-brand" : "bg-raised text-ink-2")}>{hint.text}</p>}
      <div className="-mx-6 -mb-6 flex justify-end gap-2 border-t border-line-2 px-6 py-3">
        <button type="button" onClick={onDone} className="btn-ghost">
          Cancelar
        </button>
        <SubmitButton className="btn-primary px-5" pendingLabel="Trocando…" disabled={plan.kind === "same" || plan.kind === "already_scheduled"}>
          {plan.kind === "upgrade" && plan.amountCents > 0 ? `Cobrar ${brlCents(plan.amountCents / 100)} e trocar` : plan.kind === "cancel_pending" ? "Cancelar a troca" : "Trocar"}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

/**
 * Troca de tamanho de um chatbot assinado (redesenho, etapa 5: num modal, com os tamanhos em cartões):
 * subir cobra agora a diferença proporcional (pede confirmação) e a cota do mês sobe junto; descer
 * vale no dia 1º.
 */
export function SizeChangeButton(props: SizeProps) {
  const [open, setOpen] = useState(false);
  const [gen, setGen] = useState(0);
  const close = () => {
    setOpen(false);
    setGen((g) => g + 1);
  };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-ghost shrink-0 py-1.5 text-xs">
        Trocar
      </button>
      <Modal open={open} onClose={close} title={`Tamanho de ${props.botName}`} description="Subir vale na hora, com a cobrança proporcional; descer ou tirar vale no dia 1º." size="lg">
        <SizeChangeFields key={gen} {...props} onDone={close} />
      </Modal>
    </>
  );
}

interface PackProps {
  pack: PackId;
  name: string;
  priceBrl: number;
  description: string;
  state: "off" | "on" | "ending";
  /** Cobrança de agora para assinar (proporcional ao resto do mês), em centavos. */
  chargeCents: number;
  /** Precisa de outro pacote ativo antes. */
  blockedBy: string | null;
  renewal: string;
}

/** Um pacote da conta num cartão: a situação e o assinar (cobra o proporcional, com confirmação), tirar no dia 1º ou manter. */
export function PackCard({ pack, name, priceBrl, description, state, chargeCents, blockedBy, renewal }: PackProps) {
  return (
    <li className={cn("card flex flex-col gap-2 p-4", state === "on" && "shadow-[inset_0_0_0_1.5px_var(--color-brand)]")}>
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[15px] font-medium text-ink">{name}</span>
        {state === "on" ? <StatusPill tone="ok">Ativo</StatusPill> : state === "ending" ? <StatusPill tone="warn">Sai em {renewal}</StatusPill> : null}
      </span>
      <span className="tabular text-sm text-ink-2">{brlCents(priceBrl)}/mês</span>
      <span className="flex-1 text-xs leading-snug text-muted">{description}</span>
      {state === "off" ? (
        <ActionForm action={changePack.bind(null, pack, true)} confirm={() => ({ title: `Assinar o ${name}?`, description: `Cobra ${brlCents(chargeCents / 100)} agora no cartão da assinatura, proporcional até ${renewal}.`, confirmLabel: "Assinar e cobrar" })}>
          <SubmitButton className="btn-ghost w-full py-1.5 text-sm" pendingLabel="Assinando…" disabled={Boolean(blockedBy)}>
            Assinar · {brlCents(chargeCents / 100)} agora
          </SubmitButton>
          {blockedBy && <span className="mt-1 block text-xs text-muted">Precisa do {blockedBy} ativo.</span>}
        </ActionForm>
      ) : state === "ending" ? (
        <ActionForm action={changePack.bind(null, pack, true)}>
          <SubmitButton className="btn-ghost w-full py-1.5 text-sm" pendingLabel="Salvando…">
            Manter o pacote
          </SubmitButton>
        </ActionForm>
      ) : (
        <ActionForm action={changePack.bind(null, pack, false)} confirm={() => ({ title: `Tirar o ${name}?`, description: `Ele continua até ${renewal} (o mês já foi pago) e sai da próxima fatura.`, confirmLabel: "Tirar no dia 1º" })}>
          <SubmitButton className="btn-ghost w-full py-1.5 text-sm text-muted" pendingLabel="Salvando…">
            Tirar em {renewal}
          </SubmitButton>
        </ActionForm>
      )}
    </li>
  );
}
