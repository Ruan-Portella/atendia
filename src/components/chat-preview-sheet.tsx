"use client";

import { useState } from "react";
import { MessageCircle, X } from "lucide-react";

/**
 * Em telas menores que lg o painel do "teste ao vivo" não cabe ao lado do editor.
 * Este botão flutuante abre o chat em uma folha que ocupa a tela.
 * Os filhos (ChatWindow) só montam quando aberto, para não duplicar a conversa com o painel lateral.
 */
export function ChatPreviewSheet({ children, disabledReason }: { children: React.ReactNode; disabledReason?: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={Boolean(disabledReason)}
        title={disabledReason ?? undefined}
        className="btn-dark fixed bottom-4 right-4 z-40 shadow-[0_12px_32px_rgba(27,31,29,0.28)] lg:hidden"
      >
        <MessageCircle size={16} />
        Testar assistente
      </button>
      {open && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-ink/50 lg:hidden" role="dialog" aria-modal="true" aria-label="Teste ao vivo">
          <button type="button" aria-label="Fechar" onClick={() => setOpen(false)} className="flex-1" />
          <div className="menu-in flex h-[85dvh] flex-col overflow-hidden rounded-t-2xl bg-[#ecebe4] shadow-2xl sm:mx-auto sm:w-[440px] sm:rounded-2xl sm:mb-4">
            <div className="flex items-center justify-between px-4 py-2.5 text-xs">
              <span className="font-semibold uppercase tracking-[0.06em] text-muted">Teste ao vivo</span>
              <button type="button" onClick={() => setOpen(false)} aria-label="Fechar" className="btn-icon"><X size={16} /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden bg-white">{children}</div>
          </div>
        </div>
      )}
    </>
  );
}
