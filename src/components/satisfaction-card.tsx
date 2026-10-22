import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ActionResult } from "@/lib/action-result";
import { IDLE_MINUTES, type SatisfactionSummary } from "@/lib/satisfaction";

/** Pesquisa de satisfação do chatbot (Lançamento, parte 4): ligar e o resultado dos últimos 30 dias. */
export function SatisfactionCard({ on, summary, save, bare = false }: { on: boolean; summary: SatisfactionSummary; save: (formData: FormData) => Promise<ActionResult>; /** dentro de um bloco: sem a linha de cima e sem o título */ bare?: boolean }) {
  return (
    <section className={bare ? "flex flex-col gap-3" : "flex max-w-[640px] flex-col gap-3 border-t border-line pt-5"}>
      <div>
        {!bare && <h3 className="text-sm font-semibold">Pesquisa de satisfação</h3>}
        <p className="text-xs text-muted">
          No WhatsApp e no Instagram, o contato recebe &quot;Como foi o seu atendimento hoje?&quot; com Ótimo, Regular e Ruim: quando a equipe encerra um atendimento e quando a conversa com o assistente fica parada por {IDLE_MINUTES} minutos. Uma por conversa por dia, dentro da janela de 24 horas (a Meta não cobra), e nunca para quem pediu para sair.
        </p>
      </div>
      <ActionForm key={String(on)} action={save} className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="satisfaction_survey" defaultChecked={on} className="accent-brand" /> Mandar a pesquisa de satisfação
        </label>
        <SubmitButton pendingLabel="Salvando…" className="text-xs font-semibold text-brand hover:underline disabled:opacity-50">
          Salvar
        </SubmitButton>
      </ActionForm>
      {summary.sent > 0 && (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-xl border border-line bg-panel px-4 py-3 text-sm">
          <span className="font-semibold">Últimos 30 dias:</span>
          {summary.goodPct !== null ? <span className="text-brand">{summary.goodPct}% Ótimo</span> : <span className="text-muted">nenhuma resposta ainda</span>}
          <span className="text-muted">
            {summary.answered} de {summary.sent} pesquisas respondidas · Ótimo {summary.good} · Regular {summary.regular} · Ruim {summary.bad}
          </span>
        </div>
      )}
    </section>
  );
}
