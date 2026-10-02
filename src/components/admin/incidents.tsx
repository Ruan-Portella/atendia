import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { createIncident, updateIncident } from "@/app/admin/(protegido)/acoes";
import type { IncidentRow } from "@/lib/backoffice";
import { relativeTime } from "@/lib/utils";

const SEVERITY: Record<IncidentRow["severity"], { label: string; tone: string }> = {
  alto: { label: "alta", tone: "bg-danger-soft text-danger" },
  medio: { label: "média", tone: "bg-amber-soft text-amber-ink" },
  baixo: { label: "baixa", tone: "bg-ground text-muted" },
};
const STATUS: Record<IncidentRow["status"], string> = { aberto: "aberto", contido: "contido", encerrado: "encerrado" };
const when = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

/** Registro de incidentes de segurança (roteiro em docs/incidentes.md; guardado 5 anos). */
export function IncidentRegister({ incidents }: { incidents: IncidentRow[] }) {
  return (
    <section className="card flex flex-col gap-3 p-5">
      <h2 className="text-base font-bold">Incidentes de segurança</h2>
      <p className="text-xs text-muted">
        Suspeita de dado acessado, vazado ou perdido sem autorização: registre na hora e siga o roteiro (docs/incidentes.md): conter, avaliar o risco, avisar as agências em até 48 h e, quando a BoaVoz é a controladora e há risco relevante, a ANPD em até 3 dias úteis. Nunca escreva dado pessoal aqui: use contagens e tipos. Severidade alta avisa o e-mail de alertas da plataforma.
      </p>

      <details className="rounded-xl border border-line p-4 text-sm">
        <summary className="cursor-pointer font-semibold">Registrar incidente</summary>
        <ActionForm action={createIncident} className="mt-3 flex flex-col gap-2">
          <input name="title" required minLength={3} maxLength={200} placeholder="Título (ex.: token do WhatsApp exposto em log)" className="input" />
          <div className="flex flex-col gap-2 sm:flex-row">
            <select name="severity" defaultValue="medio" className="input sm:w-auto">
              <option value="alto">Severidade alta</option>
              <option value="medio">Severidade média</option>
              <option value="baixo">Severidade baixa</option>
            </select>
            <label className="flex items-center gap-2 text-xs text-muted">
              Detectado em
              <input name="detected_at" type="datetime-local" className="input w-auto" />
            </label>
          </div>
          <textarea name="description" rows={3} maxLength={4000} placeholder="O que aconteceu e como foi descoberto" className="input" />
          <textarea name="affected" rows={2} maxLength={4000} placeholder="Quem e quantos (agências, negócios, contatos) e que tipo de dado" className="input" />
          <SubmitButton className="btn-danger self-start" pendingLabel="Registrando…">Registrar</SubmitButton>
        </ActionForm>
      </details>

      {incidents.length ? (
        <ul className="flex flex-col divide-y divide-line-2 text-sm">
          {incidents.map((i) => (
            <li key={i.id} className="flex flex-col gap-2 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <strong>{i.title}</strong>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${SEVERITY[i.severity].tone}`}>{SEVERITY[i.severity].label}</span>
                <span className="text-xs text-muted">{STATUS[i.status]} · detectado {when(i.detectedAt)}{i.closedAt ? ` · encerrado ${when(i.closedAt)}` : ""}</span>
              </div>
              {i.description && <p className="whitespace-pre-line text-xs text-ink-2">{i.description}</p>}
              <div className="text-xs text-muted">
                Agências avisadas: {i.agenciesNotifiedAt ? when(i.agenciesNotifiedAt) : "não"} · ANPD avisada: {i.anpdNotifiedAt ? when(i.anpdNotifiedAt) : "não"} · risco relevante: {i.riskRelevant === null ? "em avaliação" : i.riskRelevant ? "sim" : "não"}
                {i.updatedBy && ` · atualizado ${relativeTime(i.updatedAt)} por ${i.updatedBy}`}
              </div>
              <details className="text-sm">
                <summary className="cursor-pointer text-xs font-semibold text-muted">Atualizar</summary>
                <ActionForm action={updateIncident.bind(null, i.id)} className="mt-2 flex flex-col gap-2">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <select name="status" defaultValue={i.status} className="input sm:w-auto">
                      <option value="aberto">Aberto</option>
                      <option value="contido">Contido</option>
                      <option value="encerrado">Encerrado</option>
                    </select>
                    <select name="risk_relevant" defaultValue={i.riskRelevant === null ? "" : i.riskRelevant ? "sim" : "nao"} className="input sm:w-auto">
                      <option value="">Risco relevante: em avaliação</option>
                      <option value="sim">Risco relevante: sim</option>
                      <option value="nao">Risco relevante: não</option>
                    </select>
                  </div>
                  <textarea name="actions" rows={3} maxLength={4000} defaultValue={i.actions ?? ""} placeholder="Contenção e correção (com horários), causa e o que muda" className="input" />
                  <textarea name="affected" rows={2} maxLength={4000} defaultValue={i.affected ?? ""} placeholder="Quem e quantos, que tipo de dado" className="input" />
                  {!i.agenciesNotifiedAt && <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="agencies_notified" /> Agências afetadas avisadas agora</label>}
                  {!i.anpdNotifiedAt && <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="anpd_notified" /> ANPD avisada agora</label>}
                  <SubmitButton className="btn-ghost self-start" pendingLabel="Salvando…">Salvar</SubmitButton>
                </ActionForm>
              </details>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Nenhum incidente registrado.</p>
      )}
    </section>
  );
}
