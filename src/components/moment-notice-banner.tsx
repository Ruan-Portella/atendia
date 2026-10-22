"use client";

import { useState, useSyncExternalStore } from "react";
import { ChevronDown, Megaphone, Pencil } from "lucide-react";
import type { ActionResult } from "@/lib/action-result";
import type { MomentNotice } from "@/lib/moment-notice";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { EditDialog } from "@/components/ui/setting-row";
import { MomentNoticeFields } from "@/components/moment-notice-card";
import { cn } from "@/lib/utils";

// minimizado ou não, por aviso, só neste navegador (sem o armazenamento, vale até recarregar)
const memory = new Map<string, string>();
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? memory.get(key) ?? "0";
  } catch {
    return memory.get(key) ?? "0";
  }
}
function write(key: string, value: string) {
  memory.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    // sem armazenamento (janela anônima, bloqueado): fica só na memória
  }
  listeners.forEach((l) => l());
}

/**
 * O aviso do momento no ar, no alto da Base de conhecimento (redesenho, etapa 5, a pedido do
 * usuário em 22/10): o texto, até quando vale, Editar e Tirar agora. Dá para minimizar numa linha;
 * um aviso novo volta aberto.
 */
export function MomentNoticeBanner({
  botId,
  notice,
  untilText,
  author,
  save,
  clear,
}: {
  botId: string;
  notice: MomentNotice;
  untilText: string;
  author: string | null;
  save: (formData: FormData) => Promise<ActionResult>;
  clear: () => Promise<ActionResult>;
}) {
  const key = `bv-aviso-min:${botId}:${notice.until}:${notice.text.length}`;
  const min = useSyncExternalStore(subscribe, () => read(key) === "1", () => false);
  const [editing, setEditing] = useState(false);

  return (
    <section className="rise-in overflow-hidden rounded-[16px] border border-brand/35 bg-brand-soft/50">
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-brand text-on-brand">
          <Megaphone size={17} />
        </span>
        <button type="button" onClick={() => write(key, min ? "0" : "1")} className="min-w-0 flex-1 text-left">
          <span className="block text-[13px] font-medium text-brand">
            Aviso do momento no ar · até {untilText}
            {author ? `, escrito ${author}` : ""}
          </span>
          {min && <span className="block truncate text-sm text-ink">{notice.text}</span>}
        </button>
        <button type="button" onClick={() => write(key, min ? "0" : "1")} aria-expanded={!min} aria-label={min ? "Mostrar o aviso" : "Minimizar o aviso"} className="btn-icon shrink-0">
          <ChevronDown size={16} className={cn("transition-transform duration-[220ms]", !min && "rotate-180")} />
        </button>
      </div>
      {!min && (
        <div className="flex flex-col gap-3 px-4 pb-4 sm:pl-[64px]">
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink">{notice.text}</p>
          <p className="text-xs text-muted">O assistente usa quando alguém pergunta ou o assunto tem a ver. Some sozinho no fim do prazo.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setEditing(true)} className="btn-ghost py-1.5 text-[13px]">
              <Pencil size={14} />
              Editar
            </button>
            <ConfirmAction action={clear} title="Tirar o aviso agora?" description="O assistente deixa de usar o aviso a partir da próxima mensagem." confirmLabel="Tirar o aviso" className="btn-ghost py-1.5 text-[13px] text-danger">
              Tirar agora
            </ConfirmAction>
          </div>
        </div>
      )}
      <EditDialog open={editing} onClose={() => setEditing(false)} title="Aviso do momento" description="Um recado com prazo: instabilidade, manutenção, atraso, mudança de horário." action={save} saveLabel="Salvar aviso">
        <MomentNoticeFields notice={notice} defaultUntil={notice.until} />
      </EditDialog>
    </section>
  );
}
