"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  pendingLabel?: string;
}

/** Botão de submit que mostra "Salvando…" enquanto a server action roda. Use dentro de um <form>. */
export function SubmitButton({ children, pendingLabel = "Salvando…", className = "btn-primary", disabled, ...rest }: Props) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || disabled} aria-busy={pending} className={cn(className)} {...rest}>
      {pending && <Loader2 size={15} className="animate-spin" />}
      {pending ? pendingLabel : children}
    </button>
  );
}
