"use client";

import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { startCheckout } from "@/app/painel/(configuracoes)/cobranca/actions";
import { BOT_SIZES, PACKS, brlCents, num, sizeOption, type BotSize, type PackId } from "@/lib/plans";
import { cn } from "@/lib/utils";

interface BotRow {
  id: string;
  name: string;
  clientName: string | null;
  size: BotSize | null;
  volumePacks: number | null;
}

interface Props {
  bots: BotRow[];
  /** Quanto do mês ainda falta (o primeiro mês é proporcional). */
  fraction: number;
  /** "1º de novembro": quando vem a primeira fatura cheia. */
  renewal: string;
  enabled: boolean;
}

const monthly = (size: BotSize | "", packs: number) => (size === "volume" ? packs * BOT_SIZES.volume.priceBrl : size ? BOT_SIZES[size].priceBrl : 0);

/**
 * Primeira assinatura: o tamanho de cada chatbot (ou nenhum) e os pacotes da conta, com o total
 * do mês e a primeira cobrança proporcional até o dia 1º. O pagamento abre no Checkout da Stripe.
 * Redesenho, etapa 5: cada chatbot numa linha, os pacotes com a chave e o total fixo embaixo.
 */
export function SubscribeForm({ bots, fraction, renewal, enabled }: Props) {
  const [sizes, setSizes] = useState<Record<string, BotSize | "">>(() => Object.fromEntries(bots.map((b) => [b.id, b.size ?? ""])));
  const [volume, setVolume] = useState<Record<string, number>>(() => Object.fromEntries(bots.map((b) => [b.id, b.volumePacks ?? 1])));
  const [packs, setPacks] = useState<Set<PackId>>(new Set());

  const togglePack = (p: PackId, on: boolean) => {
    const next = new Set(packs);
    if (on) {
      next.add(p);
      if (PACKS[p].requires) next.add(PACKS[p].requires!);
    } else {
      next.delete(p);
      for (const q of Object.values(PACKS)) if (q.requires === p) next.delete(q.id);
    }
    setPacks(next);
  };

  const total = bots.reduce((t, b) => t + monthly(sizes[b.id], volume[b.id]), 0) + [...packs].reduce((t, p) => t + PACKS[p].priceBrl, 0);
  const sized = bots.filter((b) => sizes[b.id]).length;
  const setVol = (id: string, n: number) => setVolume({ ...volume, [id]: Math.max(1, Math.min(1000, n)) });

  return (
    <ActionForm action={startCheckout} className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="kpi-label px-1">Tamanho de cada chatbot</h2>
        <div className="card flex flex-col divide-y divide-line-2 overflow-hidden">
          {bots.map((b) => (
            <div key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium text-ink">{b.name}</span>
                {b.clientName && <span className="block truncate text-xs text-muted">{b.clientName}</span>}
              </span>
              <span className="flex flex-wrap items-center gap-2">
                <select name={`size:${b.id}`} value={sizes[b.id]} onChange={(e) => setSizes({ ...sizes, [b.id]: e.target.value as BotSize | "" })} aria-label={`Tamanho de ${b.name}`} className="input w-auto py-1.5 text-sm">
                  <option value="">Sem tamanho</option>
                  {Object.values(BOT_SIZES).map((s) => (
                    <option key={s.id} value={s.id}>
                      {sizeOption(s)}
                    </option>
                  ))}
                </select>
                {sizes[b.id] === "volume" && (
                  <span className="flex items-center gap-1">
                    <button type="button" aria-label="Menos um pacote" onClick={() => setVol(b.id, volume[b.id] - 1)} className="btn-icon h-8 w-8">
                      <Minus size={14} />
                    </button>
                    <input name={`packs:${b.id}`} type="number" min={1} max={1000} value={volume[b.id]} onChange={(e) => setVol(b.id, Number(e.target.value) || 1)} aria-label={`Pacotes do Volume de ${b.name}`} className="input w-[64px] py-1 text-center text-sm" />
                    <button type="button" aria-label="Mais um pacote" onClick={() => setVol(b.id, volume[b.id] + 1)} className="btn-icon h-8 w-8">
                      <Plus size={14} />
                    </button>
                  </span>
                )}
              </span>
              <span className={cn("w-24 text-right text-sm tabular", sizes[b.id] ? "text-ink" : "text-muted")}>{sizes[b.id] ? `${brlCents(monthly(sizes[b.id], volume[b.id]))}/mês` : "—"}</span>
            </div>
          ))}
          {bots.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted">Crie um chatbot para escolher o tamanho dele.</p>}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="kpi-label px-1">Pacotes da conta</h2>
        <div className="card flex flex-col divide-y divide-line-2 overflow-hidden">
          {Object.values(PACKS).map((p) => (
            <label key={p.id} className="flex cursor-pointer items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[15px] font-medium text-ink">{p.name}</span>
                  <span className="tabular text-xs text-ink-2">{brlCents(p.priceBrl)}/mês</span>
                </span>
                <span className="mt-0.5 block text-xs leading-snug text-muted">
                  {p.description}
                  {p.requires ? ` (vem com ${PACKS[p.requires].name})` : ""}
                </span>
              </span>
              <input type="checkbox" role="switch" name="pack" value={p.id} checked={packs.has(p.id)} onChange={(e) => togglePack(p.id, e.target.checked)} className="switch" aria-label={p.name} />
            </label>
          ))}
        </div>
      </section>

      <section className="card sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-4 p-5 shadow-[0_8px_24px_rgb(0_0_0/0.08)]">
        <div className="text-sm">
          <div>
            Total do mês: <strong className="text-lg tabular">{brlCents(total)}</strong> <span className="text-muted">({num(sized)} chatbot{sized === 1 ? "" : "s"} com tamanho)</span>
          </div>
          <div className="mt-1 text-muted">
            Hoje: cerca de <strong className="text-ink tabular">{brlCents(Math.round(total * fraction * 100) / 100)}</strong>, proporcional até {renewal}. Depois, a fatura vem todo dia 1º.
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <SubmitButton className="btn-primary" pendingLabel="Abrindo o pagamento…" disabled={!enabled || sized === 0}>
            Assinar
          </SubmitButton>
          <span className="max-w-[260px] text-right text-[11px] text-muted">
            Ao assinar, você aceita os{" "}
            <a href="/termos" target="_blank" rel="noreferrer" className="underline">
              Termos de Uso
            </a>
            : dá para desistir em 7 dias, com estorno, e cancelar quando quiser.
          </span>
        </div>
      </section>
    </ActionForm>
  );
}
