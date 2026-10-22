import { Trash2 } from "lucide-react";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { QUICK_REPLY_BODY_MAX, QUICK_REPLY_MAX, QUICK_REPLY_TITLE_MAX, type QuickReply } from "@/lib/quick-replies";
import { deleteQuickReplyAction, saveQuickReplyAction } from "@/app/painel/clientes/setores-actions";

function Fields({ reply }: { reply?: QuickReply }) {
  return (
    <>
      <label className="flex flex-col gap-1.5">
        <span className="label">Título</span>
        <input name="title" required maxLength={QUICK_REPLY_TITLE_MAX} defaultValue={reply?.title} placeholder="Horário de funcionamento" className="input" />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="label">Texto</span>
        <textarea name="body" required maxLength={QUICK_REPLY_BODY_MAX} rows={4} defaultValue={reply?.body} placeholder="Olá, {nome}! Funcionamos de segunda a sábado, das 9h às 18h." className="input" />
      </label>
    </>
  );
}

/**
 * Respostas prontas do cliente (Caixa de entrada, parte 4): valem para todos os chatbots dele, no
 * painel e na área do cliente. {nome} vira o primeiro nome do contato; {atendente}, o de quem responde.
 */
export function ClientQuickReplies({ clientId, replies }: { clientId: string; replies: QuickReply[] }) {
  return (
    <section className="card flex max-w-[860px] flex-col gap-4 p-5">
      <div>
        <h2 className="text-base font-medium">Respostas prontas</h2>
        <p className="text-sm text-muted">Textos que a equipe põe na resposta com um clique, na conversa e na Caixa de entrada (dá para editar antes de enviar). Use <code>{"{nome}"}</code> para o primeiro nome do contato e <code>{"{atendente}"}</code> para o nome de quem responde.</p>
      </div>
      {replies.length === 0 && <p className="text-sm text-muted">Nenhuma resposta pronta ainda.</p>}
      <ul className="flex flex-col gap-3">
        {replies.map((r) => (
          <li key={r.id} className="rounded-xl border border-line">
            <details>
              <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                <span className="font-semibold">{r.title}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted">{r.body}</span>
              </summary>
              <div className="flex flex-col gap-4 border-t border-line-2 px-4 py-4">
                <ActionForm action={saveQuickReplyAction.bind(null, clientId, r.id)} className="flex flex-col gap-3">
                  <Fields reply={r} />
                  <SubmitButton className="btn-primary w-fit" pendingLabel="Salvando…">Salvar</SubmitButton>
                </ActionForm>
                <ConfirmAction action={deleteQuickReplyAction.bind(null, clientId, r.id)} title={`Apagar “${r.title}”?`} description="A resposta pronta sai da lista da equipe. As mensagens já enviadas não mudam." confirmLabel="Apagar" className="btn-ghost w-fit text-danger">
                  <Trash2 size={15} />
                  Apagar
                </ConfirmAction>
              </div>
            </details>
          </li>
        ))}
      </ul>
      {replies.length < QUICK_REPLY_MAX && (
        <details className="rounded-xl border border-dashed border-line">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">+ Nova resposta pronta</summary>
          <ActionForm action={saveQuickReplyAction.bind(null, clientId, null)} className="flex flex-col gap-3 border-t border-line-2 px-4 py-4">
            <Fields />
            <SubmitButton className="btn-primary w-fit" pendingLabel="Criando…">Criar</SubmitButton>
          </ActionForm>
        </details>
      )}
    </section>
  );
}
