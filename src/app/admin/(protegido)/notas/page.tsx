import Link from "next/link";
import { requireAdmin } from "@/lib/platform-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { FISCAL_STATUS_LABEL, formatTaxId, listFiscalInvoices, type FiscalInvoice, type FiscalStatus } from "@/lib/fiscal-invoices";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { CopyButton } from "@/components/copy-button";
import { cn } from "@/lib/utils";
import { markInvoiceEmitted } from "./actions";

export const metadata = { title: "Notas fiscais" };

const STATUSES: FiscalStatus[] = ["a_emitir", "emitida", "erro"];
const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const day = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

/** Um campo da nota com o botão de copiar (o que vai no Emissor Nacional). */
function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="w-[110px] shrink-0 text-xs text-muted">{label}</span>
      <span className="min-w-0 flex-1 truncate text-sm">{value ?? <span className="text-muted">não informado</span>}</span>
      {value && <CopyButton text={value} label="Copiar" className="btn-ghost shrink-0 py-0.5 text-xs" icon={false} />}
    </div>
  );
}

function Invoice({ n }: { n: FiscalInvoice }) {
  const amount = (n.amountCents / 100).toFixed(2).replace(".", ",");
  return (
    <li className="card flex flex-col gap-2 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">{brl(n.amountCents)} · {n.agencyName ?? "conta apagada"}</span>
        <span className="text-xs text-muted">pago em {day(n.paidAt)} · {n.source === "pix" ? "crédito pelo Pix" : "fatura"} · {n.stripeRef}</span>
      </div>
      <div className="flex flex-col gap-1">
        <Field label="Tomador" value={n.takerName} />
        <Field label={n.takerTaxType === "br_cnpj" ? "CNPJ" : n.takerTaxType === "br_cpf" ? "CPF" : "CPF ou CNPJ"} value={formatTaxId(n.takerTaxId)} />
        <Field label="Endereço" value={n.takerAddress} />
        <Field label="Valor" value={amount} />
        <Field label="Descrição" value={n.description} />
      </div>
      {n.status === "a_emitir" ? (
        <ActionForm action={markInvoiceEmitted.bind(null, n.id)} className="flex flex-wrap items-center gap-2 pt-1">
          <input name="number" placeholder="número da nota (opcional)" maxLength={40} className="input w-auto py-1 text-sm" aria-label="Número da nota" />
          <SubmitButton className="btn-primary py-1 text-sm" pendingLabel="…">Marcar como emitida</SubmitButton>
        </ActionForm>
      ) : n.status === "emitida" ? (
        <p className="text-xs text-muted">Emitida{n.number ? ` (nº ${n.number})` : ""} em {n.emittedAt ? day(n.emittedAt) : "?"} por {n.emittedBy ?? "?"}.</p>
      ) : null}
    </li>
  );
}

/**
 * Notas fiscais (spec, Empresa e Meta): cada pagamento confirmado pela Stripe vira uma nota a
 * emitir. A emissão é à mão no Emissor Nacional da NFS-e (gov.br), copiando os campos daqui; a
 * emissão automática por um serviço emissor fica para depois.
 */
export default async function AdminNotas({ searchParams }: { searchParams: Promise<{ estado?: string }> }) {
  await requireAdmin("/admin/notas");
  const { estado } = await searchParams;
  const status: FiscalStatus = STATUSES.includes(estado as FiscalStatus) ? (estado as FiscalStatus) : "a_emitir";
  const items = await listFiscalInvoices(createAdminClient(), status);
  return (
    <>
      <div>
        <h1 className="text-[26px] font-bold">Notas fiscais</h1>
        <p className="text-sm text-muted">
          Cada pagamento confirmado pela Stripe (fatura da assinatura, subida de tamanho e crédito, no cartão ou no Pix). Emita no{" "}
          <a href="https://www.nfse.gov.br/EmissorNacional" target="_blank" rel="noopener noreferrer" className="underline">Emissor Nacional da NFS-e</a> copiando os campos e marque como emitida. O CPF ou CNPJ e o endereço vêm do checkout.
        </p>
      </div>
      <nav aria-label="Estado das notas" className="flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <Link key={s} href={`/admin/notas?estado=${s}`} className={cn("rounded-full border px-3 py-1 text-sm font-semibold", s === status ? "border-ink bg-ink text-ground" : "border-line text-muted")}>
            {FISCAL_STATUS_LABEL[s]}
          </Link>
        ))}
      </nav>
      {items.length === 0 ? <p className="text-sm text-muted">Nenhuma nota {FISCAL_STATUS_LABEL[status].toLowerCase()}.</p> : <ul className="flex flex-col gap-3">{items.map((n) => <Invoice key={n.id} n={n} />)}</ul>}
    </>
  );
}
