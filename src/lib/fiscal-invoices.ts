import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PLATFORM_SCOPE, openNullable, sealNullable } from "./field-cipher";

/*
 * Notas fiscais (spec, Empresa e Meta; leva Pendências do MVP, parte 5): cada pagamento confirmado
 * pela Stripe vira uma "nota a emitir" (fiscal_invoices), com o tomador pedido no checkout (nome,
 * CPF ou CNPJ e endereço), o valor e a descrição. O backoffice lista para copiar no Emissor
 * Nacional da NFS-e (gov.br) e marcar como emitida. A emissão automática por um serviço emissor
 * (NFE.io, eNotas, Focus NFe, PlugNotas) fica para depois. Só este arquivo toca a tabela.
 */

/** estornada: o pagamento voltou numa desistência antes da emissão (não precisa de nota). */
export type FiscalStatus = "a_emitir" | "emitida" | "erro" | "estornada";
export const FISCAL_STATUS_LABEL: Record<FiscalStatus, string> = { a_emitir: "A emitir", emitida: "Emitida", erro: "Com erro", estornada: "Estornada" };

export interface FiscalRecord {
  source: "fatura" | "pix";
  stripeRef: string;
  customerId: string | null;
  amountCents: number;
  currency: string;
  paidAt: string;
  takerName: string | null;
  takerTaxType: string | null;
  takerTaxId: string | null;
  takerAddress: string | null;
  description: string | null;
}

/** Endereço da Stripe numa linha (rua, número, bairro, cidade, estado, CEP). Função pura. */
export function addressLine(a: Stripe.Address | null | undefined): string | null {
  if (!a) return null;
  const parts = [a.line1, a.line2, [a.city, a.state].filter(Boolean).join(" / "), a.postal_code ? `CEP ${a.postal_code}` : null, a.country && a.country !== "BR" ? a.country : null].filter((p) => p && String(p).trim());
  return parts.length ? parts.join(", ") : null;
}

/** CPF ou CNPJ com a máscara de sempre (o que vai no Emissor Nacional). Função pura. */
export function formatTaxId(value: string | null): string | null {
  if (!value) return null;
  const d = value.replace(/\D/g, "");
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  return value;
}

const customerOf = (c: string | { id: string } | null | undefined) => (typeof c === "string" ? c : (c?.id ?? null));
const brTaxId = (ids: Array<{ type: string; value: string | null }> | null | undefined) => (ids ?? []).find((t) => t.type === "br_cpf" || t.type === "br_cnpj") ?? (ids ?? [])[0] ?? null;

/** A nota de uma fatura paga (assinatura, subida de tamanho ou crédito no cartão), ou null se não houve valor. Função pura. */
export function invoiceRecord(inv: Stripe.Invoice): FiscalRecord | null {
  if (!inv.id || !(inv.amount_paid > 0)) return null;
  const tax = brTaxId(inv.customer_tax_ids as Array<{ type: string; value: string | null }> | null | undefined);
  const lines = (inv.lines?.data ?? []).map((l) => l.description).filter(Boolean);
  const paidAt = inv.status_transitions?.paid_at ? new Date(inv.status_transitions.paid_at * 1000).toISOString() : new Date().toISOString();
  return {
    source: "fatura",
    stripeRef: inv.id,
    customerId: customerOf(inv.customer as string | { id: string } | null),
    amountCents: inv.amount_paid,
    currency: inv.currency ?? "brl",
    paidAt,
    takerName: inv.customer_name ?? null,
    takerTaxType: tax?.type ?? null,
    takerTaxId: tax?.value ?? null,
    takerAddress: addressLine(inv.customer_address),
    description: lines.length ? lines.join("; ").slice(0, 500) : (inv.description ?? null),
  };
}

/** A nota de um crédito pago pelo Pix (sessão de checkout sem fatura), ou null se não foi pago. Função pura. */
export function pixRecord(s: Stripe.Checkout.Session, now = new Date()): FiscalRecord | null {
  if (s.mode !== "payment" || s.payment_status !== "paid" || !(Number(s.amount_total) > 0)) return null;
  const tax = brTaxId(s.customer_details?.tax_ids as Array<{ type: string; value: string | null }> | null | undefined);
  return {
    source: "pix",
    stripeRef: s.id,
    customerId: customerOf(s.customer as string | { id: string } | null),
    amountCents: Number(s.amount_total),
    currency: s.currency ?? "brl",
    paidAt: now.toISOString(),
    takerName: s.customer_details?.name ?? null,
    takerTaxType: tax?.type ?? null,
    takerTaxId: tax?.value ?? null,
    takerAddress: addressLine(s.customer_details?.address),
    description: "Crédito do excedente, válido por 12 meses",
  };
}

/** Grava a nota a emitir uma vez por pagamento (o mesmo evento da Stripe de novo não duplica). */
export async function recordFiscalInvoice(db: SupabaseClient, r: FiscalRecord | null): Promise<void> {
  if (!r) return;
  const { data: agency } = r.customerId ? await db.from("agencies").select("id, name").eq("stripe_customer_id", r.customerId).maybeSingle() : { data: null };
  const { error } = await db.from("fiscal_invoices").upsert(
    {
      agency_id: (agency?.id as string | undefined) ?? null,
      agency_name: (agency?.name as string | undefined) ?? null,
      source: r.source,
      stripe_ref: r.stripeRef,
      amount_cents: r.amountCents,
      currency: r.currency,
      paid_at: r.paidAt,
      taker_name: r.takerName,
      taker_tax_type: r.takerTaxType,
      taker_tax_id_enc: await sealNullable("fiscal_invoices.taker_tax_id_enc", r.takerTaxId, PLATFORM_SCOPE),
      taker_address_enc: await sealNullable("fiscal_invoices.taker_address_enc", r.takerAddress, PLATFORM_SCOPE),
      description: r.description,
    },
    { onConflict: "stripe_ref", ignoreDuplicates: true },
  );
  if (error) throw new Error(`nota fiscal: ${error.message}`);
}

export interface FiscalInvoice {
  id: string;
  agencyId: string | null;
  agencyName: string | null;
  source: "fatura" | "pix";
  stripeRef: string;
  amountCents: number;
  paidAt: string;
  takerName: string | null;
  takerTaxType: string | null;
  takerTaxId: string | null;
  takerAddress: string | null;
  description: string | null;
  status: FiscalStatus;
  number: string | null;
  emittedAt: string | null;
  emittedBy: string | null;
  /** o pagamento foi estornado numa desistência (emitida: o suporte cancela a nota) */
  refundedAt: string | null;
}

/** As notas de um estado, as mais antigas primeiro (as a emitir) ou as mais novas (as emitidas). */
export async function listFiscalInvoices(db: SupabaseClient, status: FiscalStatus, limit = 100): Promise<FiscalInvoice[]> {
  const { data, error } = await db.from("fiscal_invoices").select("*").eq("status", status).order("paid_at", { ascending: status === "a_emitir" }).limit(limit);
  if (error) throw new Error(`notas fiscais: ${error.message}`);
  return Promise.all(
    ((data ?? []) as Array<Record<string, unknown>>).map(async (r) => ({
      id: r.id as string,
      agencyId: (r.agency_id as string | null) ?? null,
      agencyName: (r.agency_name as string | null) ?? null,
      source: r.source as "fatura" | "pix",
      stripeRef: r.stripe_ref as string,
      amountCents: Number(r.amount_cents),
      paidAt: r.paid_at as string,
      takerName: (r.taker_name as string | null) ?? null,
      takerTaxType: (r.taker_tax_type as string | null) ?? null,
      takerTaxId: await openNullable("fiscal_invoices.taker_tax_id_enc", r.taker_tax_id_enc),
      takerAddress: await openNullable("fiscal_invoices.taker_address_enc", r.taker_address_enc),
      description: (r.description as string | null) ?? null,
      status: r.status as FiscalStatus,
      number: (r.number as string | null) ?? null,
      emittedAt: (r.emitted_at as string | null) ?? null,
      emittedBy: (r.emitted_by as string | null) ?? null,
      refundedAt: (r.refunded_at as string | null) ?? null,
    })),
  );
}

/** Quantas notas estão esperando (o aviso no topo do backoffice). */
export async function pendingFiscalCount(db: SupabaseClient): Promise<number> {
  const { count } = await db.from("fiscal_invoices").select("id", { count: "exact", head: true }).eq("status", "a_emitir");
  return count ?? 0;
}

/** "Marcar como emitida", com o número da nota se a pessoa informar. Só a que ainda estava a emitir. */
export async function markFiscalEmitted(db: SupabaseClient, id: string, o: { number: string | null; by: string }): Promise<boolean> {
  const { data, error } = await db
    .from("fiscal_invoices")
    .update({ status: "emitida", number: o.number?.trim().slice(0, 40) || null, emitted_at: new Date().toISOString(), emitted_by: o.by })
    .eq("id", id)
    .eq("status", "a_emitir")
    .select("id");
  return !error && Boolean(data?.length);
}

/** Receita paga por conta num intervalo (para o alarme de custo de IA): centavos e quantos pagamentos. */
export async function paidByAgency(db: SupabaseClient, from: string, to: string): Promise<Map<string, { cents: number; payments: number }>> {
  const { data, error } = await db.from("fiscal_invoices").select("agency_id, amount_cents").gte("paid_at", from).lt("paid_at", to).not("agency_id", "is", null);
  if (error) throw new Error(`receita: ${error.message}`);
  const out = new Map<string, { cents: number; payments: number }>();
  for (const r of data ?? []) {
    const a = out.get(r.agency_id as string) ?? { cents: 0, payments: 0 };
    out.set(r.agency_id as string, { cents: a.cents + Number(r.amount_cents), payments: a.payments + 1 });
  }
  return out;
}
