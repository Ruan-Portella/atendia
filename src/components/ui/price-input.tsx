import { cn } from "@/lib/utils";

interface Props extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "defaultValue"> {
  /** Valor inicial em centavos. */
  defaultCents?: number | null;
}

/**
 * Campo de preço em reais. Aceita qualquer valor ("55", "55,90", "1.250"): é texto com
 * teclado numérico, não `type=number` (que travava em múltiplos de 10). O servidor valida.
 */
export function PriceInput({ defaultCents, className, placeholder = "400", ...rest }: Props) {
  const initial = defaultCents != null ? (defaultCents / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2, useGrouping: false }) : "";
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-sm text-muted">R$</span>
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        defaultValue={initial}
        placeholder={placeholder}
        className={cn("input pl-10", className)}
        {...rest}
      />
    </div>
  );
}
