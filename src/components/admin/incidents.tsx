import { Plus, ShieldAlert } from "lucide-react";
import { DialogButton, SettingRow, SwitchField } from "@/components/ui/setting-row";
import { StatusPill } from "@/components/ui/form-section";
import { createIncident, updateIncident } from "@/app/admin/(protegido)/acoes";
import type { IncidentRow } from "@/lib/backoffice";
import { relativeTime } from "@/lib/utils";

const SEVERITY: Record<IncidentRow["severity"], { label: string; tone: "danger" | "warn" | "muted" }> = {
  alto: { label: "alta", tone: "danger" },
  medio: { label: "média", tone: "warn" },
  baixo: { label: "baixa", tone: "muted" },
};
const STATUS: Record<IncidentRow["status"], string> = { aberto: "aberto", contido: "contido", encerrado: "encerrado" };
const when = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
const HELP = "Suspeita de dado acessado, vazado ou perdido sem autorização: registre na hora e siga o roteiro (docs/incidentes.md): conter, avaliar o risco, avisar as agências em até 48 h e, quando a BoaVoz é a controladora e há risco relevante, a ANPD em até 3 dias úteis. Nunca escreva dado pessoal aqui: use contagens e tipos. Severidade alta avisa o e-mail de alertas da plataforma.";

/**
 * Registro de incidentes de segurança (roteiro em docs/incidentes.md; guardado 5 anos). Rodada 2
 * das telas (23/10/2026): registrar abre um modal, e cada incidente é uma linha que abre o modal de
 * atualizar (situação, risco, ações e os avisos dados).
 */
export function IncidentRegister({ incidents }: { incidents: IncidentRow[] }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h3 className="kpi-label">Incidentes de segurança</h3>
        <DialogButton label="Registrar incidente" icon={<Plus size={14} />} className="btn-ghost py-1.5 text-[13px] text-danger" title="Registrar incidente" description={HELP} action={createIncident} saveLabel="Registrar" size="lg">
          <div>
            <label htmlFor="inc-titulo" className="label">
              Título
            </label>
            <input id="inc-titulo" name="title" required minLength={3} maxLength={200} placeholder="Ex.: token do WhatsApp exposto em log" className="input" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="inc-severidade" className="label">
                Severidade
              </label>
              <select id="inc-severidade" name="severity" defaultValue="medio" className="input">
                <option value="alto">Alta</option>
                <option value="medio">Média</option>
                <option value="baixo">Baixa</option>
              </select>
            </div>
            <div>
              <label htmlFor="inc-detectado" className="label">
                Detectado em
              </label>
              <input id="inc-detectado" name="detected_at" type="datetime-local" className="input" />
            </div>
          </div>
          <div>
            <label htmlFor="inc-descricao" className="label">
              O que aconteceu e como foi descoberto
            </label>
            <textarea id="inc-descricao" name="description" rows={3} maxLength={4000} className="input" />
          </div>
          <div>
            <label htmlFor="inc-afetados" className="label">
              Quem e quantos (agências, negócios, contatos) e que tipo de dado
            </label>
            <textarea id="inc-afetados" name="affected" rows={2} maxLength={4000} className="input" />
          </div>
        </DialogButton>
      </div>
      <div className="card flex flex-col divide-y divide-line-2 overflow-hidden">
        {incidents.length === 0 && <p className="px-4 py-5 text-sm text-muted">Nenhum incidente registrado.</p>}
        {incidents.map((i) => (
          <SettingRow
            key={i.id}
            icon={<ShieldAlert size={18} />}
            title={i.title}
            badge={<StatusPill tone={SEVERITY[i.severity].tone}>{SEVERITY[i.severity].label}</StatusPill>}
            summary={`${STATUS[i.status]} · detectado ${when(i.detectedAt)}${i.closedAt ? ` · encerrado ${when(i.closedAt)}` : ""} · agências avisadas: ${i.agenciesNotifiedAt ? when(i.agenciesNotifiedAt) : "não"} · ANPD: ${i.anpdNotifiedAt ? when(i.anpdNotifiedAt) : "não"}`}
            summaryTone={i.status === "aberto" ? "warn" : "muted"}
            dialogTitle={i.title}
            description={
              <>
                {i.description && <span className="block whitespace-pre-line">{i.description}</span>}
                <span className="mt-1 block">
                  Risco relevante: {i.riskRelevant === null ? "em avaliação" : i.riskRelevant ? "sim" : "não"}
                  {i.updatedBy && ` · atualizado ${relativeTime(i.updatedAt)} por ${i.updatedBy}`}
                </span>
              </>
            }
            action={updateIncident.bind(null, i.id)}
            size="lg"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor={`inc-${i.id}-status`} className="label">
                  Situação
                </label>
                <select id={`inc-${i.id}-status`} name="status" defaultValue={i.status} className="input">
                  <option value="aberto">Aberto</option>
                  <option value="contido">Contido</option>
                  <option value="encerrado">Encerrado</option>
                </select>
              </div>
              <div>
                <label htmlFor={`inc-${i.id}-risco`} className="label">
                  Risco relevante
                </label>
                <select id={`inc-${i.id}-risco`} name="risk_relevant" defaultValue={i.riskRelevant === null ? "" : i.riskRelevant ? "sim" : "nao"} className="input">
                  <option value="">Em avaliação</option>
                  <option value="sim">Sim</option>
                  <option value="nao">Não</option>
                </select>
              </div>
            </div>
            <div>
              <label htmlFor={`inc-${i.id}-acoes`} className="label">
                Contenção e correção (com horários), causa e o que muda
              </label>
              <textarea id={`inc-${i.id}-acoes`} name="actions" rows={3} maxLength={4000} defaultValue={i.actions ?? ""} className="input" />
            </div>
            <div>
              <label htmlFor={`inc-${i.id}-afetados`} className="label">
                Quem e quantos, que tipo de dado
              </label>
              <textarea id={`inc-${i.id}-afetados`} name="affected" rows={2} maxLength={4000} defaultValue={i.affected ?? ""} className="input" />
            </div>
            {!i.agenciesNotifiedAt && <SwitchField name="agencies_notified" label="Agências afetadas avisadas agora" hint="Grava a hora do aviso." />}
            {!i.anpdNotifiedAt && <SwitchField name="anpd_notified" label="ANPD avisada agora" hint="Grava a hora do aviso." />}
          </SettingRow>
        ))}
      </div>
    </section>
  );
}
