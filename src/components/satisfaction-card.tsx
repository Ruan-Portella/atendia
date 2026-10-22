import { IDLE_MINUTES, type SatisfactionSummary } from "@/lib/satisfaction";

/**
 * Pesquisa de satisfação do chatbot (Lançamento, parte 4): como funciona e o resultado dos últimos
 * 30 dias, no modal da linha (a chave de ligar fica na própria linha).
 */
export function SatisfactionAbout({ summary }: { summary: SatisfactionSummary }) {
  return (
    <>
      <p className="text-sm leading-relaxed text-ink-2">
        No WhatsApp e no Instagram, o contato recebe &quot;Como foi o seu atendimento hoje?&quot; com Ótimo, Regular e Ruim: quando a equipe encerra um atendimento e quando a conversa com o assistente fica parada por {IDLE_MINUTES} minutos. Uma por conversa por dia, dentro da janela de 24 horas (a Meta não cobra), e nunca para quem pediu para sair.
      </p>
      {summary.sent > 0 ? (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-xl border border-line bg-raised/40 px-4 py-3 text-sm">
          <span className="font-semibold">Últimos 30 dias:</span>
          {summary.goodPct !== null ? <span className="text-brand">{summary.goodPct}% Ótimo</span> : <span className="text-muted">nenhuma resposta ainda</span>}
          <span className="text-muted">
            {summary.answered} de {summary.sent} pesquisas respondidas · Ótimo {summary.good} · Regular {summary.regular} · Ruim {summary.bad}
          </span>
        </div>
      ) : (
        <p className="text-xs text-muted">Nenhuma pesquisa enviada nos últimos 30 dias.</p>
      )}
    </>
  );
}

/** O resumo da linha: ligada ou não e, com respostas, a porcentagem de Ótimo. */
export function satisfactionLine(on: boolean, s: SatisfactionSummary): string {
  if (!on) return "Desligada";
  return s.goodPct !== null ? `Ligada · ${s.goodPct}% Ótimo em 30 dias (${s.answered} de ${s.sent} respondidas)` : "Ligada";
}
