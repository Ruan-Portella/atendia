import Link from "next/link";

const brand = process.env.NEXT_PUBLIC_BRAND_NAME ?? "Boavoz";

/** Símbolo da Boavoz: o "b" cuja barriga é um balão de conversa. Mesmo desenho de public/icon.svg. */
export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="shrink-0">
      <rect width="64" height="64" rx="14" fill="var(--color-brand)" />
      <g transform="translate(32 32) scale(1.12) translate(-25.5 -24.5)" fill="var(--color-ground)">
        <rect x="9" y="6" width="7" height="36" rx="3.5" />
        <circle cx="25.5" cy="28" r="10.5" fill="none" stroke="var(--color-ground)" strokeWidth="7" />
        <path d="M31 38.5 42 43 36.5 32Z" />
        <circle cx="25.5" cy="28" r="3.4" fill="var(--color-amber)" />
      </g>
    </svg>
  );
}

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label={brand}>
      <LogoMark />
      {/* a marca se escreve em minúsculas; outro nome (NEXT_PUBLIC_BRAND_NAME) fica como veio */}
      <span className="display text-[22px] font-bold tracking-[-0.02em]">{brand === "Boavoz" ? "boavoz" : brand}</span>
    </Link>
  );
}
