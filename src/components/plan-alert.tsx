import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { num } from "@/lib/plans";

interface Props {
  planId: string;
  trialDays: number | null; // dias restantes do teste (null fora do teste)
  usage: number;
  limit: number;
}

/**
 * Faixa no topo do painel antes que o chat dos clientes pare: teste acabando/acabado,
 * assinatura cancelada, 80% e 100% das conversas do mês. Nada aparece quando está tudo bem.
 */
export function PlanAlert({ planId, trialDays, usage, limit }: Props) {
  const stopped = "o chat dos seus clientes mostra só um formulário de contato (os contatos continuam chegando)";
  let tone: "danger" | "warn" | null = null;
  let text = "";
  if (planId === "cancelado") {
    tone = "danger";
    text = `Sua assinatura está cancelada: ${stopped}.`;
  } else if (trialDays !== null && trialDays <= 0) {
    tone = "danger";
    text = `Seu teste grátis acabou: ${stopped}. Escolha um plano para o assistente voltar a responder.`;
  } else if (limit > 0 && usage >= limit) {
    tone = "danger";
    text = `Limite de ${num(limit)} conversas do mês atingido: ${stopped}.`;
  } else if (trialDays !== null && trialDays <= 3) {
    tone = "warn";
    text = `Seu teste grátis acaba em ${trialDays} dia${trialDays === 1 ? "" : "s"}. Depois disso, ${stopped}.`;
  } else if (limit > 0 && usage >= Math.ceil(limit * 0.8)) {
    tone = "warn";
    text = `Você já usou ${num(usage)} de ${num(limit)} conversas do mês (${Math.round((usage / limit) * 100)}%). No limite, ${stopped}.`;
  }
  if (!tone) return null;
  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm ${tone === "danger" ? "border-[#f0c9c9] bg-danger-soft text-danger" : "border-[#efd9a9] bg-amber-soft text-amber-ink"}`}>
      <AlertTriangle size={17} className="shrink-0" />
      <span className="min-w-0 flex-1">{text}</span>
      <Link href="/painel/cobranca" className={tone === "danger" ? "btn-danger-solid py-1.5" : "btn-dark py-1.5"}>Ver planos</Link>
    </div>
  );
}
