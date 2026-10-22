import { cn } from "@/lib/utils";

/**
 * Rosto do chatbot (redesenho): o ícone de app, um quadrado arredondado na cor do chatbot com
 * dois olhos brancos. Aparece no menu, na Caixa de entrada e nos relatórios. `alive` pisca e
 * olha para os lados (só onde ajuda a achar o chatbot; quem pede menos movimento não vê).
 */
export function BotFace({ color, size = 28, alive = false, className, title }: { color: string | null | undefined; size?: number; alive?: boolean; className?: string; title?: string }) {
  const eyeW = Math.max(2, Math.round(size * 0.13));
  const eyeH = Math.max(4, Math.round(size * 0.27));
  return (
    <span
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.3), background: color || "#4ed19b", boxShadow: `inset 0 -${Math.max(1, Math.round(size / 20))}px 0 #00000033, inset 0 1px 0 #ffffff40` }}
    >
      <span className="flex items-center" style={{ gap: Math.max(2, Math.round(size * 0.14)), animation: alive ? "bv-look 6s ease-in-out infinite" : undefined }}>
        {[0, 1].map((i) => (
          <span key={i} className="inline-flex" style={{ animation: alive ? "bv-blink 4s infinite" : undefined }}>
            <span style={{ width: eyeW, height: eyeH, borderRadius: eyeW, background: "#fff" }} />
          </span>
        ))}
      </span>
    </span>
  );
}
