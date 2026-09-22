"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Recarrega os dados da página a cada `ms` enquanto a aba está visível (conversa ao vivo). */
export function AutoRefresh({ ms = 4000 }: { ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = window.setInterval(() => {
      if (!document.hidden) router.refresh();
    }, ms);
    return () => window.clearInterval(t);
  }, [router, ms]);
  return null;
}
