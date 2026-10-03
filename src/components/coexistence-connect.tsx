"use client";

import { useState } from "react";
import type { ComponentProps } from "react";
import { AUTO_REPLIES_OFF, COEXISTENCE_CHANGES } from "@/lib/connect-checklist";
import { WhatsAppConnect } from "@/components/whatsapp-connect";

/**
 * Conectar o número que já está no app WhatsApp Business: antes, o que muda no app e a caixa
 * "já desliguei a saudação e a ausência" (fica registrada, sem bloquear a conexão).
 */
export function CoexistenceConnect(props: Omit<ComponentProps<typeof WhatsAppConnect>, "coexistence" | "autoRepliesOff">) {
  const [off, setOff] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg bg-ground px-3 py-2.5 text-sm">
        <div className="font-semibold">O que muda no seu app</div>
        <ul className="mt-1 ml-4 list-disc space-y-0.5 text-ink-2">
          {COEXISTENCE_CHANGES.map((c) => <li key={c}>{c}</li>)}
        </ul>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={off} onChange={(e) => setOff(e.target.checked)} className="mt-1" />
        <span>
          {AUTO_REPLIES_OFF}.
          <span className="block text-xs text-muted">Sem isso, o cliente recebe duas respostas: a do app e a do assistente. Dá para conectar mesmo assim e desligar depois.</span>
        </span>
      </label>
      <WhatsAppConnect {...props} coexistence autoRepliesOff={off} />
    </div>
  );
}
