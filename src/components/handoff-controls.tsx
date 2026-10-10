import { Headset, PauseCircle } from "lucide-react";
import type { ActionResult } from "@/lib/action-result";
import { relativeTime } from "@/lib/utils";
import { WHATSAPP_WINDOW_HOURS, apiPauseActive, canTakeOver, conversationState, lastSeen } from "@/lib/presence";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { AutoRefresh } from "@/components/auto-refresh";
import { AgentReplyForm } from "@/components/agent-reply-form";
import { ConfirmAction } from "@/components/ui/confirm-action";

export interface HandoffConversation {
  last_message_at: string;
  handoff_requested_at: string | null;
  takeover_at: string | null;
  handled_at: string | null;
  visitor_seen_at?: string | null;
  channel?: string | null;
  last_user_at?: string | null;
  /** quem está com a conversa (leva B1': um atendente por conversa) */
  assigned_to_id?: string | null;
  assigned_to_name?: string | null;
  /** IA pausada pela integração (API) até esta hora */
  ai_paused_until?: string | null;
}

/** A integração pausou a IA e ninguém da equipe assumiu. */
const apiPaused = (conv: HandoffConversation) => !(conv.takeover_at && !conv.handled_at) && apiPauseActive(conv.ai_paused_until);

const pauseEnd = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Com quem está a conversa, do ponto de vista de quem vê a tela. Pura. */
export function holderView(conv: HandoffConversation, meId: string): "mine" | "other" | "free" {
  if (conv.handled_at || !conv.takeover_at || !conv.assigned_to_id) return "free";
  return conv.assigned_to_id === meId ? "mine" : "other";
}

/** "Visitante online agora" / "saiu do site há X" — para saber se ainda vale responder. */
function VisitorPresence({ conv }: { conv: HandoffConversation }) {
  if (conv.channel === "whatsapp" || conv.channel === "instagram") {
    const name = conv.channel === "instagram" ? "Instagram" : "WhatsApp";
    if (conv.last_user_at === null) return <span className="text-muted">Conversa pelo {name}. O contato ainda não respondeu{conv.channel === "whatsapp" ? "; até ele responder, só dá para enviar modelos" : ""}.</span>;
    return <span className="text-muted">Conversa pelo {name}. O cliente escreveu por último {relativeTime(conv.last_user_at ?? conv.last_message_at)}; dá para responder até {WHATSAPP_WINDOW_HOURS} h depois disso.</span>;
  }
  const online = conversationState(conv) === "online";
  return online ? (
    <span className="inline-flex items-center gap-1.5 font-semibold text-brand"><span className="h-2 w-2 animate-pulse rounded-full bg-brand" />Visitante online agora</span>
  ) : (
    <span className="text-muted">O visitante saiu do site {relativeTime(lastSeen(conv))}. Se ele voltar, a conversa continua de onde parou e ele vê suas respostas.</span>
  );
}

/**
 * Status do atendimento (pediu atendente / você está atendendo) + atualização ao vivo. Vai no
 * rodapé fixo, acima da resposta: com muitas mensagens, o aviso e o botão de assumir continuam à vista.
 */
export function HandoffStatus({ conv, onTakeOver, onResumeAi, meId }: { conv: HandoffConversation; onTakeOver: () => Promise<ActionResult>; onResumeAi?: () => Promise<ActionResult>; meId: string }) {
  const open = !conv.handled_at;
  const active = open && Boolean(conv.takeover_at);
  const waiting = open && !conv.takeover_at && Boolean(conv.handoff_requested_at);
  const paused = apiPaused(conv);
  if (!active && !waiting && !paused) return null;
  const who = conv.channel === "whatsapp" || conv.channel === "instagram" ? "O contato" : "O visitante";
  return (
    <>
      <AutoRefresh ms={active ? 3000 : 5000} />
      {paused ? (
        // pausa da integração: sem aviso à equipe; quem quiser responder por aqui assume
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line bg-ground px-3 py-2 text-sm">
          <PauseCircle size={16} className="shrink-0 text-muted" />
          <span className="min-w-0 flex-1"><strong>IA pausada pela integração</strong> até {pauseEnd(conv.ai_paused_until!)}. O sistema integrado responde esta conversa; a equipe não é avisada.</span>
          {onResumeAi && <ActionForm action={onResumeAi}><SubmitButton pendingLabel="Devolvendo…" className="btn-ghost py-1.5">Devolver para a IA</SubmitButton></ActionForm>}
          <ActionForm action={onTakeOver}><SubmitButton pendingLabel="Assumindo…" className="btn-dark py-1.5">Assumir</SubmitButton></ActionForm>
        </div>
      ) : waiting ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-[#efd9a9] bg-amber-soft px-3 py-2 text-sm">
          <Headset size={16} className="shrink-0 text-amber-ink" />
          <span className="min-w-0 flex-1 text-amber-ink"><strong>{who} pediu para falar com alguém</strong> {relativeTime(conv.handoff_requested_at!)}. Assuma para responder por aqui.</span>
          <ActionForm action={onTakeOver}><SubmitButton pendingLabel="Assumindo…" className="btn-dark py-1.5">Assumir conversa</SubmitButton></ActionForm>
        </div>
      ) : (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-brand">
          <Headset size={14} className="shrink-0" />
          {holderView(conv, meId) === "mine" ? "Atendimento humano com você" : conv.assigned_to_name ? `Atendimento humano com ${conv.assigned_to_name}` : "Atendimento humano em andamento"}: o assistente pausou nesta conversa.
        </p>
      )}
      <p className="text-xs"><VisitorPresence conv={conv} /></p>
    </>
  );
}

/** Caixa de resposta e botões de assumir/encerrar. Vai embaixo da conversa. */
export function HandoffReply({ conv, meId, onTakeOver, onForceTakeOver, onSend, onRelease, docked = false, paymentCheck = false }: {
  conv: HandoffConversation;
  /** id de quem vê a tela como atendente (agency_members ou client_members) */
  meId: string;
  onTakeOver: () => Promise<ActionResult>;
  /** "Assumir no lugar" de quem está atendendo */
  onForceTakeOver: () => Promise<ActionResult>;
  onSend: (fd: FormData) => Promise<ActionResult>;
  onRelease: () => Promise<ActionResult>;
  /** já está num rodapé fixo (tela de chat do painel): sem borda nem sticky próprios */
  docked?: boolean;
  /** conversa com bebida ou remédio: pergunta antes de mandar instrução de pagamento */
  paymentCheck?: boolean;
}) {
  const open = !conv.handled_at;
  const active = open && Boolean(conv.takeover_at);
  const waiting = open && !conv.takeover_at && Boolean(conv.handoff_requested_at);
  // só quem está com a conversa vê a caixa de resposta; os outros, o histórico e "Assumir no lugar"
  if (active && holderView(conv, meId) === "other") {
    const name = conv.assigned_to_name ?? "outra pessoa";
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">{name} está atendendo. Só quem atende responde por aqui.</span>
        <ConfirmAction
          action={onForceTakeOver}
          title={`Assumir no lugar de ${name}?`}
          description={`${name} deixa de responder esta conversa. A sua primeira mensagem sai com o anúncio de entrada com o seu nome. Fica registrado na auditoria.`}
          confirmLabel="Assumir no lugar"
          danger={false}
          className="btn-ghost"
        >
          <Headset size={15} />
          Assumir no lugar
        </ConfirmAction>
      </div>
    );
  }
  return (
    <>
      {active ? (
        <div className={docked ? "flex flex-col gap-2" : "sticky bottom-0 flex flex-col gap-2 border-t border-line bg-ground py-3"}>
          <AgentReplyForm action={onSend} paymentCheck={paymentCheck} />
          <ActionForm action={onRelease} className="self-end">
            <SubmitButton pendingLabel="Encerrando…" className="text-xs font-semibold text-muted hover:underline">Encerrar atendimento e devolver ao assistente</SubmitButton>
          </ActionForm>
        </div>
      ) : (
        !waiting && !apiPaused(conv) && canTakeOver(conv) && (
          <ActionForm action={onTakeOver} className="self-start">
            <SubmitButton pendingLabel="Assumindo…" className="btn-ghost"><Headset size={15} />Assumir esta conversa</SubmitButton>
          </ActionForm>
        )
      )}
      {conv.handled_at && conv.handoff_requested_at && <p className="text-xs text-muted">Atendimento humano encerrado {relativeTime(conv.handled_at)}.{canTakeOver(conv) ? " Você pode assumir de novo quando quiser." : ""}</p>}
    </>
  );
}
