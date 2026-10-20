import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ActionResult } from "@/lib/action-result";
import { contextInput, contextLabel } from "@/lib/bot-context";

/**
 * Contexto fixo e display do chatbot (D', partes 1 e 4a), na aba Ações: a loja de uma plataforma, o
 * workspace de um SaaS. O contexto vai em toda chamada de ação e escolhe as fontes com a mesma
 * etiqueta (a IA não vê); o display é o que a IA sabe da loja (nome, horário) e não vai para as ações.
 */
export function FixedContextCard({ value, display, manage, save }: { value: unknown; display: unknown; manage: boolean; save: (fd: FormData) => Promise<ActionResult> }) {
  const label = contextLabel(value);
  const shown = contextLabel(display);
  return (
    <section className="card mt-5 flex max-w-[860px] flex-col gap-3 p-5">
      <div>
        <h3 className="text-base font-bold">Contexto fixo e dados da loja</h3>
        <p className="text-sm text-muted">
          O <strong>contexto</strong> vai em toda chamada de ação (no campo <code>context</code> do corpo), por cima do contexto do token ou do pareamento, e escolhe as fontes enviadas pela API com a mesma etiqueta. A IA não vê. Serve para a loja de uma plataforma ou o cliente de um SaaS, por exemplo <code>{'{"loja_id": "42"}'}</code>.
        </p>
        <p className="mt-1 text-sm text-muted">
          Os <strong>dados da loja</strong> (o <code>display</code> da API) são o que a IA sabe deste chatbot além da base, como o nome da unidade e o horário, por exemplo <code>{'{"nome": "Pizzaria do Zé, Centro", "horario": "terça a domingo, das 18h às 23h"}'}</code>. Não vão para as ações.
        </p>
      </div>
      {manage ? (
        <ActionForm action={save} className="flex flex-col gap-2">
          <label htmlFor="fixed_context" className="label">Contexto (JSON; vazio tira)</label>
          <textarea id="fixed_context" name="fixed_context" rows={3} defaultValue={contextInput(value)} spellCheck={false} className="input font-mono text-sm" />
          <label htmlFor="fixed_display" className="label">Dados da loja para a IA (JSON; vazio tira)</label>
          <textarea id="fixed_display" name="fixed_display" rows={4} defaultValue={contextInput(display)} spellCheck={false} className="input font-mono text-sm" />
          <SubmitButton className="btn-ghost self-start" pendingLabel="Salvando…">Salvar</SubmitButton>
        </ActionForm>
      ) : (
        <div className="flex flex-col gap-1 text-sm">
          <p>Contexto: {label ? <code>{label}</code> : <span className="text-muted">sem contexto fixo.</span>}</p>
          <p>Dados da loja: {shown ? <code>{shown}</code> : <span className="text-muted">nenhum.</span>}</p>
        </div>
      )}
    </section>
  );
}
