"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/action-result";
import { useToast } from "./toast";

interface Props {
  /** Server action já com os argumentos fixos aplicados (ex.: `updateBot.bind(null, id)`). */
  action: (formData: FormData) => Promise<ActionResult | void>;
  /** Mensagem do toast quando a action devolve ok sem mensagem própria. */
  success?: string;
  /** Chamado depois de um ok (ex.: fechar o modal). */
  onSuccess?: () => void;
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
 */
export function ActionForm({ action, success = "Salvo.", onSuccess, className, children }: Props) {
  const toast = useToast();
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
  return (
    <form action={formAction} className={className}>
      {children}
    </form>
  );
}
