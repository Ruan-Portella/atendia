"use client";

import { useState } from "react";
import { BadgeCheck } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { SubmitButton } from "@/components/ui/submit-button";

interface Props {
  action: (formData: FormData) => Promise<void>;
  clientName: string;
  assistantName: string;
  className?: string;
}

/** Botão "Converter em cliente" que abre um modal para confirmar nome, assistente e preço. */
export function ConvertDemo({ action, clientName, assistantName, className = "btn-dark py-1.5" }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        <BadgeCheck size={15} />
        Converter em cliente
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Fechou com o cliente?" description="A demo vira um chatbot publicado, com a base de conhecimento que já está pronta. O link de demo deixa de funcionar; você instala o widget no site dele.">
        <form action={action} className="flex flex-col gap-3">
          <div>
            <label htmlFor="cv-client" className="label">Nome do cliente</label>
            <input id="cv-client" name="client_name" defaultValue={clientName} required className="input" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="cv-name" className="label">Nome do assistente</label>
              <input id="cv-name" name="name" defaultValue={assistantName === "Assistente" ? "" : assistantName} placeholder="Sofia" className="input" />
            </div>
            <div>
              <label htmlFor="cv-price" className="label">Você cobra (R$/mês)</label>
              <input id="cv-price" name="price" type="number" min={0} step={10} placeholder="400" className="input" />
            </div>
          </div>
          <p className="text-xs text-muted">O preço é só para o seu controle no painel; o cliente final só vê a sua marca.</p>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Agora não</button>
            <SubmitButton pendingLabel="Convertendo…">Converter e publicar</SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}
