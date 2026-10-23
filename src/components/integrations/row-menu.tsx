"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Menu } from "@/components/ui/menu";
import { ConfirmModal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import type { ActionResult } from "@/lib/action-result";

export interface RowMenuItem {
  label: string;
  hint?: string;
  danger?: boolean;
  /** pergunta antes de rodar */
  confirm?: { title: string; description: string; confirmLabel: string; danger?: boolean };
  /** a server action já com os argumentos (bind no servidor) */
  run: () => Promise<ActionResult>;
}

/**
 * O "…" de uma linha cujas ações são server actions (redesenho, etapa 5): cada item roda a action,
 * pergunta antes quando tem `confirm`, mostra o aviso e atualiza a tela. Serve às páginas do
 * servidor, que não montam o Menu sozinhas.
 */
export function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, start] = useTransition();
  const [ask, setAsk] = useState<RowMenuItem | null>(null);
  const run = (it: RowMenuItem) =>
    start(async () => {
      try {
        const r = await it.run();
        if (!r.ok) return toast.error(r.message);
        if (r.message) toast.success(r.message);
        setAsk(null);
        router.refresh();
      } catch {
        toast.error("Não foi possível concluir agora. Tente de novo.");
      }
    });
  return (
    <>
      <Menu label={label} items={items.map((it) => ({ label: it.label, hint: it.hint, danger: it.danger, onSelect: () => (it.confirm ? setAsk(it) : run(it)) }))} />
      <ConfirmModal open={Boolean(ask)} onClose={() => setAsk(null)} onConfirm={() => ask && run(ask)} title={ask?.confirm?.title ?? ""} description={ask?.confirm?.description} confirmLabel={ask?.confirm?.confirmLabel} danger={ask?.confirm?.danger ?? ask?.danger} busy={busy} />
    </>
  );
}
