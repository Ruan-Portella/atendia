import Link from "next/link";
import { requireAdmin } from "@/lib/platform-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { LEVEL_LABEL, STATE_LABEL, STATUS_COMPONENTS, STATUS_THRESHOLDS, loadStatusPage } from "@/lib/status";
import { addStatusUpdate, checkStatusNow, createStatusIncident, resolveStatusIncident } from "./actions";

export const metadata = { title: "Status" };

const dt = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/**
 * Página de status no backoffice: o estado automático de cada parte (e o motivo), os incidentes em
 * aberto com as atualizações e o "Abrir incidente". O que se escreve aqui sai na página pública.
 */
export default async function AdminStatus() {
  await requireAdmin("/admin/status");
  const db = createAdminClient();
  const [page, { data: auto }] = await Promise.all([loadStatusPage(db), db.from("status_current").select("component, state, reason, since, pending_state")]);
  const autoBy = new Map((auto ?? []).map((a) => [a.component as string, a]));

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold">Status</h1>
          <p className="text-sm text-muted">
            O que sai em <Link href="/status" className="underline" target="_blank">/status</Link> (e status.boavoz.com). O automático confere a cada {STATUS_THRESHOLDS.checkEveryMinutes} minutos e só muda com duas leituras iguais; o incidente escrito aqui vale por cima.
          </p>
        </div>
        <ActionForm action={checkStatusNow}>
          <SubmitButton className="btn-ghost" pendingLabel="Conferindo…">Conferir agora</SubmitButton>
        </ActionForm>
      </div>

      <section className="card overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-line-2 text-left text-xs font-semibold uppercase tracking-[0.06em] text-muted">
              <th className="px-4 py-2">Parte</th>
              <th className="px-3 py-2">Automático</th>
              <th className="px-3 py-2">Na página</th>
            </tr>
          </thead>
          <tbody>
            {page.components.map((c) => {
              const a = autoBy.get(c.id);
              return (
                <tr key={c.id} className="border-b border-line-2 last:border-0">
                  <td className="px-4 py-2 font-semibold">{c.label}</td>
                  <td className="px-3 py-2">
                    {STATE_LABEL[(a?.state as keyof typeof STATE_LABEL) ?? "operando"]}
                    {a?.reason ? <span className="block text-xs text-muted">{a.reason as string}</span> : null}
                    {a?.pending_state ? <span className="block text-xs text-amber-ink">a próxima leitura pode mudar para {STATE_LABEL[a.pending_state as keyof typeof STATE_LABEL].toLowerCase()}</span> : null}
                  </td>
                  <td className="px-3 py-2">{STATE_LABEL[c.state]}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">Em aberto</h2>
        {page.open.length === 0 && <p className="text-sm text-muted">Nenhum incidente em aberto.</p>}
        {page.open.map((i) => (
          <article key={i.id} className="card flex flex-col gap-3 p-4 text-sm">
            <p>
              <span className="font-semibold">{i.title}</span> · {LEVEL_LABEL[i.level]} · {i.components.map((c) => STATUS_COMPONENTS.find((x) => x.id === c)?.label ?? c).join(", ")} · desde {dt(i.startedAt)}
            </p>
            <ol className="flex flex-col gap-1 border-l-2 border-line pl-3 text-xs">
              {i.updates.map((u, n) => (
                <li key={n}><span className="text-muted">{dt(u.at)}</span> {u.body}</li>
              ))}
            </ol>
            <ActionForm action={addStatusUpdate.bind(null, i.id)} className="flex flex-col gap-2 sm:flex-row">
              <input name="body" required minLength={3} maxLength={1000} placeholder="Atualização (o que mudou, previsão)" className="input" />
              <SubmitButton className="btn-ghost shrink-0" pendingLabel="Publicando…">Publicar atualização</SubmitButton>
            </ActionForm>
            <ActionForm action={resolveStatusIncident.bind(null, i.id)} className="flex flex-col gap-2 sm:flex-row">
              <input name="body" maxLength={1000} placeholder="Texto do fim (opcional: “Resolvido. Tudo voltou ao normal.”)" className="input" />
              <SubmitButton className="btn-primary shrink-0" pendingLabel="Resolvendo…">Resolver</SubmitButton>
            </ActionForm>
          </article>
        ))}
      </section>

      <section className="card flex flex-col gap-3 p-5 text-sm">
        <h2 className="text-lg font-bold">Abrir incidente</h2>
        <ActionForm action={createStatusIncident} className="flex flex-col gap-3">
          <input name="title" required minLength={3} maxLength={120} placeholder="Título (ex.: Atraso nas respostas do WhatsApp)" className="input" />
          <select name="level" defaultValue="instabilidade" className="input w-auto" aria-label="Tipo">
            <option value="instabilidade">Instabilidade</option>
            <option value="fora">Fora do ar</option>
            <option value="manutencao">Manutenção</option>
          </select>
          <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
            <legend className="mb-1 text-xs font-semibold">Partes afetadas</legend>
            {STATUS_COMPONENTS.map((c) => (
              <label key={c.id} className="flex items-center gap-1.5">
                <input type="checkbox" name={`c_${c.id}`} className="h-4 w-4 accent-brand" /> {c.label}
              </label>
            ))}
          </fieldset>
          <textarea name="body" required minLength={3} maxLength={1000} rows={3} placeholder="O primeiro aviso: o que está acontecendo, quem é afetado e quando volta a notícia" className="input" />
          <SubmitButton className="btn-primary self-start" pendingLabel="Publicando…">Publicar na página de status</SubmitButton>
        </ActionForm>
      </section>

      {page.past.length > 0 && (
        <section className="flex flex-col gap-2 text-sm">
          <h2 className="text-lg font-bold">Resolvidos (90 dias)</h2>
          {page.past.map((i) => (
            <p key={i.id} className="text-muted">
              {dt(i.startedAt)} · <span className="font-semibold text-ink">{i.title}</span> · {LEVEL_LABEL[i.level]} · resolvido em {i.resolvedAt ? dt(i.resolvedAt) : "?"}
            </p>
          ))}
        </section>
      )}
    </>
  );
}
