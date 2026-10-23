"use client";

import { useEffect, useRef, useState } from "react";
import { Globe, MessageCircle } from "lucide-react";
import { cn, initials } from "@/lib/utils";

/** O desenho do Instagram (a câmera de cantos arredondados), sem depender de ícone de marca. */
function InstagramGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
    </svg>
  );
}

const BADGE: Record<string, { label: string; className: string }> = {
  whatsapp: { label: "WhatsApp", className: "bg-[#25D366] text-white" },
  instagram: { label: "Instagram", className: "bg-[linear-gradient(45deg,#F58529,#DD2A7B_55%,#8134AF)] text-white" },
  widget: { label: "Chat do site", className: "bg-ink-2 text-panel" },
};

/**
 * O rosto do contato no painel (22/10/2026, a pedido do usuário): a foto do perfil quando tem (só o
 * Instagram dá) ou as iniciais, e o ícone do canal no canto (WhatsApp, Instagram ou chat do site),
 * para saber de onde a pessoa veio. A foto que não carrega volta para as iniciais.
 */
export function ContactAvatar({ name, photo, channel, size = 36, badge = "br", className }: { name: string; photo?: string | null; channel?: string | null; size?: number; badge?: "br" | "bl" | false; className?: string }) {
  const [broken, setBroken] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  // a foto que falhou antes de a página ficar interativa não dispara o onError: confere ao montar
  useEffect(() => {
    const el = img.current;
    if (el?.complete && el.naturalWidth === 0) setBroken(true);
  }, [photo]);
  const b = channel ? BADGE[channel] : undefined;
  const dot = Math.max(14, Math.round(size * 0.42));
  const glyph = Math.round(dot * 0.62);
  return (
    <span className={cn("relative inline-flex shrink-0", className)} style={{ width: size, height: size }}>
      {photo && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img ref={img} src={photo} alt="" onError={() => setBroken(true)} className="h-full w-full rounded-full object-cover shadow-[inset_0_0_0_1px_var(--color-line)]" />
      ) : (
        <span className="flex h-full w-full items-center justify-center rounded-full bg-raised font-semibold text-ink shadow-[inset_0_0_0_1px_var(--color-line)]" style={{ fontSize: Math.max(10, Math.round(size * 0.34)) }}>
          {initials(name) || "?"}
        </span>
      )}
      {b && badge && (
        <span title={b.label} aria-label={b.label} className={cn("absolute -bottom-0.5 flex items-center justify-center rounded-full outline-2 outline-panel", badge === "br" ? "-right-0.5" : "-left-0.5", b.className)} style={{ width: dot, height: dot }}>
          {channel === "instagram" ? <InstagramGlyph size={glyph} /> : channel === "whatsapp" ? <MessageCircle size={glyph} strokeWidth={2.6} /> : <Globe size={glyph} strokeWidth={2.4} />}
        </span>
      )}
    </span>
  );
}
