"use client";

import { useState } from "react";
import { FileText } from "lucide-react";
import type { ActionResult } from "@/lib/action-result";
import type { SendableTemplate } from "@/lib/template-text";
import { Modal } from "@/components/ui/modal";
import { TemplateSender } from "@/components/template-sender";

/** Botão "Enviar modelo" do topo da conversa: abre o formulário de modelo num modal. */
export function TemplateModalButton({ templates, action, defaults, highlight = false }: {
  templates: SendableTemplate[];
  action: (fd: FormData) => Promise<ActionResult | void>;
  defaults?: string[];
  /** janela de 24 h fechada: o modelo é o único jeito de responder, então o botão ganha destaque */
  highlight?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={highlight ? "btn-primary" : "btn-ghost"}>
        <FileText size={15} />
        Enviar modelo
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Enviar modelo de mensagem" description="Modelos aprovados pela Meta podem ser enviados a qualquer momento, inclusive depois das 24 h.">
        <TemplateSender templates={templates} action={action} defaults={defaults} onSent={() => setOpen(false)} />
      </Modal>
    </>
  );
}
