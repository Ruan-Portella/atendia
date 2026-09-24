"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

type SyncResult = { ok: true; processed: number; conversations?: number; recentMessages?: number; newestConversationAt?: string | null } | { ok: false; message: string };

/**
 * Busca as DMs novas do Instagram a cada poucos segundos enquanto a página está aberta (e visível).
 * É a reserva do webhook: com o app ainda não publicado na Meta, é por aqui que as DMs chegam.
 * `visible`: mostra o status e o botão "Buscar agora" (aba Instagram); sem ele, roda escondido.
 */
export function InstagramPoller({ action, intervalMs = 15_000, visible = false }: { action: () => Promise<SyncResult>; intervalMs?: number; visible?: boolean }) {
  const router = useRouter();
  const busy = useRef(false);
  const [last, setLast] = useState<{ at: Date; processed: number; error?: string; detail?: string } | null>(null);
  const [running, setRunning] = useState(false);

  const run = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setRunning(true);
    try {
      const r = await action();
      if (r.ok) {
        // o que a API trouxe: ajuda a entender um "nada novo"
        const newest = r.newestConversationAt ? new Date(r.newestConversationAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : null;
        const detail = r.conversations === undefined ? undefined : `${r.conversations} conversa${r.conversations === 1 ? "" : "s"} na conta${newest ? `, a mais recente em ${newest}` : ""}; ${r.recentMessages ?? 0} mensage${r.recentMessages === 1 ? "m" : "ns"} desde a última busca`;
        setLast({ at: new Date(), processed: r.processed, detail });
        if (r.processed) router.refresh();
      } else setLast({ at: new Date(), processed: 0, error: r.message });
    } catch {
      setLast({ at: new Date(), processed: 0, error: "Sem conexão com o servidor." });
    } finally {
      busy.current = false;
      setRunning(false);
    }
  }, [action, router]);

  useEffect(() => {
    // a primeira busca logo ao abrir; depois, a cada intervalo com a página visível
    const first = window.setTimeout(() => void run(), 0);
    const t = window.setInterval(() => {
      if (!document.hidden) void run();
    }, intervalMs);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(t);
    };
  }, [run, intervalMs]);

  if (!visible) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
      <button type="button" onClick={() => void run()} disabled={running} className="btn-ghost py-1.5 text-xs">
        <RefreshCw size={13} className={running ? "animate-spin" : ""} />
        Buscar mensagens agora
      </button>
      {last?.error ? (
        <span className="text-danger">{last.error}</span>
      ) : last ? (
        <span>
          Última busca às {last.at.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          {last.processed ? ` · ${last.processed} mensage${last.processed === 1 ? "m nova" : "ns novas"}` : " · nada novo"}
          {last.detail ? ` (${last.detail})` : ""}. Busca sozinha a cada {Math.round(intervalMs / 1000)} s enquanto esta página estiver aberta.
        </span>
      ) : (
        <span>Buscando mensagens…</span>
      )}
    </div>
  );
}
