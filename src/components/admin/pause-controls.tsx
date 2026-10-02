import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { extendTrial, pauseAgencyAi, pauseAllAi, resumeAgencyAi, resumeAllAi } from "@/app/admin/(protegido)/acoes";
import type { AgencyRow } from "@/lib/backoffice";
import { relativeTime } from "@/lib/utils";

const WHAT_HAPPENS = "No WhatsApp e no Instagram, as mensagens ficam guardadas, viram pedido de atendente e o contato recebe uma vez o aviso fixo. No site, o widget mostra o formulário de contato.";

/** Chave geral: a IA de todas as agências para de uma vez (emergência). */
export function GlobalKillSwitch({ flags }: { flags: { aiPausedAt: string | null; aiPausedReason: string | null; updatedBy: string | null } }) {
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
    </section>
  );
}
