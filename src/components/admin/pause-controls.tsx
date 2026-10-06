import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { disableWhatsAppAll, enableWhatsAppAll, extendTrial, liftMeasure, pauseAgencyAi, pauseAllAi, resumeAgencyAi, resumeAllAi, setAgencyPlanManually, suspendChannel } from "@/app/admin/(protegido)/acoes";
import { manualPlanSwitch } from "@/lib/plan-limits";
import { PLANS } from "@/lib/plans";
import type { AgencyRow, MeasureRow, PlatformFlags } from "@/lib/backoffice";
import { relativeTime } from "@/lib/utils";

const WHAT_HAPPENS = "No WhatsApp e no Instagram, as mensagens ficam guardadas, viram pedido de atendente e o contato recebe uma vez o aviso fixo. No site, o widget mostra o formulário de contato.";

/** Chave geral: a IA de todas as agências para de uma vez (emergência). */
export function GlobalKillSwitch({ flags }: { flags: PlatformFlags }) {
  if (flags.aiPausedAt) {
    return (
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger">
        <div>
          <strong>A IA de TODAS as agências está pausada</strong> desde {relativeTime(flags.aiPausedAt)}{flags.updatedBy ? ` (${flags.updatedBy})` : ""}.
          {flags.aiPausedReason && <div className="text-xs">Motivo: {flags.aiPausedReason}</div>}
        </div>
        <ConfirmAction action={resumeAllAi} title="Religar a IA de todos?" description="Os bots voltam a responder com IA a partir da próxima mensagem." confirmLabel="Religar" danger={false} className="btn-primary">
          Religar a IA de todos
        </ConfirmAction>
      </section>
    );
  }
  return (
    <details className="group rounded-xl border border-line bg-panel px-4 py-3 text-sm">
      <summary className="cursor-pointer list-none font-semibold [&::-webkit-details-marker]:hidden">Chave geral da IA (emergência) <span className="font-normal text-muted">· ligada</span></summary>
      <ActionForm action={pauseAllAi} className="mt-3 flex flex-col gap-3">
        <p className="text-muted">Para a IA de todas as agências de uma vez (ex.: a IA começou a errar feio ou a OpenAI está fora). {WHAT_HAPPENS}</p>
        <input name="reason" required minLength={3} maxLength={200} placeholder="Motivo (fica registrado)" className="input" />
        <label className="flex items-start gap-2"><input type="checkbox" name="confirm" required className="mt-1" /> Entendi: todos os bots param de responder com IA até alguém religar.</label>
        <SubmitButton className="btn-danger-solid self-start" pendingLabel="Pausando…">Pausar a IA de todos</SubmitButton>
      </ActionForm>
    </details>
  );
}

/** Ações numa agência: pausar ou religar a IA e estender o teste. */
export function AgencyActions({ agency }: { agency: AgencyRow }) {
  return (
    <section className="card flex flex-col gap-4 p-5">
      <h2 className="text-lg font-bold">Ações</h2>
      {agency.aiPausedAt ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">
          <div><strong>IA pausada</strong> desde {relativeTime(agency.aiPausedAt)}{agency.aiPausedReason && <div className="text-xs">Motivo: {agency.aiPausedReason}</div>}</div>
          <ConfirmAction action={resumeAgencyAi.bind(null, agency.id)} title="Religar a IA desta agência?" description="Os bots dela voltam a responder com IA a partir da próxima mensagem." confirmLabel="Religar" danger={false} className="btn-primary">
            Religar a IA
          </ConfirmAction>
        </div>
      ) : (
        <ActionForm action={pauseAgencyAi.bind(null, agency.id)} className="flex flex-col gap-2">
          <span className="text-sm font-semibold">Pausar a IA desta agência</span>
          <p className="text-xs text-muted">{WHAT_HAPPENS} A agência vê um aviso no painel.</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input name="reason" required minLength={3} maxLength={200} placeholder="Motivo (fica registrado)" className="input" />
            <SubmitButton className="btn-danger shrink-0" pendingLabel="Pausando…">Pausar a IA</SubmitButton>
          </div>
        </ActionForm>
      )}
      {agency.plan === "trial" && (
        <ActionForm action={extendTrial.bind(null, agency.id)} className="flex flex-col gap-2 border-t border-line-2 pt-4">
          <span className="text-sm font-semibold">Estender o teste</span>
          <p className="text-xs text-muted">Hoje vai até {new Date(agency.trialEndsAt).toLocaleDateString("pt-BR")}. Conta a partir de hoje ou do fim atual, o que vier depois; os e-mails de fim de teste voltam a valer.</p>
          <div className="flex gap-2">
            <select name="days" defaultValue="7" className="input w-auto">
              {[3, 7, 14, 30].map((d) => <option key={d} value={d}>{d} dias</option>)}
            </select>
            <SubmitButton className="btn-ghost" pendingLabel="Estendendo…">Estender</SubmitButton>
          </div>
        </ActionForm>
      )}
      {manualPlanSwitch && (
        <ActionForm action={setAgencyPlanManually.bind(null, agency.id)} className="flex flex-col gap-2 border-t border-line-2 pt-4">
          <span className="text-sm font-semibold">Trocar o plano (sem Stripe)</span>
          <p className="text-xs text-muted">Só aparece fora da produção (staging). Aplica os limites do plano novo como o Stripe faria: o excedente fica pausado e a agência escolhe o que fica ativo em Cobrança &gt; Limites do plano.</p>
          <div className="flex gap-2">
            <select name="plan" defaultValue={agency.plan} className="input w-auto">
              {Object.values(PLANS).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <SubmitButton className="btn-ghost" pendingLabel="Trocando…">Trocar</SubmitButton>
          </div>
        </ActionForm>
      )}
    </section>
  );
}

/** Desligamento geral do WhatsApp (plano B da Meta): nada entra nem sai pela Cloud API. */
export function WhatsAppKillSwitch({ flags }: { flags: PlatformFlags }) {
  if (flags.whatsappDisabledAt) {
    return (
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger">
        <div>
          <strong>O WhatsApp de TODAS as agências está desligado</strong> desde {relativeTime(flags.whatsappDisabledAt)}{flags.updatedBy ? ` (${flags.updatedBy})` : ""}. Nada entra nem sai, nem a resposta da equipe.
          {flags.whatsappDisabledReason && <div className="text-xs">Motivo: {flags.whatsappDisabledReason}</div>}
        </div>
        <ConfirmAction action={enableWhatsAppAll} title="Religar o WhatsApp de todos?" description="As mensagens que chegarem a partir de agora voltam a ser recebidas e respondidas. As que chegaram com ele desligado não foram gravadas." confirmLabel="Religar" danger={false} className="btn-primary">
          Religar o WhatsApp
        </ConfirmAction>
      </section>
    );
  }
  return (
    <details className="group rounded-xl border border-line bg-panel px-4 py-3 text-sm">
      <summary className="cursor-pointer list-none font-semibold [&::-webkit-details-marker]:hidden">Desligar o WhatsApp de todos (plano B da Meta) <span className="font-normal text-muted">· ligado</span></summary>
      <ActionForm action={disableWhatsAppAll} className="mt-3 flex flex-col gap-3">
        <p className="text-muted">Para quando a Meta mandar parar a plataforma inteira. Nada entra nem sai pela API do WhatsApp: as mensagens que chegarem não são gravadas, a IA não responde e a equipe não consegue enviar pelo painel. Instagram e site seguem normais.</p>
        <input name="reason" required minLength={3} maxLength={200} placeholder="Motivo (fica registrado)" className="input" />
        <label className="flex items-start gap-2"><input type="checkbox" name="confirm" required className="mt-1" /> Entendi: nenhum WhatsApp recebe nem envia até alguém religar.</label>
        <SubmitButton className="btn-danger-solid self-start" pendingLabel="Desligando…">Desligar o WhatsApp de todos</SubmitButton>
      </ActionForm>
    </details>
  );
}

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

/** Suspensão de canal pela BoaVoz numa agência (ou num chatbot dela), com as medidas ativas. */
export function ChannelSuspension({ agencyId, bots, measures }: { agencyId: string; bots: Array<{ id: string; label: string }>; measures: MeasureRow[] }) {
  return (
    <section className="card flex flex-col gap-4 p-5">
      <h2 className="text-lg font-bold">Suspensão de canal</h2>
      <MeasureList measures={measures} empty="Nenhuma medida ativa nesta agência." />
      <ActionForm action={suspendChannel.bind(null, agencyId)} className="flex flex-col gap-2 border-t border-line-2 pt-4">
        <span className="text-sm font-semibold">Suspender</span>
        <p className="text-xs text-muted">Nada sai pelo canal, nem a resposta da equipe pelo painel. As mensagens que chegam ficam gravadas e o contato recebe uma vez o aviso de canal indisponível (nunca na coexistência). No site, o widget some.</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <select name="channel" defaultValue="all" className="input sm:w-auto">
            {Object.entries(CHANNEL_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select name="bot_id" defaultValue="" className="input sm:w-auto">
            <option value="">todos os chatbots</option>
            {bots.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input name="reason" required minLength={3} maxLength={200} placeholder="Motivo (fica registrado)" className="input" />
          <SubmitButton className="btn-danger shrink-0" pendingLabel="Suspendendo…">Suspender</SubmitButton>
        </div>
      </ActionForm>
    </section>
  );
}
