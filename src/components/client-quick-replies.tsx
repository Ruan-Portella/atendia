import { MessageSquareText, Plus, Trash2 } from "lucide-react";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { DialogButton, SettingGroup, SettingRow } from "@/components/ui/setting-row";
import { TemplateField } from "@/components/template-field";
import { QUICK_REPLY_BODY_MAX, QUICK_REPLY_MAX, QUICK_REPLY_TITLE_MAX, type QuickReply } from "@/lib/quick-replies";
import { deleteQuickReplyAction, saveQuickReplyAction } from "@/app/painel/clientes/setores-actions";

const VARS = { nome: "Ana", atendente: "Carlos" };
const LABELS = { nome: "Primeiro nome do contato", atendente: "Nome de quem atende" };

function Fields({ reply, idPrefix }: { reply?: QuickReply; idPrefix: string }) {
  return (
    <>
      <div>
        <label htmlFor={`${idPrefix}-title`} className="label">
          Título (o que aparece na lista da conversa)
        </label>
        <input id={`${idPrefix}-title`} name="title" required maxLength={QUICK_REPLY_TITLE_MAX} defaultValue={reply?.title} placeholder="Horário de funcionamento" className="input" />
      </div>
      <TemplateField id={`${idPrefix}-body`} name="body" label="Texto" hint="Arraste as etiquetas para o texto: elas viram o nome do contato e o de quem responde na hora de usar." defaultValue={reply?.body ?? ""} fallback="Olá, {nome}! Funcionamos de segunda a sábado, das 9h às 18h." vars={VARS} labels={LABELS} maxLength={QUICK_REPLY_BODY_MAX} multiline />
    </>
  );
}

/**
 * Respostas prontas do cliente (Caixa de entrada, parte 4): valem para todos os chatbots dele, no
 * painel e na área do cliente. {nome} vira o primeiro nome do contato; {atendente}, o de quem
 * responde. Redesenho (23/10/2026): cada resposta numa linha que abre o modal, o "Nova resposta
 * pronta" no alto e o texto com as etiquetas (nada de {nome} à mostra).
 */
export function ClientQuickReplies({ clientId, replies }: { clientId: string; replies: QuickReply[] }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-[600px] text-sm text-muted">Textos que a equipe põe na resposta com um clique, na conversa e na Caixa de entrada (dá para editar antes de enviar). Valem para todos os chatbots deste cliente.</p>
        {replies.length < QUICK_REPLY_MAX && (
          <DialogButton label="Nova resposta pronta" icon={<Plus size={15} />} className="btn-primary" title="Nova resposta pronta" action={saveQuickReplyAction.bind(null, clientId, null)} saveLabel="Criar" size="lg">
            <Fields idPrefix="nova-resposta" />
          </DialogButton>
        )}
      </div>
      <SettingGroup title={`Respostas prontas · ${replies.length} de ${QUICK_REPLY_MAX}`}>
        {replies.length === 0 && <p className="px-4 py-5 text-sm text-muted">Nenhuma resposta pronta ainda.</p>}
        {replies.map((r) => (
          <SettingRow
            key={r.id}
            icon={<MessageSquareText size={18} />}
            title={r.title}
            summary={r.body.replace(/\{nome\}/g, "[nome]").replace(/\{atendente\}/g, "[atendente]").slice(0, 120)}
            action={saveQuickReplyAction.bind(null, clientId, r.id)}
            size="lg"
            footerStart={
              <ConfirmAction action={deleteQuickReplyAction.bind(null, clientId, r.id)} title={`Apagar “${r.title}”?`} description="A resposta pronta sai da lista da equipe. As mensagens já enviadas não mudam." confirmLabel="Apagar" className="inline-flex items-center gap-1.5 text-sm font-medium text-danger hover:underline">
                <Trash2 size={14} />
                Apagar
              </ConfirmAction>
            }
          >
            <Fields reply={r} idPrefix={`resposta-${r.id}`} />
          </SettingRow>
        ))}
      </SettingGroup>
    </div>
  );
}
