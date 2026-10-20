import type { ReguaPanelItem } from "@/lib/reguas";
import { REGUA_CATEGORY, REGUA_DELAY, REGUA_DESCRIPTION, REGUA_HAS_SEND_HOUR, REGUA_LABEL, REGUA_VARIABLES } from "@/lib/regua-kinds";
import { costText } from "@/lib/campaigns";
import type { ActionResult } from "@/lib/action-result";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";

const STATE_PILL: Record<ReguaPanelItem["state"], { label: string; className: string }> = {
  ligada: { label: "ligada", className: "bg-brand-soft text-brand" },
  pausada: { label: "pausada", className: "bg-amber-soft text-amber-ink" },
  desligada: { label: "desligada", className: "bg-ground text-muted" },
};
const CATEGORY_LABEL: Record<string, string> = { MARKETING: "marketing", UTILITY: "utilidade" };
const HOURS = Array.from({ length: 12 }, (_, i) => i + 8);

type Act = (formData: FormData) => Promise<ActionResult>;

/**
 * Uma régua na tela Réguas (leva Réguas, parte 4): a situação, o prazo e a hora, o modelo da Meta
 * (o texto sugerido, editável, vai para análise), a estimativa dos próximos 30 dias, os números do
 * que já saiu e ligar ou desligar.
 */
export function ReguaCard({ item: it, actions }: { item: ReguaPanelItem; actions: { settings: Act; template: Act; on: Act; off: Act } }) {
  const delay = REGUA_DELAY[it.kind];
  const pill = STATE_PILL[it.state];
  const newTemplate = Boolean(it.inUse && it.regua?.template_name && it.inUse !== it.regua.template_name);
  return (
    <section id={it.kind} className="card flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-semibold">{REGUA_LABEL[it.kind]}</h2>
          <p className="text-sm text-muted">{REGUA_DESCRIPTION[it.kind]}</p>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${pill.className}`}>{pill.label}</span>
      </div>
      {it.state === "pausada" && <p className="rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink">A régua parou{it.pauseReason ? `: ${it.pauseReason}` : ""}. Confira e toque em “Retomar”.</p>}

      {(delay || REGUA_HAS_SEND_HOUR[it.kind]) && (
        <ActionForm action={actions.settings} success="Régua salva." className="flex flex-wrap items-end gap-3">
          {delay && (
            <div>
              <label htmlFor={`regua-prazo-${it.kind}`} className="label">
                {it.kind === "lembrete" ? "Quantas horas antes" : `Prazo (${delay.unit})`}
              </label>
              <input id={`regua-prazo-${it.kind}`} name="delay" type="number" min={delay.min} max={delay.max} defaultValue={it.delay ?? delay.default} className="input w-28" />
            </div>
          )}
          {REGUA_HAS_SEND_HOUR[it.kind] && (
            <div>
              <label htmlFor={`regua-hora-${it.kind}`} className="label">Hora do envio</label>
              <select id={`regua-hora-${it.kind}`} name="send_hour" defaultValue={it.sendHour} className="input w-28">
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {h}h
                  </option>
                ))}
              </select>
            </div>
          )}
          <SubmitButton className="btn-ghost">Salvar</SubmitButton>
        </ActionForm>
      )}

      <div className="flex flex-col gap-2 rounded-xl border border-line p-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="font-semibold">Modelo da Meta</span>
          <span className="text-muted">
            {it.regua?.template_name ?? "ainda não criado"} · {it.template.label}
          </span>
          {newTemplate && <span className="text-xs text-muted">(em uso: {it.inUse})</span>}
        </div>
        {it.template.reclassified && it.template.category && <p className="text-xs text-amber-ink">A Meta classificou este modelo como {CATEGORY_LABEL[it.template.category] ?? it.template.category}: ligada, a régua só vai para quem aceitou novidades.</p>}
        <details open={it.template.status === "ausente" || it.template.status === "recusado"}>
          <summary className="cursor-pointer text-sm font-semibold text-brand">{it.template.status === "ausente" ? "Criar o modelo" : "Trocar o texto"}</summary>
          <ActionForm action={actions.template} success="Modelo enviado para a Meta." className="mt-2 flex flex-col gap-2">
            <label htmlFor={`regua-texto-${it.kind}`} className="sr-only">Texto do modelo</label>
            <textarea id={`regua-texto-${it.kind}`} name="body" rows={4} maxLength={1024} defaultValue={it.draft} className="input" />
            <p className="text-xs text-muted">
              Variáveis: {REGUA_VARIABLES[it.kind].map((v, i) => `{{${i + 1}}} ${v}`).join(", ")}. Categoria pedida à Meta: {CATEGORY_LABEL[REGUA_CATEGORY[it.kind]]}
              {REGUA_CATEGORY[it.kind] === "MARKETING" ? ", com o botão “Parar promoções”" : ", sem oferta nem promoção (senão a Meta muda para marketing)"}. A análise costuma levar minutos.
            </p>
            <SubmitButton className="btn-ghost self-start" pendingLabel="Enviando…">
              Enviar para a Meta
            </SubmitButton>
          </ActionForm>
        </details>
      </div>

      <div className="flex flex-col gap-1 text-sm text-ink-2">
        <p>
          Próximos 30 dias: até <strong>{it.estimate.people}</strong> {it.estimate.people === 1 ? "pessoa" : "pessoas"} ({costText(it.estimate.costBrl)} na Meta, antes do aceite, do SAIR e da regra de uma régua por dia).
        </p>
        {it.numbers && (
          <p className="text-xs text-muted">
            Até agora: {it.numbers.sent} enviadas · {it.numbers.delivered} entregues · {it.numbers.read} lidas · {it.numbers.replied} respostas · {it.numbers.optOuts} descadastros · {it.numbers.skipped} ficaram de fora · {it.numbers.pending} na fila
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {it.state === "ligada" ? (
          <ActionForm action={actions.off} success="Régua desligada.">
            <SubmitButton className="btn-ghost" pendingLabel="Desligando…">
              Desligar
            </SubmitButton>
          </ActionForm>
        ) : (
          <ActionForm action={actions.on} success="Régua ligada.">
            <SubmitButton className="btn-primary" pendingLabel="Ligando…" disabled={it.template.status !== "aprovado"}>
              {it.state === "pausada" ? "Retomar" : "Ligar"}
            </SubmitButton>
          </ActionForm>
        )}
        {it.state === "ligada" && newTemplate && it.template.status === "aprovado" && (
          <ActionForm action={actions.on} success="A régua passou a usar o modelo novo.">
            <SubmitButton className="btn-ghost">Usar o modelo novo</SubmitButton>
          </ActionForm>
        )}
        {it.template.status !== "aprovado" && it.state !== "ligada" && <span className="self-center text-xs text-muted">Liga depois que a Meta aprovar o modelo.</span>}
      </div>
    </section>
  );
}
