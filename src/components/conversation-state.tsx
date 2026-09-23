import { conversationState, lastSeen, type PresenceInput } from "@/lib/presence";
import { relativeTime } from "@/lib/utils";

/** Selo da conversa: "Visitante online" / "Ativa" / "Encerrada". */
export function ConversationStateBadge({ conv, withTime = false }: { conv: PresenceInput; withTime?: boolean }) {
  const state = conversationState(conv);
  if (state === "online") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />Visitante online
      </span>
    );
  }
  if (state === "active") return <span className="rounded-full bg-ground px-2 py-0.5 text-xs font-medium text-ink-2">Ativa</span>;
  return <span className="rounded-full bg-ground px-2 py-0.5 text-xs font-medium text-muted">Encerrada{withTime ? ` · saiu ${relativeTime(lastSeen(conv))}` : ""}</span>;
}
