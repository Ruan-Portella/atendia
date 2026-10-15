import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DocsShell } from "@/components/docs/doc";

/*
 * Documentação pública das Integrações (C pública, parte 6; spec "Documentação pública"): aberta
 * sem login, só no domínio do BoaVoz (no domínio da agência o proxy mostra a página neutra).
 */
export const metadata: Metadata = {
  title: { default: "Documentação", template: "%s · Documentação BoaVoz" },
  description: "Como ligar o assistente do BoaVoz ao seu sistema: ações, mensagens ricas, webhooks e API.",
};

export default function DocsLayout({ children }: { children: ReactNode }) {
  return <DocsShell>{children}</DocsShell>;
}
