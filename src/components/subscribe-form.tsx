"use client";

import { useState } from "react";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { startCheckout } from "@/app/painel/(configuracoes)/cobranca/actions";
import { BOT_SIZES, PACKS, brlCents, num, sizeOption, type BotSize, type PackId } from "@/lib/plans";

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

  return (
    <ActionForm action={startCheckout} className="mt-6 flex flex-col gap-6">
      <section>
        <h2 className="text-lg font-medium">Tamanho de cada chatbot</h2>
        <p className="mt-1 text-sm text-muted">A cota do mês é de cada chatbot. O Atendimento não tem IA nenhuma: é a caixa de entrada da sua equipe (conversas, contatos e campanhas). Todo chatbot no ar tem um tamanho, e conectar os canais não custa nada a mais.</p>
        <div className="card mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-line-2 text-left text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                <th className="px-4 py-2 font-semibold">Chatbot</th>
                <th className="px-3 py-2 font-semibold">Tamanho</th>
                <th className="px-4 py-2 text-right font-semibold">Por mês</th>
              </tr>
            </thead>
            <tbody>
              {bots.map((b) => (
                <tr key={b.id} className="border-b border-line-2 last:border-0">
                  <td className="px-4 py-2">
                    {b.name}
                    {b.clientName && <span className="block text-xs text-muted">{b.clientName}</span>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <select name={`size:${b.id}`} value={sizes[b.id]} onChange={(e) => setSizes({ ...sizes, [b.id]: e.target.value as BotSize | "" })} aria-label={`Tamanho de ${b.name}`} className="input w-auto py-1 text-sm">
                        <option value="">sem tamanho</option>
                        {Object.values(BOT_SIZES).map((s) => (
                          <option key={s.id} value={s.id}>
                            {sizeOption(s)}
                          </option>
                        ))}
                      </select>
                      {sizes[b.id] === "volume" && (
                        <label className="flex items-center gap-1 text-xs text-muted">
                          <input name={`packs:${b.id}`} type="number" min={1} max={1000} value={volume[b.id]} onChange={(e) => setVolume({ ...volume, [b.id]: Math.max(1, Number(e.target.value) || 1) })} className="input w-[72px] py-1 text-sm" />
                          pacotes ({num(volume[b.id] * BOT_SIZES.volume.atendimentos)} atendimentos)
                        </label>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right tabular">{sizes[b.id] ? brlCents(monthly(sizes[b.id], volume[b.id])) : "—"}</td>
                </tr>
              ))}
              {bots.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-4 text-center text-muted">Crie um chatbot para escolher o tamanho dele.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-medium">Pacotes da conta</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {Object.values(PACKS).map((p) => (
            <label key={p.id} className="card flex cursor-pointer gap-3 p-4 text-sm">
              <input type="checkbox" name="pack" value={p.id} checked={packs.has(p.id)} onChange={(e) => togglePack(p.id, e.target.checked)} className="mt-0.5" />
              <span>
                <span className="font-semibold">{p.name}</span> · {brlCents(p.priceBrl)}/mês
                <span className="block text-muted">{p.description}{p.requires ? ` (vem com ${PACKS[p.requires].name})` : ""}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="card flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="text-sm">
          <div>
            Total do mês: <strong className="text-lg tabular">{brlCents(total)}</strong> <span className="text-muted">({num(sized)} chatbot{sized === 1 ? "" : "s"} com tamanho)</span>
          </div>
          <div className="mt-1 text-muted">
            Hoje: cerca de <strong className="text-ink tabular">{brlCents(Math.round(total * fraction * 100) / 100)}</strong>, proporcional até {renewal}. Depois, a fatura vem todo dia 1º. O excedente (opcional) é pago à parte, com crédito pré-pago.
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
