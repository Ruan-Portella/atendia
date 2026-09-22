"use client";

import { useState, useTransition } from "react";
import { Copy, ExternalLink, Pencil, Trash2, Code2, MessageSquare } from "lucide-react";
import type { ActionResult } from "@/lib/action-result";
import { Menu } from "@/components/ui/menu";
import { ConfirmModal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";

interface Props {
  bot: { id: string; name: string; client_name: string; is_demo: boolean; status: string };
  demoUrl: string | null;
  embedSnippet: string | null;
  whatsappUrl: string | null;
  onDelete: () => Promise<ActionResult | void>;
}

/** Menu "…" de cada chatbot/demo na lista: editar, copiar, abrir, excluir (com modal). */
export function BotRowActions({ bot, demoUrl, embedSnippet, whatsappUrl, onDelete }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const toast = useToast();

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copiado.`);
    } catch {
      toast.error("Não consegui copiar. Abra o editor e copie de lá.");
    }
  }

  function remove() {
    start(async () => {
      const r = await onDelete();
      if (r && !r.ok) {
        toast.error(r.message);
        return;
      }
      setConfirming(false);
      toast.success(bot.is_demo ? "Demo excluída." : "Chatbot excluído.");
    });
  }

  return (
    <>
      <Menu
        items={[
          { label: "Editar", icon: Pencil, href: `/painel/bots/${bot.id}` },
          ...(demoUrl ? [{ label: "Abrir demo", icon: ExternalLink, href: demoUrl, external: true } as const, { label: "Copiar link da demo", icon: Copy, onSelect: () => copy(demoUrl, "Link") }] : []),
          ...(whatsappUrl ? [{ label: "Mandar no WhatsApp", icon: MessageSquare, href: whatsappUrl, external: true } as const] : []),
          ...(embedSnippet ? [{ label: "Copiar código de instalação", icon: Code2, onSelect: () => copy(embedSnippet, "Código") }] : []),
          { type: "separator" },
          { label: bot.is_demo ? "Excluir demo" : "Excluir chatbot", icon: Trash2, danger: true, onSelect: () => setConfirming(true) },
        ]}
      />
      <ConfirmModal
        open={confirming}
        onClose={() => !pending && setConfirming(false)}
        onConfirm={remove}
        busy={pending}
        danger
        title={bot.is_demo ? "Excluir esta demo?" : "Excluir este chatbot?"}
        description={
          <>
            <strong className="text-ink">{bot.is_demo ? bot.client_name : `${bot.name} · ${bot.client_name}`}</strong> será apagado com a base de conhecimento, as conversas e os leads.
            {bot.status === "live" && !bot.is_demo ? " O widget instalado no site do cliente para de responder na hora." : ""} Não tem desfazer.
          </>
        }
        confirmLabel="Excluir definitivamente"
      />
    </>
  );
}
