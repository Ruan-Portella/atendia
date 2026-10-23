import { ConfirmAction } from "@/components/ui/confirm-action";
import { liftMeasure } from "@/app/admin/(protegido)/acoes";
import type { MeasureRow } from "@/lib/backoffice";
import { relativeTime } from "@/lib/utils";

const CHANNEL_LABEL: Record<string, string> = { all: "todos os canais", whatsapp: "WhatsApp", instagram: "Instagram", widget: "site" };
const SOURCE_LABEL: Record<MeasureRow["source"], string> = { boavoz: "BoaVoz", meta_order: "Ordem da Meta", meta_violation: "Infração na Meta", meta_restriction: "Restrição da Meta" };
const FEATURE_LABEL: Record<MeasureRow["feature"], string> = { channel: "bloqueia o canal", regulados: "regulados (só registro)", restricao: "restrição (só registro)", outro: "só registro" };

/** Lista de medidas (BoaVoz e Meta), com "Levantar" nas ativas. */
export function MeasureList({ measures, showAgency = false, empty = "Nenhuma medida." }: { measures: MeasureRow[]; showAgency?: boolean; empty?: string }) {
  if (!measures.length) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="flex flex-col divide-y divide-line-2 text-sm">
      {measures.map((m) => (
        <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
          <div className="min-w-0">
            <span className={`font-semibold ${!m.liftedAt && m.feature === "channel" ? "text-danger" : ""}`}>{SOURCE_LABEL[m.source]}</span>
            <span className="text-muted"> · {CHANNEL_LABEL[m.channel] ?? m.channel} · {FEATURE_LABEL[m.feature]}</span>
            {showAgency && m.agencyName && <span className="text-muted"> · {m.agencyName}</span>}
            {m.botLabel && <span className="text-muted"> · {m.botLabel}</span>}
            {m.wabaId && <span className="text-muted"> · WABA {m.wabaId}</span>}
            <div className="text-xs text-muted">
              {m.reason ?? "sem motivo"} · {relativeTime(m.createdAt)}{m.createdBy ? ` por ${m.createdBy}` : ""}
              {m.liftedAt && ` · levantada ${relativeTime(m.liftedAt)}${m.liftedBy ? ` por ${m.liftedBy}` : ""}`}
            </div>
          </div>
          {!m.liftedAt && (
            <ConfirmAction action={liftMeasure.bind(null, m.id)} title="Levantar esta medida?" description={m.source === "boavoz" ? "O canal volta a funcionar se nada mais o bloqueia." : "Só levante uma medida da Meta quando ela tiver sido resolvida no Gerenciador do WhatsApp."} confirmLabel="Levantar" danger={false} className="btn-ghost shrink-0 py-1.5 text-xs">
              Levantar
            </ConfirmAction>
          )}
        </li>
      ))}
    </ul>
  );
}
