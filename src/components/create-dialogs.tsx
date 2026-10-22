"use client";

import { useEffect, useState } from "react";
import type { ActionResult } from "@/lib/action-result";
import type { ClientOption } from "@/lib/panel";
import { EditDialog } from "@/components/ui/setting-row";
import { ClientFields } from "@/components/client-fields";
import { NewBotFields } from "@/components/new-bot-fields";
import { useToast } from "@/components/ui/toast";

type Request = { kind: "cliente" } | { kind: "chatbot"; clientId?: string };
const EVENT = "bv-criar";

/**
 * Abre o modal de criar de qualquer lugar do painel: o "+" do menu, o Ctrl K e os botões da página do
 * cliente (redesenho, etapa 5). Quem escuta é o CreateDialogs, montado uma vez no layout.
 */
export function openCreate(kind: "cliente" | "chatbot", clientId?: string) {
  window.dispatchEvent(new CustomEvent<Request>(EVENT, { detail: kind === "cliente" ? { kind } : { kind, clientId } }));
}

/** Um botão que abre o modal de criar (para as telas do servidor, como a página do cliente). */
export function CreateButton({ kind, clientId, className, children }: { kind: "cliente" | "chatbot"; clientId?: string; className?: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={() => openCreate(kind, clientId)} className={className}>
      {children}
    </button>
  );
}

/**
 * Os modais de Novo cliente e Novo chatbot, uma vez no layout do painel. As actions redirecionam
 * para o que foi criado. Sem `createClient` (quem vê só alguns clientes), o pedido de cliente novo
 * vira o aviso de que é com um administrador.
 */
export function CreateDialogs({
  createClient,
  createBot,
  clients,
  suggestedName,
}: {
  createClient: ((fd: FormData) => Promise<ActionResult | void>) | null;
  createBot: (fd: FormData) => Promise<ActionResult | void>;
  clients: ClientOption[];
  suggestedName: string;
}) {
  const toast = useToast();
  const [open, setOpen] = useState<Request | null>(null);
  useEffect(() => {
    const listen = (e: Event) => {
      const req = (e as CustomEvent<Request>).detail;
      if (req.kind === "cliente" && !createClient) return toast.error("Criar cliente é para quem vê todos os clientes da agência. Peça para um administrador.");
      setOpen(req);
    };
    window.addEventListener(EVENT, listen);
    return () => window.removeEventListener(EVENT, listen);
  }, [createClient, toast]);
  const forClient = open?.kind === "chatbot" && open.clientId ? clients.find((c) => c.id === open.clientId) : null;

  return (
    <>
      {createClient && (
        <EditDialog open={open?.kind === "cliente"} onClose={() => setOpen(null)} title="Novo cliente" description="Depois você cria os chatbots dele na página do cliente." action={createClient} saveLabel="Criar cliente">
          <ClientFields />
        </EditDialog>
      )}
      <EditDialog
        open={open?.kind === "chatbot"}
        onClose={() => setOpen(null)}
        title={forClient ? `Novo chatbot para ${forClient.name}` : "Novo chatbot"}
        description="Um cliente pode ter vários chatbots (ex.: um para vendas e outro para suporte). O site e os documentos você adiciona no próximo passo."
        action={createBot}
        saveLabel="Criar e configurar"
      >
        <NewBotFields clients={clients} defaultClientId={open?.kind === "chatbot" ? open.clientId : undefined} suggestedName={suggestedName} idPrefix="cg" />
      </EditDialog>
    </>
  );
}
