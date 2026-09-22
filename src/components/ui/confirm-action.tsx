"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/action-result";
import { ConfirmModal } from "./modal";
import { useToast } from "./toast";

interface Props {
  /** Server action sem argumentos livres (ex.: `deleteBot.bind(null, id, "/painel/clientes")`). */
  action: () => Promise<ActionResult | void>;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  successMessage?: string;
  danger?: boolean;
  className?: string;
  disabled?: boolean;
  children: React.ReactNode;
}

/** Botão que abre um modal "tem certeza?" e só então executa a server action. */
export function ConfirmAction({ action, title, description, confirmLabel = "Confirmar", successMessage, danger = true, className = "btn-danger", disabled, children }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const toast = useToast();

  function confirm() {
    start(async () => {
      const r = await action();
      if (r && !r.ok) {
        toast.error(r.message);
        return;
      }
      setOpen(false);
      const msg = successMessage ?? (r && r.ok ? r.message : undefined);
      if (msg) toast.success(msg);
    });
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} disabled={disabled} className={className}>{children}</button>
      <ConfirmModal open={open} onClose={() => setOpen(false)} onConfirm={confirm} title={title} description={description} confirmLabel={confirmLabel} danger={danger} busy={pending} />
    </>
  );
}
