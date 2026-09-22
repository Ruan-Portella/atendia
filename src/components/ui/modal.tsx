"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg";
}

/**
 * Modal em cima do <dialog> nativo: foco preso, Esc fecha, clique fora fecha,
 * acessível de graça. Estilo em globals.css (dialog.modal).
 */
export function Modal({ open, onClose, title, description, children, footer, size = "md" }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        // Esc: deixa o dono decidir (ex.: não fechar enquanto salva)
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className={cn("modal", size === "sm" ? "max-w-sm" : size === "lg" ? "max-w-2xl" : "max-w-md")}
    >
      <div className="flex flex-col gap-4 p-6">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="display text-lg font-bold leading-tight">{title}</h2>
            {description && <p className="mt-1 text-sm leading-relaxed text-muted">{description}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="btn-icon -mr-2 -mt-1">
            <X size={16} />
          </button>
        </div>
        {children}
        {footer && <div className="flex flex-wrap justify-end gap-2 pt-1">{footer}</div>}
      </div>
    </dialog>
  );
}

interface ConfirmModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  children?: React.ReactNode;
}

/** Pergunta "tem certeza?" com botão de confirmar (vermelho quando destrutivo). */
export function ConfirmModal({ open, onClose, onConfirm, title, description, confirmLabel = "Confirmar", cancelLabel = "Cancelar", danger, busy, children }: ConfirmModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className="btn-ghost">{cancelLabel}</button>
          <button type="button" onClick={onConfirm} disabled={busy} autoFocus className={danger ? "btn-danger-solid" : "btn-primary"}>
            {busy ? "Aguarde…" : confirmLabel}
          </button>
        </>
      }
    >
      {children}
    </Modal>
  );
}
