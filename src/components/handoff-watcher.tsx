"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BellRing, Headset, X } from "lucide-react";
import { browserNotificationsSupported, signal } from "@/lib/attention";

interface PendingItem {
  id: string;
  href: string;
  title: string;
}

const DISMISS_KEY = "cw-notif-prompt-dismissed";

/**
 * Fica em todas as telas do painel: a cada 15 s pergunta se algum visitante pediu atendente.
 * Pedido novo → aviso na tela com link, som, contador na aba e notificação do navegador.
 * Também oferece (uma vez) ligar as notificações do navegador.
 */
export function HandoffWatcher({ endpoint }: { endpoint: string }) {
  const [alerts, setAlerts] = useState<PendingItem[]>([]);
  const [askPermission, setAskPermission] = useState(false);
  const known = useRef<Set<string> | null>(null);

  useEffect(() => {
    let stopped = false;
    async function check() {
      try {
        const res = await fetch(endpoint, { cache: "no-store" });
        if (!res.ok) return;
        const { items } = (await res.json()) as { items: PendingItem[] };
        if (stopped) return;
        const ids = new Set(items.map((i) => i.id));
        // primeira consulta só aprende o que já estava pendente (sem alarme ao abrir o painel)
        if (known.current) {
          const fresh = items.filter((i) => !known.current!.has(i.id));
          if (fresh.length) {
            setAlerts((a) => [...fresh, ...a.filter((x) => ids.has(x.id))].slice(0, 3));
            signal({ title: "Um visitante quer falar com alguém", body: fresh[0].title, href: fresh[0].href, tag: `handoff-${fresh[0].id}` });
          }
        }
        // some da tela quem já foi atendido
        setAlerts((a) => a.filter((x) => ids.has(x.id)));
        known.current = ids;
      } catch {
        // sem rede: tenta no próximo ciclo
      }
    }
    void check();
    const t = window.setInterval(check, 15_000);
    return () => {
      stopped = true;
      window.clearInterval(t);
    };
  }, [endpoint]);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      dismissed = true;
    }
    if (browserNotificationsSupported() && Notification.permission === "default" && !dismissed) {
      const t = window.setTimeout(() => setAskPermission(true), 4000);
      return () => window.clearTimeout(t);
    }
  }, []);

  function dismissPrompt() {
    setAskPermission(false);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // sem armazenamento: só esconde nesta visita
    }
  }

  if (!alerts.length && !askPermission) return null;
  return (
    <div className="fixed bottom-4 left-4 z-[65] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
      {alerts.map((a) => (
        <div key={a.id} role="alert" className="toast-in flex items-start gap-3 rounded-xl border border-[#efd9a9] bg-amber-soft px-4 py-3 text-sm shadow-[0_12px_32px_rgba(27,31,29,0.16)]">
          <Headset size={18} className="mt-0.5 shrink-0 text-amber-ink" />
          <span className="min-w-0 flex-1">
            <strong className="block text-amber-ink">Um visitante quer falar com alguém</strong>
            <span className="block truncate text-ink-2">{a.title}</span>
            <Link href={a.href} onClick={() => setAlerts((x) => x.filter((i) => i.id !== a.id))} className="mt-1 inline-block font-semibold text-amber-ink underline">Responder agora</Link>
          </span>
          <button type="button" onClick={() => setAlerts((x) => x.filter((i) => i.id !== a.id))} aria-label="Fechar aviso" className="shrink-0 rounded p-0.5 text-amber-ink/70 hover:text-amber-ink"><X size={15} /></button>
        </div>
      ))}
      {askPermission && (
        <div className="toast-in flex items-start gap-3 rounded-xl border border-line bg-panel px-4 py-3 text-sm shadow-[0_12px_32px_rgba(27,31,29,0.16)]">
          <BellRing size={18} className="mt-0.5 shrink-0 text-brand" />
          <span className="min-w-0 flex-1">
            <strong className="block">Avisar no navegador?</strong>
            <span className="block text-muted">Quando um visitante pedir atendimento, você recebe um aviso mesmo com esta aba minimizada.</span>
            <span className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={async () => {
                  await Notification.requestPermission().catch(() => "denied");
                  dismissPrompt();
                }}
                className="btn-primary py-1.5 text-xs"
              >
                Ativar avisos
              </button>
              <button type="button" onClick={dismissPrompt} className="btn-ghost py-1.5 text-xs">Agora não</button>
            </span>
          </span>
        </div>
      )}
    </div>
  );
}
