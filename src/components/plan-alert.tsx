import Link from "next/link";
import { num } from "@/lib/plans";
import { hardLimitOf } from "@/lib/quota";
import { NoticeStrip } from "@/components/notice-strip";

interface Props {
  planId: string;
  trialDays: number | null; // dias restantes do teste (null fora do teste)
  usage: number;
  limit: number;
}

/**
 * Faixa no topo do painel antes que a IA pare: teste acabando/acabado, assinatura cancelada, 80% e
 * 100% dos atendimentos do mês e o fim da tolerância. Nada aparece quando está tudo bem.
 */
export function PlanAlert({ planId, trialDays, usage, limit }: Props) {
  const stopped = "a IA para de responder: as mensagens do WhatsApp e do Instagram chegam em Conversas para a sua equipe, e o chat do site mostra um formulário de contato";
  const hard = hardLimitOf(limit);
  let tone: "danger" | "warn" | null = null;
  let text = "";
  if (planId === "cancelado") {
    tone = "danger";
    text = `Sua assinatura está cancelada: ${stopped}.`;
  } else if (trialDays !== null && trialDays <= 0) {
    tone = "danger";
    text = `Seu teste grátis acabou: ${stopped}. Escolha um plano para o assistente voltar a responder.`;
  } else if (limit > 0 && usage >= hard) {
    tone = "danger";
    text = `Modo só humano: a cota de ${num(limit)} atendimentos do mês e a tolerância acabaram. Para quem começa um atendimento novo, ${stopped}. Atendimentos já abertos seguem até completar 24 horas.`;
  } else if (limit > 0 && usage >= limit) {
    tone = "danger";
    text = `Cota de ${num(limit)} atendimentos do mês atingida. Vale a tolerância de 10% (até ${num(hard)}); depois, ${stopped}.`;
  } else if (trialDays !== null && trialDays <= 3) {
    tone = "warn";
    text = `Seu teste grátis acaba em ${trialDays} dia${trialDays === 1 ? "" : "s"}. Depois disso, ${stopped}.`;
  } else if (limit > 0 && usage >= Math.ceil(limit * 0.8)) {
    tone = "warn";
    text = `Você já usou ${num(usage)} de ${num(limit)} atendimentos do mês (${Math.round((usage / limit) * 100)}%). Passando da cota e da tolerância de 10%, ${stopped}.`;
  }
  if (!tone) return null;
  return (
    <NoticeStrip tone={tone} action={<Link href="/painel/cobranca/uso" className={tone === "danger" ? "btn-danger-solid py-1" : "btn-dark py-1"}>Uso e planos</Link>}>
      {text}
    </NoticeStrip>
  );
}
