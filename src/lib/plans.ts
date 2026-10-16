export type PlanId = "trial" | "freelancer" | "agencia" | "escala" | "cancelado";

export interface Plan {
  id: PlanId;
  name: string;
  priceBrl: number;
  bots: number;
  /** Atendimentos por mês (1 atendimento = 24 horas de IA com um contato; ver atendimentos.ts). */
  atendimentos: number;
  customDomain: boolean;
  description: string;
}

export const PLANS: Record<Exclude<PlanId, "cancelado">, Plan> = {
  trial: { id: "trial", name: "Teste grátis", priceBrl: 0, bots: 1, atendimentos: 200, customDomain: false, description: "14 dias, 1 chatbot, demos ilimitadas" },
  freelancer: { id: "freelancer", name: "Freelancer", priceBrl: 99, bots: 3, atendimentos: 2000, customDomain: false, description: "3 chatbots · 2.000 atendimentos/mês" },
  agencia: { id: "agencia", name: "Agência", priceBrl: 249, bots: 15, atendimentos: 15000, customDomain: true, description: "15 chatbots · 15.000 atendimentos/mês · domínio próprio" },
  escala: { id: "escala", name: "Escala", priceBrl: 599, bots: 50, atendimentos: 60000, customDomain: true, description: "50 chatbots · 60.000 atendimentos/mês · API" },
};

/*
 * Tamanho de cada chatbot no ar (revisão de preços, 16/10/2026): a cota do mês é do chatbot.
 * Preço com pelo menos 25% de margem no pior caso (cota toda em atendimentos de 40 respostas e
 * 5 minutos de áudio). Volume: por pacote de 1.000, para um chatbot que atende todos os usuários
 * de um app.
 */
export type BotSize = "P" | "M" | "G" | "volume";

export interface SizeInfo {
  id: BotSize;
  name: string;
  priceBrl: number;
  /** Atendimentos por mês (no Volume, por pacote). */
  atendimentos: number;
  description: string;
}

export const BOT_SIZES: Record<BotSize, SizeInfo> = {
  P: { id: "P", name: "P", priceBrl: 49, atendimentos: 160, description: "umas 5 conversas por dia" },
  M: { id: "M", name: "M", priceBrl: 99, atendimentos: 340, description: "umas 11 conversas por dia" },
  G: { id: "G", name: "G", priceBrl: 199, atendimentos: 680, description: "umas 22 conversas por dia" },
  volume: { id: "volume", name: "Volume", priceBrl: 299, atendimentos: 1000, description: "pacotes de 1.000 atendimentos, para apps" },
};

export const isBotSize = (v: unknown): v is BotSize => typeof v === "string" && v in BOT_SIZES;

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

/** Respostas da IA que cabem num atendimento: a seguinte abre outro. */
export const ANSWERS_PER_ATENDIMENTO = 40;

/**
 * Excedente (opção de cada chatbot, desligada por padrão): preço de cada atendimento além da
 * cota, até o teto de gasto do mês. Mais caro que o dos tamanhos (R$ 0,29 a 0,31), com 36% de
 * margem no pior caso.
 */
export const OVERAGE_PRICE_BRL = 0.35;

export function getPlan(id: string): Plan {
  return (PLANS as Record<string, Plan>)[id] ?? { ...PLANS.trial, id: "cancelado" as PlanId, name: "Cancelado", bots: 0, atendimentos: 0 };
}

export const brl = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v);
export const num = (v: number) => new Intl.NumberFormat("pt-BR").format(v);
/** Reais com centavos (excedente e teto). */
export const brlCents = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 }).format(v);
