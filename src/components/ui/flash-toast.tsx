"use client";

import { useEffect, useRef } from "react";
import { useToast } from "./toast";

/**
 * Um aviso que aparece uma vez ao abrir a tela (ex.: a volta da Stripe com ?ok=1), no lugar de uma
 * faixa fixa no alto.
 */
export function FlashToast({ message }: { message: string }) {
  const toast = useToast();
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    toast.success(message);
  }, [message, toast]);
  return null;
}
