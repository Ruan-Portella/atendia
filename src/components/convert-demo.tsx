"use client";

import { useState } from "react";
import { BadgeCheck } from "lucide-react";
import type { ActionResult } from "@/lib/action-result";
import type { ClientOption } from "@/lib/panel";
import { Modal } from "@/components/ui/modal";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { ClientPicker } from "@/components/client-picker";

interface Props {
  action: (formData: FormData) => Promise<ActionResult>;
  clients: ClientOption[];
  clientName: string;
  assistantName: string;
  className?: string;
}

/** Botão "Converter em cliente" que abre um modal para escolher/criar o cliente e o assistente. */
export function ConvertDemo({ action, clients, clientName, assistantName, className = "btn-dark py-1.5" }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        <BadgeCheck size={15} />
        Converter em cliente
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Fechou com o cliente?" description="A demo vira um chatbot publicado, com a base de conhecimento que já está pronta. O link de demo deixa de funcionar; você instala o widget no site dele.">
        <ActionForm action={action} className="flex flex-col gap-3">
          <ClientPicker clients={clients} defaultClientId={null} suggestedName={clientName} idPrefix="cv" />
          <div>
            <label htmlFor="cv-name" className="label">Nome do assistente</label>
            <input id="cv-name" name="name" minLength={2} maxLength={40} defaultValue={assistantName === "Assistente" ? "" : assistantName} placeholder="Sofia" className="input" />
          </div>
          <p className="text-xs text-muted">O preço é só para o seu controle no painel; o cliente final só vê a sua marca.</p>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Agora não</button>
            <SubmitButton pendingLabel="Convertendo…">Converter e publicar</SubmitButton>
          </div>
        </ActionForm>
      </Modal>
    </>
  );
}
