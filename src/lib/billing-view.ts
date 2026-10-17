import type Stripe from "stripe";
import { stripe } from "./stripe";

/*
 * O que a tela de Assinatura mostra da Stripe (revisão de preços, parte 4d): a prévia exata da
 * próxima fatura (com o que já foi agendado e as diferenças pequenas que entram nela) e as faturas
 * recentes, com o link para ver ou pagar. Falha da Stripe não derruba a tela: volta vazio.
 */

export interface InvoiceRow {
  id: string;
  number: string | null;
  created: string;
  description: string;
  totalCents: number;
  status: "rascunho" | "em aberto" | "paga" | "anulada" | "não cobrável";
  url: string | null;
  pdf: string | null;
}

export interface BillingView {
  next: { totalCents: number; lines: Array<{ description: string; amountCents: number }> } | null;
  invoices: InvoiceRow[];
}

const STATUS: Record<string, InvoiceRow["status"]> = { draft: "rascunho", open: "em aberto", paid: "paga", void: "anulada", uncollectible: "não cobrável" };

/** Fatura da Stripe para a tabela: descrição da avulsa, ou "Assinatura" com o mês. Função pura. */
export function invoiceRow(i: Pick<Stripe.Invoice, "id" | "number" | "created" | "description" | "total" | "status" | "hosted_invoice_url" | "invoice_pdf" | "billing_reason">): InvoiceRow {
  const created = new Date(i.created * 1000);
  const month = created.toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "America/Sao_Paulo" });
  const description = i.description || (i.billing_reason === "subscription_create" ? "Primeira fatura da assinatura (proporcional)" : i.billing_reason === "subscription_cycle" ? `Assinatura de ${month}` : "Fatura");
  return {
    id: i.id ?? "",
    number: i.number ?? null,
    created: created.toISOString(),
    description,
    totalCents: i.total ?? 0,
    status: STATUS[i.status ?? ""] ?? "rascunho",
    url: i.hosted_invoice_url ?? null,
    pdf: i.invoice_pdf ?? null,
  };
}

export async function billingView(agency: { stripe_customer_id: string | null; stripe_subscription_id: string | null }): Promise<BillingView> {
  if (!stripe || !agency.stripe_customer_id) return { next: null, invoices: [] };
  const customer = agency.stripe_customer_id;
  const [preview, list] = await Promise.all([
    agency.stripe_subscription_id ? stripe.invoices.createPreview({ customer, subscription: agency.stripe_subscription_id }).catch(() => null) : Promise.resolve(null),
    stripe.invoices.list({ customer, limit: 12 }).catch(() => null),
  ]);
  return {
    next: preview ? { totalCents: preview.total ?? 0, lines: preview.lines.data.filter((l) => l.amount).map((l) => ({ description: l.description ?? "", amountCents: l.amount ?? 0 })) } : null,
    invoices: (list?.data ?? []).filter((i) => i.status !== "draft").map(invoiceRow),
  };
}
