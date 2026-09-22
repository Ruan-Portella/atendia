import Link from "next/link";
import { Headset } from "lucide-react";
import type { PendingHandoff } from "@/lib/panel";
import { relativeTime } from "@/lib/utils";

/** Faixa "visitantes esperando atendente" com atalho para cada conversa. */
export function PendingHandoffs({ items, showClient = true }: { items: PendingHandoff[]; showClient?: boolean }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[#efd9a9] bg-amber-soft px-4 py-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-amber-ink">
        <Headset size={17} />
        {items.length === 1 ? "1 visitante quer falar com alguém" : `${items.length} visitantes querem falar com alguém`}
      </div>
      <div className="flex flex-col">
        {items.slice(0, 5).map((h) => (
          <Link key={h.id} href={`/painel/bots/${h.bot_id}/conversas/${h.id}`} className="flex flex-wrap items-center gap-x-2 rounded-lg px-1 py-1.5 text-sm text-ink-2 hover:bg-white/60">
            <span className="font-medium text-ink">{showClient ? `${h.bots?.client_name ?? ""} · ` : ""}{h.bots?.name}</span>
            <span className="text-xs text-muted">pediu {relativeTime(h.handoff_requested_at)}</span>
            <span className="ml-auto text-xs font-semibold text-amber-ink">{h.takeover_at ? "em atendimento" : "responder →"}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
