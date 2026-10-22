import type { CSSProperties } from "react";
import { faceOf, type EyeStyle } from "@/lib/bot-face";
import { cn } from "@/lib/utils";

const INK = "#141413";
/** o fone fica em volta do rosto, fora da cor dele: um cinza que aparece no tema escuro e no claro */
const HEADSET = "#76766f";

function eyeStyle(kind: EyeStyle | "linha", s: number, color: string): CSSProperties {
  if (kind === "redondo") return { width: s * 0.17, height: s * 0.17, borderRadius: "50%", background: color };
  if (kind === "feliz") {
    const t = Math.max(1.5, s * 0.055);
    return { width: s * 0.15, height: s * 0.15, borderTop: `${t}px solid ${color}`, borderLeft: `${t}px solid ${color}`, borderRadius: s * 0.02, transform: `rotate(45deg) translate(${s * 0.03}px, ${s * 0.03}px)` };
  }
  if (kind === "linha") return { width: s * 0.18, height: Math.max(2, s * 0.05), borderRadius: s * 0.03, background: color };
  const w = Math.max(2, Math.round(s * 0.13));
  return { width: w, height: Math.max(4, Math.round(s * 0.27)), borderRadius: w, background: color };
}

/**
 * Rosto do chatbot (redesenho): o ícone de app, um quadrado arredondado na cor do chatbot com os
 * olhos e o acessório escolhidos (no rosto grande, o acessório completo, por fora do quadrado; nos
 * ícones pequenos, uma versão simples por dentro, para não cortar nas listas). Aparece no menu, na Caixa de entrada, no
 * Ir para, na conversa, no editor e no chat do site. `alive` pisca e olha para os lados (quem pede
 * menos movimento não vê); `inverted` é o rosto em branco com os olhos na cor (no topo do chat do site).
 */
export function BotFace({ color, face, size = 28, alive = false, inverted = false, className, title }: { color: string | null | undefined; face?: unknown; size?: number; alive?: boolean; inverted?: boolean; className?: string; title?: string }) {
  const f = faceOf(face);
  const s = size;
  const bg = color || "#4ed19b";
  const eyeColor = inverted ? bg : "#fff";
  const left: EyeStyle | "linha" = f.eyes === "sonolento" ? "linha" : f.eyes === "piscadinha" ? "pilula" : f.eyes;
  const right: EyeStyle | "linha" = f.eyes === "sonolento" || f.eyes === "piscadinha" ? "linha" : f.eyes;
  // a partir de 40 px, o acessório completo (o chapéu e o fone saem do quadrado); abaixo, o simples
  const big = s >= 40;
  const acc = f.acc;
  const thin = Math.max(1, Math.round(s * 0.05));
  return (
    <span
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: s, height: s, borderRadius: Math.round(s * 0.3), background: inverted ? "#fff" : bg, boxShadow: inverted ? undefined : `inset 0 -${Math.max(1, Math.round(s / 20))}px 0 #00000033, inset 0 1px 0 #ffffff40` }}
    >
      <span className="flex items-center" style={{ gap: Math.max(2, Math.round(s * 0.14)), animation: alive ? "bv-look 6s ease-in-out infinite" : undefined }}>
        {[left, right].map((k, i) => (
          <span key={i} className="inline-flex items-center" style={{ animation: alive ? "bv-blink 4s infinite" : undefined }}>
            <span style={eyeStyle(k, s, eyeColor)} />
          </span>
        ))}
      </span>
      {acc === "chef" && !big && (
        <span aria-hidden className="absolute left-1/2" style={{ top: s * 0.07, width: s * 0.56, height: Math.max(3, s * 0.2), marginLeft: -s * 0.28, borderRadius: `${s * 0.14}px ${s * 0.14}px ${s * 0.04}px ${s * 0.04}px`, background: inverted ? "#e6e4dc" : "#f7f6f2", boxShadow: `inset 0 -${thin}px 0 #00000014` }} />
      )}
      {acc === "chef" && big && (
        <span aria-hidden className="absolute left-1/2 flex flex-col items-center" style={{ top: -s * 0.3, width: s * 0.62, marginLeft: -s * 0.31 }}>
          <span style={{ width: s * 0.62, height: s * 0.32, borderRadius: `${s * 0.18}px ${s * 0.18}px ${s * 0.08}px ${s * 0.08}px`, background: "#f7f6f2", boxShadow: "inset 0 -3px 0 #00000014" }} />
          <span style={{ width: s * 0.48, height: s * 0.1, marginTop: -2, borderRadius: s * 0.03, background: "#e6e4dc" }} />
        </span>
      )}
      {acc === "oculos" && (
        <span aria-hidden className="absolute left-1/2 top-1/2 flex items-center" style={{ width: s * 0.8, height: s * 0.32, marginLeft: -s * 0.4, marginTop: -s * 0.16 }}>
          <span style={{ width: s * 0.32, height: s * 0.29, borderRadius: s * 0.09, border: `${big ? Math.max(2, s * 0.032) : thin}px solid ${INK}`, background: "#ffffff14" }} />
          <span style={{ flex: 1, height: big ? Math.max(2, s * 0.032) : thin, background: INK }} />
          <span style={{ width: s * 0.32, height: s * 0.29, borderRadius: s * 0.09, border: `${big ? Math.max(2, s * 0.032) : thin}px solid ${INK}`, background: "#ffffff14" }} />
        </span>
      )}
      {acc === "fone" && !big && (
        <>
          <span aria-hidden className="absolute" style={{ top: s * 0.09, left: s * 0.13, width: s * 0.74, height: s * 0.5, borderTop: `${thin}px solid ${INK}b3`, borderLeft: `${thin}px solid ${INK}b3`, borderRight: `${thin}px solid ${INK}b3`, borderRadius: `${s * 0.37}px ${s * 0.37}px 0 0` }} />
          <span aria-hidden className="absolute" style={{ top: s * 0.48, left: s * 0.07, width: Math.max(2, s * 0.13), height: s * 0.2, borderRadius: s * 0.05, background: `${INK}b3` }} />
          <span aria-hidden className="absolute" style={{ top: s * 0.48, right: s * 0.07, width: Math.max(2, s * 0.13), height: s * 0.2, borderRadius: s * 0.05, background: `${INK}b3` }} />
        </>
      )}
      {acc === "fone" && big && (
        <>
          <span aria-hidden className="absolute" style={{ top: -s * 0.12, left: -s * 0.08, width: s * 1.16, height: s * 0.68, borderTop: `${Math.max(2, s * 0.055)}px solid ${HEADSET}`, borderLeft: `${Math.max(2, s * 0.055)}px solid ${HEADSET}`, borderRight: `${Math.max(2, s * 0.055)}px solid ${HEADSET}`, borderRadius: `${s * 0.58}px ${s * 0.58}px 0 0` }} />
          <span aria-hidden className="absolute" style={{ top: s * 0.4, left: -s * 0.12, width: s * 0.14, height: s * 0.3, borderRadius: s * 0.05, background: HEADSET }} />
          <span aria-hidden className="absolute" style={{ top: s * 0.4, right: -s * 0.12, width: s * 0.14, height: s * 0.3, borderRadius: s * 0.05, background: HEADSET }} />
          <span aria-hidden className="absolute" style={{ top: s * 0.66, right: -s * 0.02, width: s * 0.38, height: Math.max(2, s * 0.045), borderRadius: s * 0.03, background: HEADSET, transform: "rotate(18deg)", transformOrigin: "right center" }} />
        </>
      )}
    </span>
  );
}
