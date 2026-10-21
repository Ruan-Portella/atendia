"use client";

import { useRef, useState } from "react";
import type { ActionResult } from "@/lib/action-result";
import { mentionsPayment } from "@/lib/gate/payment";
import { renderQuickReply, type QuickReply } from "@/lib/quick-replies";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";

/**
 * Resposta da equipe na conversa. Numa conversa com bebida ou remédio (paymentCheck), se o texto
 * fala de Pix, boleto ou link de pagamento, pergunta antes de enviar, sem bloquear. As respostas
 * prontas do cliente (Caixa de entrada, parte 4) entram no campo com {nome} e {atendente} trocados,
 * para a pessoa revisar antes de enviar.
 */
export function AgentReplyForm({ action, paymentCheck = false, quickReplies = [], contactName = null, attendantName = "" }: { action: (fd: FormData) => Promise<ActionResult>; paymentCheck?: boolean; quickReplies?: QuickReply[]; contactName?: string | null; attendantName?: string }) {
  const [asking, setAsking] = useState(false);
  const confirmed = useRef(false);
  const field = useRef<HTMLTextAreaElement>(null);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    if (!paymentCheck || confirmed.current) {
      confirmed.current = false;
      setAsking(false);
      return;
    }
    if (mentionsPayment(field.current?.value ?? "")) {
      e.preventDefault();
      setAsking(true);
    }
  };

  const insert = (id: string) => {
    const reply = quickReplies.find((q) => q.id === id);
    const el = field.current;
    if (!reply || !el) return;
    const text = renderQuickReply(reply.body, { contact: contactName, attendant: attendantName });
    el.value = el.value.trim() ? `${el.value.trimEnd()}\n${text}` : text;
    el.focus();
  };

  return (
    <div className="flex flex-col gap-2">
      {quickReplies.length > 0 && (
        <label className="flex items-center gap-2 self-start text-xs text-muted">
          <span className="sr-only">Respostas prontas</span>
          <select value="" onChange={(e) => insert(e.target.value)} className="input w-auto py-1 text-xs">
            <option value="">Respostas prontas…</option>
            {quickReplies.map((q) => <option key={q.id} value={q.id}>{q.title}</option>)}
          </select>
        </label>
      )}
      {asking && (
        <div role="alert" className="rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink">
          <strong>Este pagamento inclui bebida ou remédio?</strong> Se sim, mande o link do site (ou ofereça telefone, retirada ou o chat do site) em vez de Pix ou link de pagamento por aqui.
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="btn-ghost py-1 text-xs" onClick={() => (setAsking(false), field.current?.focus())}>
              Voltar e editar
            </button>
            <button
              type="button"
              className="btn-dark py-1 text-xs"
              onClick={() => {
                confirmed.current = true;
                field.current?.form?.requestSubmit();
              }}
            >
              Não inclui, enviar
            </button>
          </div>
        </div>
      )}
      <ActionForm action={action} onSubmit={onSubmit} className="flex items-end gap-2">
        <label htmlFor="agent-msg" className="sr-only">Sua resposta</label>
        <textarea ref={field} id="agent-msg" name="content" required maxLength={2000} rows={2} className="input flex-1 resize-y" placeholder="Escreva sua resposta para o visitante…" />
        <SubmitButton pendingLabel="Enviando…" className="btn-primary">Enviar</SubmitButton>
      </ActionForm>
    </div>
  );
}
