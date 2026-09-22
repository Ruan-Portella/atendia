import { Headset } from "lucide-react";
import type { ActionResult } from "@/lib/action-result";
import { minutesSince, relativeTime } from "@/lib/utils";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { AutoRefresh } from "@/components/auto-refresh";

export interface HandoffConversation {
  last_message_at: string;
  handoff_requested_at: string | null;
  takeover_at: string | null;
  handled_at: string | null;
}

/** Faixa de status (pediu atendente / você está atendendo) + atualização ao vivo. Vai no topo. */
export function HandoffStatus({ conv, onTakeOver }: { conv: HandoffConversation; onTakeOver: () => Promise<ActionResult> }) {
  const open = !conv.handled_at;
  const active = open && Boolean(conv.takeover_at);
  const waiting = open && !conv.takeover_at && Boolean(conv.handoff_requested_at);
  return (
    <>
      {(active || waiting) && <AutoRefresh ms={active ? 3000 : 5000} />}
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
  // conversa recente (30 min) ainda dá para assumir: o visitante provavelmente está lá
  const recent = minutesSince(conv.last_message_at) < 30;
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
        !waiting && open && recent && (
          <ActionForm action={onTakeOver} className="self-start">
            <SubmitButton pendingLabel="Assumindo…" className="btn-ghost"><Headset size={15} />Assumir esta conversa</SubmitButton>
          </ActionForm>
        )
      )}
      {conv.handled_at && conv.handoff_requested_at && <p className="text-xs text-muted">Atendimento humano encerrado {relativeTime(conv.handled_at)}.</p>}
    </>
  );
}
