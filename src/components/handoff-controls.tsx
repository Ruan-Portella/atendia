import { Headset } from "lucide-react";
import type { ActionResult } from "@/lib/action-result";
import { relativeTime } from "@/lib/utils";
import { WHATSAPP_WINDOW_HOURS, canTakeOver, conversationState, lastSeen } from "@/lib/presence";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { AutoRefresh } from "@/components/auto-refresh";

export interface HandoffConversation {
  last_message_at: string;
  handoff_requested_at: string | null;
  takeover_at: string | null;
  handled_at: string | null;
  visitor_seen_at?: string | null;
  channel?: string | null;
}

/** "Visitante online agora" / "saiu do site há X" — para saber se ainda vale responder. */
function VisitorPresence({ conv }: { conv: HandoffConversation }) {
  if (conv.channel === "whatsapp") {
    return <span className="text-muted">Conversa pelo WhatsApp. Última mensagem {relativeTime(conv.last_message_at)}; dá para responder até {WHATSAPP_WINDOW_HOURS} h depois da última mensagem do cliente.</span>;
  }
  const online = conversationState(conv) === "online";
  return online ? (
    <span className="inline-flex items-center gap-1.5 font-semibold text-brand"><span className="h-2 w-2 animate-pulse rounded-full bg-brand" />Visitante online agora</span>
  ) : (
    <span className="text-muted">O visitante saiu do site {relativeTime(lastSeen(conv))}. Se ele voltar, a conversa continua de onde parou e ele vê suas respostas.</span>
  );
}

/** Faixa de status (pediu atendente / você está atendendo) + atualização ao vivo. Vai no topo. */
export function HandoffStatus({ conv, onTakeOver }: { conv: HandoffConversation; onTakeOver: () => Promise<ActionResult> }) {
  const open = !conv.handled_at;
  const active = open && Boolean(conv.takeover_at);
  const waiting = open && !conv.takeover_at && Boolean(conv.handoff_requested_at);
  return (
    <>
      {(active || waiting) && <AutoRefresh ms={active ? 3000 : 5000} />}
      {(active || waiting) && (
        <div className="rounded-lg border border-line bg-panel px-4 py-2 text-sm"><VisitorPresence conv={conv} /></div>
      )}
      {waiting && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#efd9a9] bg-amber-soft px-4 py-3 text-sm">
          <Headset size={18} className="text-amber-ink" />
          <span className="flex-1 text-amber-ink"><strong>O visitante pediu para falar com alguém</strong> {relativeTime(conv.handoff_requested_at!)}. Assuma para responder por aqui.</span>
          <ActionForm action={onTakeOver}><SubmitButton pendingLabel="Assumindo…" className="btn-dark py-1.5">Assumir conversa</SubmitButton></ActionForm>
        </div>
      )}
      {active && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#cfe3d8] bg-brand-soft px-4 py-3 text-sm text-brand">
          <Headset size={18} />
          <span className="flex-1"><strong>Atendimento humano em andamento.</strong> O assistente pausou nesta conversa; o visitante vê as respostas em segundos.</span>
        </div>
      )}
    </>
  );
}

/** Caixa de resposta e botões de assumir/encerrar. Vai embaixo da conversa. */
export function HandoffReply({ conv, onTakeOver, onSend, onRelease }: { conv: HandoffConversation; onTakeOver: () => Promise<ActionResult>; onSend: (fd: FormData) => Promise<ActionResult>; onRelease: () => Promise<ActionResult> }) {
  const open = !conv.handled_at;
  const active = open && Boolean(conv.takeover_at);
  const waiting = open && !conv.takeover_at && Boolean(conv.handoff_requested_at);
  return (
    <>
      {active ? (
        <div className="sticky bottom-0 flex flex-col gap-2 border-t border-line bg-ground py-3">
          <ActionForm action={onSend} className="flex items-end gap-2">
            <label htmlFor="agent-msg" className="sr-only">Sua resposta</label>
            <textarea id="agent-msg" name="content" required maxLength={2000} rows={2} className="input flex-1 resize-y" placeholder="Escreva sua resposta para o visitante…" />
            <SubmitButton pendingLabel="Enviando…" className="btn-primary">Enviar</SubmitButton>
          </ActionForm>
          <ActionForm action={onRelease} className="self-end">
            <SubmitButton pendingLabel="Encerrando…" className="text-xs font-semibold text-muted hover:underline">Encerrar atendimento e devolver ao assistente</SubmitButton>
          </ActionForm>
        </div>
      ) : (
        !waiting && canTakeOver(conv) && (
          <ActionForm action={onTakeOver} className="self-start">
            <SubmitButton pendingLabel="Assumindo…" className="btn-ghost"><Headset size={15} />Assumir esta conversa</SubmitButton>
          </ActionForm>
        )
      )}
      {conv.handled_at && conv.handoff_requested_at && <p className="text-xs text-muted">Atendimento humano encerrado {relativeTime(conv.handled_at)}.{canTakeOver(conv) ? " Você pode assumir de novo quando quiser." : ""}</p>}
    </>
  );
}
