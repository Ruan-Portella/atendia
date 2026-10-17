import Link from "next/link";
import { num } from "@/lib/plans";
import { quotaPhase } from "@/lib/quota";
import { NoticeStrip } from "@/components/notice-strip";

interface BotQuota {
  name: string;
  clientName: string | null;
  quota: number;
  used: number;
  size: string | null;
  /** Cota sob medida (combinada com a BoaVoz). */
  override: number | null;
  overageEnabled: boolean;
  overageUsed: number;
  overageMax: number;
  overageCapMax: number | null;
  overageSuspended: "pico" | "ataque" | null;
  creditShort: boolean;
}

interface Props {
  planId: string;
  trialDays: number | null; // dias restantes do teste (null fora do teste)
  bots: BotQuota[];
}

/** "Bar do Zé, Clínica e mais 2": os primeiros nomes e quantos sobram. */
function names(list: BotQuota[]): string {
  const shown = list.slice(0, 2).map((b) => b.name);
  return list.length > 2 ? `${shown.join(", ")} e mais ${list.length - 2}` : shown.join(" e ");
}

/**
 * Faixa no topo do painel antes que a IA pare: teste acabando/acabado, assinatura cancelada e a
 * cota de cada chatbot (80% e cheia; cheia, só aquele chatbot para). Com o excedente ligado, a cota
 * cheia não para: o aviso passa a ser o teto (80% e atingido). Chatbot sem tamanho também avisa
 * (fica no modo só humano até ganhar um). Nada aparece quando está tudo bem.
 */
export function PlanAlert({ planId, trialDays, bots }: Props) {
  const stopped = "a IA para de responder: as mensagens do WhatsApp e do Instagram chegam em Conversas para a sua equipe, e o chat do site mostra um formulário de contato";
  const full = bots.filter((b) => b.quota > 0 && quotaPhase(b) === "parado");
  const near = bots.filter((b) => b.quota > 0 && !b.overageEnabled && b.used < b.quota && b.used >= Math.ceil(b.quota * 0.8));
  const nearCap = bots.filter((b) => quotaPhase(b) === "excedente" && b.overageUsed >= Math.ceil(b.overageMax * 0.8));
  const unsized = bots.filter((b) => !b.size && b.override === null);
  // parados por falta de crédito (o excedente ligado, sem teto atingido nem suspensão)
  const noCredit = full.filter((b) => b.overageEnabled && b.creditShort && !b.overageSuspended && (b.overageCapMax === null || b.overageUsed < b.overageCapMax));
  const spike = bots.filter((b) => b.overageSuspended === "pico");
  let tone: "danger" | "warn" | null = null;
  let text = "";
  let href = "/painel/cobranca/uso";
  let label = "Uso por chatbot";
  if (planId === "cancelado") {
    tone = "danger";
    text = `Sua assinatura está cancelada: ${stopped}.`;
  } else if (trialDays !== null && trialDays <= 0) {
    tone = "danger";
    text = `Seu teste grátis acabou: ${stopped}. Escolha um plano para o assistente voltar a responder.`;
  } else if (noCredit.length) {
    tone = "danger";
    href = "/painel/cobranca/credito";
    label = "Comprar crédito";
    text = `O crédito do excedente acabou: modo só humano em ${noCredit.length === 1 ? noCredit[0].name : `${noCredit.length} chatbots (${names(noCredit)})`}, que já passaram da cota do mês. Para quem começa um atendimento novo, ${stopped}. Compre crédito para a IA voltar na hora.`;
  } else if (full.length) {
    tone = "danger";
    const why = (b: BotQuota) =>
      b.overageSuspended ? "o excedente está suspenso por um pico no chat do site" : b.overageEnabled ? `o excedente chegou ao teto (${num(b.overageCapMax ?? b.overageMax)} atendimentos a mais)` : `a cota de ${num(b.quota)} atendimentos do mês acabou`;
    text =
      full.length === 1
        ? `Modo só humano em ${full[0].name}: ${why(full[0])}. Para quem começa um atendimento novo nesse chatbot, ${stopped}. Os outros chatbots seguem normais.`
        : `Modo só humano em ${full.length} chatbots (${names(full)}): a cota do mês de cada um acabou (sem excedente, no teto ou com o excedente suspenso). Para quem começa um atendimento novo neles, ${stopped}. Os outros chatbots seguem normais.`;
  } else if (spike.length) {
    tone = "warn";
    text = `Pico no chat do site de ${names(spike)}: o excedente ficou suspenso até você confirmar se é tráfego real ou ataque.`;
  } else if (trialDays !== null && trialDays <= 3) {
    tone = "warn";
    text = `Seu teste grátis acaba em ${trialDays} dia${trialDays === 1 ? "" : "s"}. Depois disso, ${stopped}.`;
  } else if (near.length) {
    tone = "warn";
    const b = near[0];
    text =
      near.length === 1
        ? `${b.name} já usou ${num(b.used)} de ${num(b.quota)} atendimentos do mês (${Math.round((b.used / b.quota) * 100)}%). Na cota cheia, só esse chatbot para até o mês virar.`
        : `${near.length} chatbots passaram de 80% da cota do mês (${names(near)}). Na cota cheia, só o chatbot que encheu para até o mês virar.`;
  } else if (nearCap.length) {
    tone = "warn";
    const b = nearCap[0];
    text =
      nearCap.length === 1
        ? `${b.name} já usou ${num(b.overageUsed)} de ${num(b.overageMax)} atendimentos a mais do excedente. No teto, só esse chatbot para até o mês virar: aumente o teto ou suba o tamanho.`
        : `${nearCap.length} chatbots passaram de 80% do teto do excedente (${names(nearCap)}). No teto, só o chatbot que chegou nele para até o mês virar.`;
  } else if (unsized.length) {
    tone = "warn";
    href = "/painel/cobranca";
    label = "Escolher o tamanho";
    text =
      unsized.length === 1
        ? `${unsized[0].name} está sem tamanho: a IA não responde nele (modo só humano) até você escolher um.`
        : `${unsized.length} chatbots estão sem tamanho (${names(unsized)}): a IA não responde neles (modo só humano) até você escolher um.`;
  }
  if (!tone) return null;
  return (
    <NoticeStrip tone={tone} action={<Link href={href} className={tone === "danger" ? "btn-danger-solid py-1" : "btn-dark py-1"}>{label}</Link>}>
      {text}
    </NoticeStrip>
  );
}
