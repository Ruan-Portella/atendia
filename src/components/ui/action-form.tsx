"use client";

import { useActionState, useRef, useState } from "react";
import type { ActionResult } from "@/lib/action-result";
import { liveValidation, validateForm } from "./form-errors";
import { ConfirmModal } from "./modal";
import { useToast } from "./toast";

/** Pergunta "tem certeza?" antes de enviar, no próprio sistema (nunca a janela do navegador). */
export interface ConfirmAsk {
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}

interface Props {
  /** Server action já com os argumentos fixos aplicados (ex.: `updateBot.bind(null, id)`). */
  action: (formData: FormData) => Promise<ActionResult | void>;
  /** Mensagem do toast quando a action devolve ok sem mensagem própria. */
  success?: string;
  /** Chamado depois de um ok (ex.: fechar o modal). */
  onSuccess?: () => void;
  /** Antes de enviar; preventDefault() segura o envio. */
  onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void;
  /** Confirmação antes de enviar (recebe o botão que enviou); null deixa seguir direto. */
  confirm?: (submitter: HTMLButtonElement | null) => ConfirmAsk | null;
  className?: string;
  children: React.ReactNode;
}

function isNextControlError(err: unknown) {
  const digest = (err as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK") || digest === "NEXT_NOT_FOUND");
}

/**
 * <form> que chama a server action e mostra um toast de sucesso ou erro.
 * Os campos continuam sendo HTML puro; só o feedback muda. Nunca deixa um erro da action
 * derrubar a página: vira toast.
 * Validação (redesenho, etapa 1): as regras são as do próprio campo (required, type, min,
 * pattern…); o erro aparece embaixo dele, ao enviar e depois ao sair do campo, e some ao corrigir.
 */
export function ActionForm({ action, success = "Salvo.", onSuccess, onSubmit, confirm, className, children }: Props) {
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const confirmed = useRef(false);
  const [ask, setAsk] = useState<{ q: ConfirmAsk; submitter: HTMLButtonElement | null } | null>(null);
  const [, formAction] = useActionState(async (_prev: ActionResult | null, fd: FormData) => {
    let r: ActionResult | void;
    try {
      r = await action(fd);
    } catch (err) {
      // redirect() da action chega aqui como erro de controle do Next: deixa seguir.
      if (isNextControlError(err)) throw err;
      toast.error("Não foi possível concluir agora. Verifique a conexão e tente de novo.");
      return null;
    }
    if (!r) return null; // a action redirecionou
    if (r.ok) {
      toast.success(r.message ?? success);
      onSuccess?.();
    } else toast.error(r.message);
    return r;
  }, null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    const form = e.currentTarget;
    const submitter = ((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null) ?? null;
    if (!validateForm(form, submitter)) {
      e.preventDefault();
      return;
    }
    if (confirm && !confirmed.current) {
      const q = confirm(submitter);
      if (q) {
        e.preventDefault();
        setAsk({ q, submitter });
        return;
      }
    }
    confirmed.current = false;
    onSubmit?.(e);
  }

  return (
    <>
      <form ref={formRef} action={formAction} onSubmit={handleSubmit} noValidate {...liveValidation} className={className}>
        {children}
      </form>
      {confirm && (
        <ConfirmModal
          open={Boolean(ask)}
          onClose={() => setAsk(null)}
          onConfirm={() => {
            const pending = ask;
            setAsk(null);
            confirmed.current = true;
            formRef.current?.requestSubmit(pending?.submitter ?? undefined);
          }}
          title={ask?.q.title ?? ""}
          description={ask?.q.description}
          confirmLabel={ask?.q.confirmLabel}
          danger={ask?.q.danger}
        />
      )}
    </>
  );
}
