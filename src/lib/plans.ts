export type PlanId = "trial" | "freelancer" | "agencia" | "escala" | "cancelado";

export interface Plan {
  id: PlanId;
  name: string;
  priceBrl: number;
  bots: number;
  conversations: number; // por mês
  customDomain: boolean;
  description: string;
}

export const PLANS: Record<Exclude<PlanId, "cancelado">, Plan> = {
  trial: { id: "trial", name: "Teste grátis", priceBrl: 0, bots: 1, conversations: 200, customDomain: false, description: "14 dias, 1 chatbot, demos ilimitadas" },
  freelancer: { id: "freelancer", name: "Freelancer", priceBrl: 99, bots: 3, conversations: 2000, customDomain: false, description: "3 chatbots · 2.000 conversas/mês" },
  agencia: { id: "agencia", name: "Agência", priceBrl: 249, bots: 15, conversations: 15000, customDomain: true, description: "15 chatbots · 15.000 conversas/mês · domínio próprio" },
  escala: { id: "escala", name: "Escala", priceBrl: 599, bots: 50, conversations: 60000, customDomain: true, description: "50 chatbots · 60.000 conversas/mês · API" },
};

export function getPlan(id: string): Plan {
  return (PLANS as Record<string, Plan>)[id] ?? { ...PLANS.trial, id: "cancelado" as PlanId, name: "Cancelado", bots: 0, conversations: 0 };
}

export function currentPeriod(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export const brl = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v);
export const num = (v: number) => new Intl.NumberFormat("pt-BR").format(v);
