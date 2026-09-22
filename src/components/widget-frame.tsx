"use client";

import { useEffect } from "react";

/** Envelope do chat dentro do iframe: ocupa a tela toda e avisa o script pai para fechar. */
export function WidgetFrame({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    document.documentElement.style.height = "100%";
    document.body.style.height = "100%";
    document.body.style.background = "transparent";
  }, []);
  return (
    <div className="h-dvh w-full overflow-hidden bg-white">
      <div className="h-full">{children}</div>
    </div>
  );
}
