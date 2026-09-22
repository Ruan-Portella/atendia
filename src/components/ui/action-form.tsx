"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/action-result";
import { useToast } from "./toast";

interface Props {
  /** Server action já com os argumentos fixos aplicados (ex.: `updateBot.bind(null, id)`). */
  action: (formData: FormData) => Promise<ActionResult>;
  /** Mensagem do toast quando a action devolve ok sem mensagem própria. */
  success?: string;
  className?: string;
  children: React.ReactNode;
}

/**
 * <form> que chama a server action e mostra um toast de sucesso ou erro.
 * Os campos continuam sendo HTML puro; só o feedback muda.
 */
export function ActionForm({ action, success = "Salvo.", className, children }: Props) {
  const toast = useToast();
  const [, formAction] = useActionState(async (_prev: ActionResult | null, fd: FormData) => {
    const r = await action(fd);
    if (r.ok) toast.success(r.message ?? success);
    else toast.error(r.message);
    return r;
  }, null);
  return (
    <form action={formAction} className={className}>
      {children}
    </form>
  );
}
