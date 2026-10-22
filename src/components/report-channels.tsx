import { CHANNEL_LABEL, ticketSentence, widgetFunnel, type ChannelMonth } from "@/lib/report";
import type { TicketMonth } from "@/lib/ticket-metrics";
import { num } from "@/lib/plans";

/**
 * Por canal e o funil do chat do site no relatório (Pendências do MVP, parte 4): só números, sem
 * contato nem conversa (aparece também no link público).
 */
export function ReportChannels({ channels, widgetOpens, tickets }: { channels: ChannelMonth[]; widgetOpens: number; tickets?: TicketMonth | null }) {
  if (!channels.length) return null;
  const ticketLine = tickets ? ticketSentence(tickets) : null;
  const funnel = widgetFunnel(widgetOpens, channels.find((ch) => ch.channel === "widget"));
  const unanswered = channels.reduce((n, ch) => n + ch.unanswered, 0);
  return (
    <section className="card flex min-w-0 flex-col gap-4 p-4 sm:p-5">
      <div>
        <h2 className="text-base font-medium">Por canal</h2>
        <p className="text-sm text-muted">De onde vieram as conversas do mês, quantas foram para a equipe e quantas deixaram contato.</p>
      </div>
      <div className="min-w-0 overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="pb-2 font-semibold">Canal</th>
              <th className="pb-2 text-right font-semibold">Conversas</th>
              <th className="pb-2 text-right font-semibold">Pediram atendente</th>
              <th className="pb-2 text-right font-semibold">Contatos</th>
              <th className="pb-2 text-right font-semibold">Sem resposta</th>
            </tr>
          </thead>
          <tbody>
            {channels.map((ch) => (
              <tr key={ch.channel} className="border-t border-line-2">
                <td className="py-2 font-medium">{CHANNEL_LABEL[ch.channel] ?? ch.channel}</td>
                <td className="py-2 text-right tabular">{num(ch.conversations)}</td>
                <td className="py-2 text-right tabular">{num(ch.handoffs)}</td>
                <td className="py-2 text-right tabular">{num(ch.leads)}</td>
                <td className="py-2 text-right tabular">{num(ch.unanswered)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {unanswered > 0 && (
        <p className="text-xs text-muted">
          {num(unanswered)} pergunta{unanswered === 1 ? " ficou" : "s ficaram"} sem resposta no mês: é o que vale ensinar ao assistente.
        </p>
      )}
      {funnel && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Chat do site</h3>
          <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {funnel.map((f) => (
              <li key={f.label} className="flex flex-col gap-0.5 rounded-lg border border-line-2 px-3 py-2.5">
                <span className="kpi-label">{f.label}</span>
                <span className="display text-xl font-bold tabular">{num(f.value)}</span>
                <span className="text-xs text-muted">{f.pct === null ? <>&nbsp;</> : `${f.pct}% do passo anterior`}</span>
              </li>
            ))}
          </ol>
          <p className="text-xs text-muted">Aberturas contadas uma vez por visita ao site, sem guardar nada de quem abriu.</p>
        </div>
      )}
      {ticketLine && (
        <p className="text-sm">
          <span className="font-semibold">Chamados pelo site:</span> {ticketLine}.
        </p>
      )}
    </section>
  );
}
