"use client";

import { useState } from "react";
import type { ActionResult } from "@/lib/action-result";
import { Modal } from "@/components/ui/modal";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";

/** "Isto não é {categoria}": pede ao BoaVoz para o portão deixar de tratar o item neste chatbot. */
export function GateReviewButton({ label, action }: { label: string; action: (formData: FormData) => Promise<ActionResult> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-xs font-semibold underline">
        isto não é {label}
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Pedir revisão: isto não é ${label}?`}
        description={`O assistente tratou algo desta conversa como ${label} (item restrito no WhatsApp e no Instagram). Se o negócio não vende isso, a equipe BoaVoz revisa e, aprovando, a regra deixa de valer só para este chatbot. Você recebe a resposta por e-mail.`}
      >
        <ActionForm action={action} onSuccess={() => setOpen(false)} className="flex flex-col gap-3">
          <div>
            <label htmlFor="gate-note" className="label">O que é, na verdade? (opcional)</label>
            <textarea id="gate-note" name="note" maxLength={500} rows={3} className="input" placeholder="Ex.: “vinho” aqui é o vinagre de vinho do cardápio, não vendemos bebida." />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancelar</button>
            <SubmitButton className="btn-primary" pendingLabel="Enviando…">Pedir revisão</SubmitButton>
          </div>
        </ActionForm>
      </Modal>
    </>
  );
}
