"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Maximize2, RotateCcw, Trash2 } from "lucide-react";
import type { ActionResult } from "@/lib/action-result";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { ConfirmModal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";

interface Props {
  /** Abrir a conversa em tela cheia (na Caixa de entrada). */
  fullHref?: string | null;
  /** Zerar a confirmação de 18+: o que a pessoa disse (vai na pergunta). */
  resetAge?: { action: () => Promise<ActionResult | void>; description: string } | null;
  /** Excluir a conversa (quem configura). */
  remove?: (() => Promise<ActionResult | void>) | null;
}

/**
 * O "…" do cabeçalho da conversa (redesenho, etapa 2): o que se usa pouco sai do topo. Zerar o
 * 18+ e excluir pedem confirmação no próprio sistema.
 */
export function ConversationMenu({ fullHref, resetAge, remove }: Props) {
  const [ask, setAsk] = useState<"idade" | "excluir" | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const items: MenuItem[] = [
    ...(fullHref ? [{ label: "Abrir em tela cheia", icon: Maximize2, onSelect: () => router.push(fullHref) }] : []),
    ...(resetAge ? [{ label: "Zerar a confirmação de 18+", icon: RotateCcw, onSelect: () => setAsk("idade") }] : []),
    ...(remove ? [{ type: "separator" as const }, { label: "Excluir a conversa", icon: Trash2, danger: true, onSelect: () => setAsk("excluir") }] : []),
  ];
  if (!items.length) return null;
  const run = (action: () => Promise<ActionResult | void>, ok: string) =>
    start(async () => {
      const r = await action();
      if (r && !r.ok) return toast.error(r.message);
      setAsk(null);
      toast.success(r && r.ok && r.message ? r.message : ok);
    });
  return (
    <>
      <Menu items={items} label="Mais ações da conversa" />
      {resetAge && (
        <ConfirmModal open={ask === "idade"} onClose={() => setAsk(null)} onConfirm={() => run(resetAge.action, "Confirmação de 18+ zerada.")} title="Zerar a confirmação de 18+?" description={resetAge.description} confirmLabel="Zerar 18+" busy={pending} />
      )}
      {remove && (
        <ConfirmModal
          open={ask === "excluir"}
          onClose={() => setAsk(null)}
          onConfirm={() => run(remove, "Conversa excluída.")}
          title="Excluir esta conversa?"
          description="As mensagens e os contatos capturados nela são apagados de vez (ex.: a pessoa pediu para apagar os dados dela). Não tem desfazer."
          confirmLabel="Excluir conversa"
          danger
          busy={pending}
        />
      )}
    </>
  );
}
