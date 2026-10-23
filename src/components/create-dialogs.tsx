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
 * vira o aviso de que é com um administrador. Com modelos (pacote Plataforma), o Novo chatbot também
 * começa de um modelo (`createDerived`).
 */
export function CreateDialogs({
  createClient,
  createBot,
  createDerived,
  templates = [],
  clients,
  suggestedName,
  business = false,
}: {
  createClient: ((fd: FormData) => Promise<ActionResult | void>) | null;
  createBot: (fd: FormData) => Promise<ActionResult | void>;
  createDerived?: (templateId: string, fd: FormData) => Promise<ActionResult | void>;
  templates?: Array<{ id: string; name: string }>;
  clients: ClientOption[];
  suggestedName: string;
  /** o perfil do negócio (23/10/2026): sem Novo cliente e sem escolher cliente no chatbot */
  business?: boolean;
}) {
  const toast = useToast();
  const [open, setOpen] = useState<Request | null>(null);
  useEffect(() => {
    const listen = (e: Event) => {
      const req = (e as CustomEvent<Request>).detail;
      if (req.kind === "cliente" && business) return toast.error("No perfil do seu negócio não há clientes para cadastrar: crie um chatbot.");
      if (req.kind === "cliente" && !createClient) return toast.error("Criar cliente é para quem vê todos os clientes da agência. Peça para um administrador.");
      setOpen(req);
    };
    window.addEventListener(EVENT, listen);
    // ?criar=cliente ou ?criar=chatbot (&cliente=…): as antigas páginas de criar e os links dos
    // primeiros passos abrem o mesmo modal (23/10/2026); o parâmetro sai do endereço
    const url = new URL(window.location.href);
    const kind = url.searchParams.get("criar");
    if (kind === "cliente" || kind === "chatbot") {
      const clientId = url.searchParams.get("cliente") ?? undefined;
      url.searchParams.delete("criar");
      url.searchParams.delete("cliente");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      window.setTimeout(() => openCreate(kind, clientId), 0);
    }
    return () => window.removeEventListener(EVENT, listen);
  }, [business, createClient, toast]);
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
        title={forClient && !business ? `Novo chatbot para ${forClient.name}` : "Novo chatbot"}
        description={business ? "O seu negócio pode ter vários chatbots (ex.: um para vendas e outro para suporte). O site e os documentos você adiciona no próximo passo." : "Um cliente pode ter vários chatbots (ex.: um para vendas e outro para suporte). O site e os documentos você adiciona no próximo passo."}
        action={(fd) => {
          // "A partir de um modelo": o derivado (o nome vem do modelo); senão, o chatbot em branco
          const template = String(fd.get("template_id") ?? "");
          return fd.get("start") === "modelo" && template && createDerived ? createDerived(template, fd) : createBot(fd);
        }}
        saveLabel="Criar e configurar"
      >
        <NewBotFields clients={clients} defaultClientId={open?.kind === "chatbot" ? open.clientId : undefined} suggestedName={suggestedName} idPrefix="cg" templates={createDerived ? templates : []} business={business} />
      </EditDialog>
    </>
  );
}
