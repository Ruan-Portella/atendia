"use client";

import { useState } from "react";
import { CirclePause } from "lucide-react";
import type { ActionResult } from "@/lib/action-result";
import { Modal } from "@/components/ui/modal";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";

/** Botão de emergência do chatbot: pausa a IA em todos os canais, com motivo e aviso opcional. */
export function BotPauseButton({ action, className = "btn-ghost" }: { action: (formData: FormData) => Promise<ActionResult>; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        <CirclePause size={15} />
        Pausar a IA
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Pausar a IA deste chatbot?"
        description="Para emergências: o assistente para de responder em todos os canais até você retomar. No WhatsApp e no Instagram, as mensagens ficam no painel como pedido de atendente; no site, aparece o formulário de contato."
      >
        <ActionForm action={action} onSuccess={() => setOpen(false)} className="flex flex-col gap-3">
          <div>
            <label htmlFor="pause-reason" className="label">Motivo (opcional, só a sua equipe vê)</label>
            <input id="pause-reason" name="reason" maxLength={200} placeholder="Ex.: preço errado na base, conferindo" className="input" />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="notify" className="mt-1" />
            <span>
              Avisar quem escrever no WhatsApp e no Instagram, uma vez por conversa:
              <span className="mt-0.5 block text-muted">&ldquo;Deixei sua mensagem registrada, e nossa equipe responde por aqui assim que possível.&rdquo;</span>
              <span className="mt-0.5 block text-xs text-muted">Sem marcar, o contato não recebe nada até alguém da equipe responder. Número no app do celular (coexistência) nunca recebe o aviso.</span>
            </span>
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancelar</button>
            <SubmitButton className="btn-danger" pendingLabel="Pausando…">Pausar a IA</SubmitButton>
          </div>
        </ActionForm>
      </Modal>
    </>
  );
}
