import { PRECONNECT_CHECKS } from "@/lib/connect-checklist";

/** Antes de conectar o WhatsApp: os erros mais comuns da janela da Meta, numa lista curta. */
export function ConnectChecklist({ className = "" }: { className?: string }) {
  return (
    <details className={`rounded-xl border border-line px-4 py-3 text-sm ${className}`}>
      <summary className="cursor-pointer font-semibold">Antes de conectar: confira os erros mais comuns</summary>
      <ul className="mt-2 flex flex-col gap-2">
        {PRECONNECT_CHECKS.map((c) => (
          <li key={c.title}>
            <strong>{c.title}{c.coexistence ? " (número que já está no app)" : ""}.</strong> <span className="text-ink-2">{c.detail}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
