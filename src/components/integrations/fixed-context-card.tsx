import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ActionResult } from "@/lib/action-result";
import { contextInput, contextLabel } from "@/lib/bot-context";

/**
 * Contexto fixo do chatbot (D', parte 1), na aba Ações: a loja de uma plataforma, o workspace de um
 * SaaS. Vai em toda chamada de ação e escolhe as fontes com a mesma etiqueta; a IA não vê.
 */
export function FixedContextCard({ value, manage, save }: { value: unknown; manage: boolean; save: (fd: FormData) => Promise<ActionResult> }) {
  const label = contextLabel(value);
  return (
    <section className="card mt-5 flex max-w-[860px] flex-col gap-3 p-5">
      <div>
        <h3 className="text-base font-bold">Contexto fixo deste chatbot</h3>
        <p className="text-sm text-muted">
          Vai em toda chamada de ação (no campo <code>context</code> do corpo), por cima do contexto do token ou do pareamento, e escolhe as fontes enviadas pela API com a mesma etiqueta. A IA não vê. Serve para a loja de uma plataforma ou o cliente de um SaaS, por exemplo <code>{'{"loja_id": "42"}'}</code>.
        </p>
      </div>
      {manage ? (
        <ActionForm action={save} className="flex flex-col gap-2">
          <label htmlFor="fixed_context" className="label">Contexto (JSON; vazio tira)</label>
          <textarea id="fixed_context" name="fixed_context" rows={4} defaultValue={contextInput(value)} spellCheck={false} className="input font-mono text-sm" />
          <SubmitButton className="btn-ghost self-start" pendingLabel="Salvando…">Salvar contexto</SubmitButton>
        </ActionForm>
      ) : (
        <p className="text-sm">{label ? <code>{label}</code> : <span className="text-muted">Sem contexto fixo.</span>}</p>
      )}
    </section>
  );
}
