/*
 * Tamanho de cada chatbot no ar (revisão de preços, 16/10/2026): a cota do mês é do chatbot.
 * Preço com pelo menos 25% de margem no pior caso (cota toda em atendimentos de 40 respostas e
 * 5 minutos de áudio). Volume: por pacote de 1.000, para um chatbot que atende todos os usuários
 * de um app. Atendimento (17/10/2026): sem IA nenhuma, para quem só quer o software da caixa de
 * entrada da equipe. Todo chatbot no ar tem um tamanho (não há caixa de entrada grátis, 18/10/2026);
 * o preço é do software e da IA, nunca do uso do WhatsApp (termos de Tech Provider): conectar
 * canal não custa nada a mais.
 */
export type BotSize = "atendimento" | "P" | "M" | "G" | "volume";

export interface SizeInfo {
  id: BotSize;
  name: string;
  priceBrl: number;
  /** Atendimentos por mês (no Volume, por pacote). */
  atendimentos: number;
  description: string;
}

export const BOT_SIZES: Record<BotSize, SizeInfo> = {
  atendimento: { id: "atendimento", name: "Atendimento", priceBrl: 29, atendimentos: 0, description: "caixa de entrada da equipe, sem IA" },
  P: { id: "P", name: "P", priceBrl: 49, atendimentos: 160, description: "umas 5 conversas por dia" },
  M: { id: "M", name: "M", priceBrl: 99, atendimentos: 340, description: "umas 11 conversas por dia" },
  G: { id: "G", name: "G", priceBrl: 199, atendimentos: 680, description: "umas 22 conversas por dia" },
  volume: { id: "volume", name: "Volume", priceBrl: 299, atendimentos: 1000, description: "pacotes de 1.000 atendimentos, para apps" },
};

export const isBotSize = (v: unknown): v is BotSize => typeof v === "string" && v in BOT_SIZES;

/** Opção de tamanho nas listas: "P · R$ 49,00 · 160 atendimentos", "Atendimento · R$ 29,00 · sem IA". */
export function sizeOption(s: SizeInfo, long = true): string {
  const price = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 }).format(s.priceBrl);
  if (s.id === "volume") return `Volume · ${price} por 1.000`;
  if (!s.atendimentos) return `${s.name} · ${price} · sem IA`;
  return `${s.name} · ${price} · ${new Intl.NumberFormat("pt-BR").format(s.atendimentos)}${long ? " atendimentos" : ""}`;
}

/* Pacotes da conta (um de cada, por mês): liberam recursos da agência toda. Canal nunca é pago. */
export type PackId = "dominio" | "integracoes" | "plataforma";

export interface PackInfo {
  id: PackId;
  name: string;
  priceBrl: number;
  description: string;
  /** Pacote que precisa vir junto. */
  requires?: PackId;
}

export const PACKS: Record<PackId, PackInfo> = {
  dominio: { id: "dominio", name: "Domínio próprio", priceBrl: 29, description: "painel e chat com o domínio da agência" },
  integracoes: { id: "integracoes", name: "Integrações", priceBrl: 49, description: "ações, webhooks, API e identificação de usuários" },
  plataforma: { id: "plataforma", name: "Plataforma", priceBrl: 199, description: "lojas pela API, chatbot modelo e identificação em todas as lojas", requires: "integracoes" },
};

export const isPackId = (v: unknown): v is PackId => typeof v === "string" && v in PACKS;

/** Tamanhos com IA (o Atendimento não tem IA). */
export const AI_SIZES: readonly BotSize[] = ["P", "M", "G", "volume"];

/**
 * O chatbot usa IA? Só com tamanho de IA ou cota sob medida. Sem tamanho ou no Atendimento, nada
 * de IA (18/10/2026): nem resposta, nem portão, transcrição de áudio, checagem de risco ou análise
 * da base. Fora disso, só as respostas de teste da conta grátis e as demos. Função pura.
 */
export function botHasAi(bot: { size?: unknown; quota_override?: unknown }): boolean {
  return (AI_SIZES as readonly unknown[]).includes(bot.size) || (bot.quota_override !== null && bot.quota_override !== undefined);
}

/** Filtro do PostgREST para os chatbots com IA (tamanho de IA ou cota sob medida). */
export const AI_BOTS_FILTER = `size.in.(${AI_SIZES.join(",")}),quota_override.not.is.null`;

/** Conta grátis: respostas de teste da IA (teste ao vivo do painel e demos) enquanto não há assinatura. */
export const TEST_ANSWERS_FREE = 50;
/** Chatbot que perdeu o tamanho com canal conectado: dias até os canais desconectarem. */
export const UNSIZED_GRACE_DAYS = 30;

/** Respostas da IA que cabem num atendimento: a seguinte abre outro. */
export const ANSWERS_PER_ATENDIMENTO = 40;

/**
 * Excedente (opção de cada chatbot, desligada por padrão): preço de cada atendimento além da
 * cota, descontado do crédito pré-pago da conta (teto do mês por chatbot opcional). Mais caro
 * que o dos tamanhos (R$ 0,29 a 0,31), com 36% de margem no pior caso.
 */
export const OVERAGE_PRICE_BRL = 0.35;

/** Crédito do excedente: compra em reais inteiros, válida por 12 meses, sem reembolso. */
export const CREDIT_MIN_BRL = 50;
export const CREDIT_MAX_BRL = 50_000;
export const CREDIT_SHORTCUTS_BRL = [50, 100, 250, 500] as const;
export const CREDIT_VALID_MONTHS = 12;
/** Aviso de saldo baixo: abaixo de 20% da última compra. */
export const CREDIT_LOW_SHARE = 0.2;

export const brl = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v);
export const num = (v: number) => new Intl.NumberFormat("pt-BR").format(v);
/** Reais com centavos (excedente e teto). */
export const brlCents = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 }).format(v);
