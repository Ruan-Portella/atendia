"use client";

import { useState } from "react";
import type { ActionResult } from "@/lib/action-result";
import { Modal } from "@/components/ui/modal";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";

interface Props {
  question: string;
  answer: (formData: FormData) => Promise<ActionResult>;
  dismiss: (formData: FormData) => Promise<ActionResult>;
  /** Aprendizado (D', parte 6): a resposta que a equipe deu na conversa, como rascunho para a base. */
  suggestion?: { question: string; answer: string } | null;
  suggestedBy?: string | null;
}

/** Pergunta que o assistente não soube: responder aqui (vira FAQ), aprovar a sugestão da conversa ou ignorar. */
export function UnansweredItem({ question, answer, dismiss, suggestion, suggestedBy }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm text-ink-2">
      <span className="min-w-0 flex-1">“{question}”</span>
      <span className="flex items-center gap-3">
        <button type="button" onClick={() => setOpen(true)} className="text-xs font-semibold text-brand hover:underline">{suggestion ? "Editar e responder" : "Responder"}</button>
        <ActionForm action={dismiss} success="Pergunta ignorada."><SubmitButton pendingLabel="…" className="text-xs font-semibold text-muted hover:underline disabled:opacity-50">Ignorar</SubmitButton></ActionForm>
      </span>
      {suggestion && (
        <div className="flex w-full flex-col gap-1 rounded-lg border border-line bg-panel px-3 py-2 text-xs">
          <span className="font-semibold text-ink">Sugestão a partir da resposta de {suggestedBy ?? "alguém da equipe"} na conversa</span>
          <span><span className="font-semibold">P:</span> {suggestion.question}</span>
          <span className="whitespace-pre-line"><span className="font-semibold">R:</span> {suggestion.answer}</span>
          <ActionForm action={answer} className="self-start">
            <input type="hidden" name="question" value={suggestion.question} />
            <input type="hidden" name="answer" value={suggestion.answer} />
            <SubmitButton pendingLabel="Treinando…" className="text-xs font-semibold text-brand hover:underline disabled:opacity-50">Aprovar e pôr na base</SubmitButton>
          </ActionForm>
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Ensinar o assistente" description="A resposta entra na base de conhecimento (FAQ “Respostas do painel”) e vale na próxima conversa.">
        <ActionForm action={answer} onSuccess={() => setOpen(false)} className="flex flex-col gap-3">
          <div>
            <label htmlFor="ua-q" className="label">Pergunta do visitante</label>
            <input id="ua-q" name="question" required minLength={3} maxLength={500} defaultValue={suggestion?.question ?? question} className="input" />
          </div>
          <div>
            <label htmlFor="ua-a" className="label">Resposta</label>
            <textarea id="ua-a" name="answer" required minLength={2} maxLength={3000} rows={5} defaultValue={suggestion?.answer ?? ""} className="input" placeholder="Ex.: Sim, aceitamos Unimed para consultas e limpeza." />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancelar</button>
            <SubmitButton pendingLabel="Treinando…">Salvar resposta</SubmitButton>
          </div>
        </ActionForm>
      </Modal>
    </div>
  );
}
