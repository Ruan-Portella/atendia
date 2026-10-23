import Link from "next/link";
import { requireAdmin } from "@/lib/platform-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { DialogButton, SettingGroup, SettingRow } from "@/components/ui/setting-row";
import { StatusPill } from "@/components/ui/form-section";
import { Megaphone, Plus } from "lucide-react";
import { LEVEL_LABEL, STATE_LABEL, STATUS_COMPONENTS, STATUS_THRESHOLDS, loadStatusPage } from "@/lib/status";
import { addStatusUpdate, checkStatusNow, createStatusIncident, resolveStatusIncident } from "./actions";

export const metadata = { title: "Status" };

const dt = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/**
 * Página de status no backoffice: o estado automático de cada parte (e o motivo), os incidentes em
 * aberto com as atualizações e o "Abrir incidente". O que se escreve aqui sai na página pública.
 * Rodada 2 das telas (23/10/2026, a pedido do usuário): o "Abrir incidente" num modal, no alto, e
 * cada incidente em aberto numa linha que abre o modal com as atualizações e o "Resolver".
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
          <h1 className="text-[26px] font-normal">Status</h1>
          <p className="text-sm text-muted">
            O que sai em <Link href="/status" className="underline" target="_blank">/status</Link> (e status.boavoz.com). O automático confere a cada {STATUS_THRESHOLDS.checkEveryMinutes} minutos e só muda com duas leituras iguais; o incidente escrito aqui vale por cima.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ActionForm action={checkStatusNow}>
            <SubmitButton className="btn-ghost" pendingLabel="Conferindo…">Conferir agora</SubmitButton>
          </ActionForm>
          <DialogButton label="Abrir incidente" icon={<Plus size={15} />} className="btn-primary" title="Abrir incidente" description="Sai na hora na página de status pública, com o primeiro aviso." action={createStatusIncident} saveLabel="Publicar na página de status" size="lg">
            <div>
              <label htmlFor="inc-status-titulo" className="label">
                Título
              </label>
              <input id="inc-status-titulo" name="title" required minLength={3} maxLength={120} placeholder="Ex.: Atraso nas respostas do WhatsApp" className="input" />
            </div>
            <div>
              <label htmlFor="inc-status-tipo" className="label">
                Tipo
              </label>
              <select id="inc-status-tipo" name="level" defaultValue="instabilidade" className="input">
                <option value="instabilidade">Instabilidade</option>
                <option value="fora">Fora do ar</option>
                <option value="manutencao">Manutenção</option>
              </select>
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className="label">Partes afetadas</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {STATUS_COMPONENTS.map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-center gap-2.5 rounded-[12px] border border-line px-3 py-2 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft/60">
                    <input type="checkbox" name={`c_${c.id}`} className="h-4 w-4 accent-brand" /> {c.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <div>
              <label htmlFor="inc-status-aviso" className="label">
                O primeiro aviso
              </label>
              <textarea id="inc-status-aviso" name="body" required minLength={3} maxLength={1000} rows={3} placeholder="O que está acontecendo, quem é afetado e quando volta a notícia" className="input" />
            </div>
          </DialogButton>
        </div>
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

      <SettingGroup title="Incidentes em aberto">
        {page.open.length === 0 && <p className="px-4 py-5 text-sm text-muted">Nenhum incidente em aberto.</p>}
        {page.open.map((i) => (
          <SettingRow
            key={i.id}
            icon={<Megaphone size={18} />}
            title={i.title}
            badge={<StatusPill tone={i.level === "fora" ? "danger" : i.level === "manutencao" ? "muted" : "warn"}>{LEVEL_LABEL[i.level]}</StatusPill>}
            summary={`${i.components.map((c) => STATUS_COMPONENTS.find((x) => x.id === c)?.label ?? c).join(", ") || "sem parte marcada"} · desde ${dt(i.startedAt)} · ${i.updates.length} ${i.updates.length === 1 ? "aviso" : "avisos"}`}
            summaryTone="warn"
            dialogTitle={i.title}
            size="lg"
            footer="close"
          >
            <ol className="flex flex-col gap-1 border-l-2 border-line pl-3 text-xs">
              {i.updates.map((u, n) => (
                <li key={n}>
                  <span className="text-muted">{dt(u.at)}</span> {u.body}
                </li>
              ))}
            </ol>
            <ActionForm action={addStatusUpdate.bind(null, i.id)} className="flex flex-col gap-2">
              <label htmlFor={`st-${i.id}-atualizacao`} className="label">
                Nova atualização
              </label>
              <textarea id={`st-${i.id}-atualizacao`} name="body" required minLength={3} maxLength={1000} rows={2} placeholder="O que mudou, previsão" className="input" />
              <SubmitButton className="btn-ghost self-start" pendingLabel="Publicando…">Publicar atualização</SubmitButton>
            </ActionForm>
            <ActionForm action={resolveStatusIncident.bind(null, i.id)} className="flex flex-col gap-2 rounded-[12px] bg-raised/60 p-3">
              <label htmlFor={`st-${i.id}-fim`} className="label">
                Texto do fim (opcional)
              </label>
              <input id={`st-${i.id}-fim`} name="body" maxLength={1000} placeholder="Resolvido. Tudo voltou ao normal." className="input" />
              <SubmitButton className="btn-primary self-start" pendingLabel="Resolvendo…">Resolver</SubmitButton>
            </ActionForm>
          </SettingRow>
        ))}
      </SettingGroup>

      {page.past.length > 0 && (
        <section className="flex flex-col gap-2 text-sm">
          <h2 className="text-lg font-medium">Resolvidos (90 dias)</h2>
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
