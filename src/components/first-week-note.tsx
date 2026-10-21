import { FIRST_WEEK_CREDIT_BRL, FIRST_WEEK_QUOTA_SHARE, brlCents } from "@/lib/plans";

const dayBR = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });

/** Primeira semana da assinatura (Trava da conta grátis, parte 3): os limites e quando acabam. */
export function FirstWeekNote({ until }: { until: string | null }) {
  if (!until) return null;
  return (
    <p className="mt-4 rounded-lg border border-line-2 px-3 py-2 text-sm text-ink-2">
      Primeira semana da assinatura: até {dayBR(until)}, cada chatbot usa até {Math.round(FIRST_WEEK_QUOTA_SHARE * 100)}% da cota do mês e a compra de crédito fica em até {brlCents(FIRST_WEEK_CREDIT_BRL)}. Depois, sem esses limites.
    </p>
  );
}
