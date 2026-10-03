import Link from "next/link";
import { Headset } from "lucide-react";
import type { PendingHandoff } from "@/lib/panel";
import { handoffStatus } from "@/lib/handoff-status";
import { cn, relativeTime } from "@/lib/utils";
import { conversationState } from "@/lib/presence";
import { HandoffBadge } from "@/components/handoff-badge";

/**
 * Faixa "conversas esperando a equipe": pediu atendente, ou foi assumida e está sem resposta há
 * mais de 1 hora. Urgente (risco à vida) primeiro e em vermelho. Atalho para cada conversa.
 */
export function PendingHandoffs({ items, showClient = true, hrefFor = (h) => `/painel/bots/${h.bot_id}/conversas/${h.id}` }: { items: PendingHandoff[]; showClient?: boolean; hrefFor?: (h: PendingHandoff) => string }) {
  const waiting = items.filter((h) => handoffStatus(h)?.waiting);
  if (!waiting.length) return null;
  const urgent = waiting.some((h) => handoffStatus(h)?.urgent);
  return (
    <div className={cn("flex flex-col gap-2 rounded-xl border px-4 py-3", urgent ? "border-danger/40 bg-danger-soft" : "border-[#efd9a9] bg-amber-soft")}>
      <div className={cn("flex items-center gap-2 text-sm font-semibold", urgent ? "text-danger" : "text-amber-ink")}>
        <Headset size={17} />
        {waiting.length === 1 ? "1 conversa esperando a equipe" : `${waiting.length} conversas esperando a equipe`}
        {urgent && " · tem pedido urgente"}
      </div>
      <div className="flex flex-col">
        {waiting.slice(0, 6).map((h) => (
          <Link key={h.id} href={hrefFor(h)} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-1 py-1.5 text-sm text-ink-2 hover:bg-white/60">
            <span className="font-medium text-ink">{showClient ? `${h.bots?.client_name ?? ""} · ` : ""}{h.bots?.name}</span>
            <span className="text-xs text-muted">{h.handoff_requested_at ? `pediu ${relativeTime(h.handoff_requested_at)}` : `escreveu ${relativeTime(h.last_contact_at ?? h.last_message_at)}`}</span>
            {conversationState(h) === "online" && <span className="text-xs font-semibold text-brand">● online</span>}
            <HandoffBadge conv={h} className="ml-auto" />
          </Link>
        ))}
      </div>
    </div>
  );
}
