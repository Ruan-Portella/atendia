import { createAdminClient } from "@/lib/supabase/admin";
import { currentPeriodBR, periodLabel } from "@/lib/report";
import { num } from "@/lib/plans";
import { CATEGORY_LABEL, estimateCost, monthUsage } from "@/lib/whatsapp-usage";

const money = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 }).format(v);

/**
 * Consumo do WhatsApp no mês (horário de Brasília): mensagens enviadas e as que a Meta cobrou, por
 * categoria, com uma estimativa em reais. Quem renderiza já conferiu o dono do chatbot.
 */
export async function WhatsAppUsage({ botId }: { botId: string }) {
  const period = currentPeriodBR();
  const lines = await monthUsage(createAdminClient(), botId, period);
  const sent = lines.reduce((a, l) => a + l.sent, 0);
  const billed = lines.reduce((a, l) => a + l.billed, 0);
  const { total, unpriced } = estimateCost(lines);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-lg font-bold">Consumo de {periodLabel(period)}</h3>
        <p className="text-sm text-muted">Mensagens enviadas por este número e quantas a Meta cobrou. A Meta cobra direto do cliente; o valor é uma estimativa pela tabela de referência.</p>
      </div>
      {sent === 0 ? (
        <p className="text-sm text-muted">Nenhuma mensagem enviada neste mês ainda.</p>
      ) : (
        <div className="card overflow-hidden text-sm">
          <div className="grid grid-cols-[1fr_5.5rem_5.5rem] gap-x-6 border-b border-line-2 px-4 py-2 text-xs font-semibold uppercase tracking-[0.06em] text-muted">
            <span>Tipo</span>
            <span className="text-right">Enviadas</span>
            <span className="text-right">Cobradas</span>
          </div>
          {lines.map((l) => (
            <div key={l.category} className="grid grid-cols-[1fr_5.5rem_5.5rem] gap-x-6 border-b border-line-2 px-4 py-2 last:border-0">
              <span>{CATEGORY_LABEL[l.category] ?? l.category}</span>
              <span className="text-right tabular">{num(l.sent)}</span>
              <span className="text-right tabular">{num(l.billed)}</span>
            </div>
          ))}
          <div className="flex flex-wrap items-baseline justify-between gap-2 bg-ground px-4 py-3">
            <span className="font-semibold">{num(billed)} cobradas de {num(sent)} enviadas</span>
            <span className="display text-lg font-bold">≈ {money(total)}</span>
          </div>
        </div>
      )}
      {unpriced.length > 0 && (
        <p className="text-xs text-muted">Sem preço de referência para: {unpriced.map((c) => CATEGORY_LABEL[c] ?? c).join(", ")}. Essas ficaram fora da estimativa.</p>
      )}
    </div>
  );
}
