import Link from "next/link";
import { requireAdmin } from "@/lib/platform-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { RECOVERY_STATUS_LABEL, RECOVERY_WAIT_HOURS, effectiveStatus, recoveryReady, type RecoveryArea, type RecoveryStatus } from "@/lib/mfa-recovery";
import { refuseRecovery, removeRecoveredFactor } from "./actions";

export const metadata = { title: "Segundo fator" };

const dt = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

interface Row {
  id: string;
  email: string;
  area: RecoveryArea;
  agency_id: string;
  reason: string | null;
  status: RecoveryStatus;
  created_at: string;
  confirmed_at: string | null;
  available_at: string | null;
  closed_at: string | null;
  closed_by: string | null;
  close_note: string | null;
  agencies: { name: string } | null;
  clients: { name: string } | null;
}

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

/**
 * Recuperação do segundo fator (itens menores da conferência de 20/10, parte 4): os pedidos de
 * quem perdeu o app autenticador. O botão de remover só aparece no pedido confirmado pelo e-mail,
 * depois das 48 horas; antes, a equipe confere com a agência se o pedido é dela.
 */
export default async function AdminMfaRecovery() {
  await requireAdmin("/admin/segundo-fator");
  const { data } = await createAdminClient()
    .from("mfa_recovery_requests")
    .select("id, email, area, agency_id, reason, status, created_at, confirmed_at, available_at, closed_at, closed_by, close_note, agencies(name), clients(name)")
    .order("created_at", { ascending: false })
    .limit(150);
  const now = new Date();
  const rows = ((data ?? []) as unknown as Array<Omit<Row, "agencies" | "clients"> & { agencies: Row["agencies"] | Row["agencies"][]; clients: Row["clients"] | Row["clients"][] }>).map((r) => ({ ...r, agencies: one(r.agencies), clients: one(r.clients), status: effectiveStatus(r, now) }));
  const open = rows.filter((r) => r.status === "pendente" || r.status === "confirmado");
  const closed = rows.filter((r) => r.status !== "pendente" && r.status !== "confirmado");

  return (
    <>
      <div>
        <h1 className="text-[26px] font-normal">Segundo fator</h1>
        <p className="text-sm text-muted">
          Pedidos de quem perdeu o app autenticador (painel e área do cliente). O pedido vale depois do link do e-mail; a remoção só libera {RECOVERY_WAIT_HOURS} horas depois da confirmação. Antes de remover, confira com o dono da agência (pelo contato do cadastro) se o pedido é mesmo da equipe dele ou do cliente dele.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Em aberto</h2>
        {open.length === 0 && <p className="text-sm text-muted">Nenhum pedido em aberto.</p>}
        {open.map((r) => {
          const ready = recoveryReady(r, now);
          return (
            <article key={r.id} className="card flex flex-col gap-3 p-4 text-sm">
              <p>
                <span className="font-semibold">{r.email}</span> · {r.area === "cliente" ? `área do cliente${r.clients ? ` (${r.clients.name})` : ""}` : "painel"} ·{" "}
                <Link href={`/admin/clientes/${r.agency_id}`} className="underline">{r.agencies?.name ?? "agência"}</Link> · pedido em {dt(r.created_at)}
              </p>
              {r.reason && <p className="text-xs text-muted">O que aconteceu: {r.reason}</p>}
              <p className={ready ? "font-semibold text-danger" : "text-muted"}>
                {r.status === "pendente" ? RECOVERY_STATUS_LABEL.pendente : ready ? "Pronto para remover" : `Confirmado em ${dt(r.confirmed_at!)}; a remoção libera em ${dt(r.available_at!)}`}
              </p>
              <div className="flex flex-wrap items-start gap-3">
                {ready && (
                  // o e-mail sozinho não basta (M12): a conferência por outro canal fica no pedido e na auditoria
                  <ActionForm action={removeRecoveredFactor.bind(null, r.id)} className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row">
                    <input name="check" required minLength={10} maxLength={300} placeholder="Como conferiu a pessoa fora do e-mail (WhatsApp do dono, outro administrador…)" className="input" />
                    <SubmitButton className="btn-primary shrink-0 text-xs" pendingLabel="Removendo…">Remover o segundo fator</SubmitButton>
                  </ActionForm>
                )}
                <ActionForm action={refuseRecovery.bind(null, r.id)} className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row">
                  <input name="note" required minLength={3} maxLength={300} placeholder="Motivo da recusa (vai no e-mail à pessoa)" className="input" />
                  <SubmitButton className="btn-ghost shrink-0 text-xs" pendingLabel="Recusando…">Recusar</SubmitButton>
                </ActionForm>
              </div>
            </article>
          );
        })}
      </section>

      <section className="card overflow-x-auto">
        <h2 className="px-4 pt-4 text-lg font-medium">Encerrados</h2>
        {closed.length === 0 ? (
          <p className="px-4 pb-4 pt-2 text-sm text-muted">Nenhum pedido encerrado.</p>
        ) : (
          <table className="mt-2 w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line-2 text-left text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                <th className="px-4 py-2">Pessoa</th>
                <th className="px-3 py-2">Agência</th>
                <th className="px-3 py-2">Pedido</th>
                <th className="px-3 py-2">Como terminou</th>
              </tr>
            </thead>
            <tbody>
              {closed.map((r) => (
                <tr key={r.id} className="border-b border-line-2 last:border-0">
                  <td className="px-4 py-2">{r.email}<span className="block text-xs text-muted">{r.area === "cliente" ? `área do cliente${r.clients ? ` (${r.clients.name})` : ""}` : "painel"}</span></td>
                  <td className="px-3 py-2">{r.agencies?.name ?? "—"}</td>
                  <td className="px-3 py-2 tabular">{dt(r.created_at)}</td>
                  <td className="px-3 py-2">
                    {RECOVERY_STATUS_LABEL[r.status]}
                    {(r.closed_by || r.closed_at) && <span className="block text-xs text-muted">{[r.closed_by, r.closed_at ? dt(r.closed_at) : null].filter(Boolean).join(" · ")}</span>}
                    {r.close_note && <span className="block text-xs text-muted">Motivo: {r.close_note}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
