"use client";

import { useOptimistic, useTransition } from "react";
import { ThumbsUp } from "lucide-react";
import type { ActionResult } from "@/lib/action-result";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/** Curtir um item do roadmap (uma curtida por pessoa; o segundo toque desfaz). */
export function RoadmapLike({ itemId, liked, count, action }: { itemId: string; liked: boolean; count: number; action: (itemId: string) => Promise<ActionResult> }) {
  const [state, setState] = useOptimistic({ liked, count }, (s, next: boolean) => ({ liked: next, count: Math.max(0, s.count + (next ? 1 : -1)) }));
  const [pending, start] = useTransition();
  const toast = useToast();

  function toggle() {
    start(async () => {
      setState(!state.liked);
      const r = await action(itemId);
      if (!r.ok) toast.error(r.message);
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={state.liked}
      aria-label={state.liked ? `Desfazer a curtida (${state.count})` : `Curtir (${state.count})`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold tabular-nums transition-colors duration-[120ms]",
        state.liked ? "border-brand bg-brand-soft text-brand" : "border-line bg-panel text-ink-2 hover:border-ink-2",
      )}
    >
      <ThumbsUp size={13} fill={state.liked ? "currentColor" : "none"} aria-hidden />
      {state.count}
    </button>
  );
}
