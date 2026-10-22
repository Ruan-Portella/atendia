import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ActionResult } from "@/lib/action-result";
import { MOMENT_NOTICE_MAX, MOMENT_NOTICE_MAX_DAYS, untilLabel, untilToInput, type MomentNotice } from "@/lib/moment-notice";

/**
 * Aviso do momento de um chatbot (Lançamento, parte 3), no painel (aba Base de conhecimento) e no
 * portal (Ensinar o assistente): o texto, até quando vale e quem escreveu.
 */
export function MomentNoticeCard({ notice, lastUntil, author, defaultUntil, save, clear }: {
  /** O aviso que vale agora. */
  notice: MomentNotice | null;
  /** O prazo do último aviso, se ele já venceu. */
  lastUntil?: string | null;
  author?: string | null;
  /** Valor inicial do prazo (amanhã, no horário de Brasília). */
  defaultUntil: string;
  save: (formData: FormData) => Promise<ActionResult>;
  clear: (formData: FormData) => Promise<ActionResult>;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-line bg-panel px-[18px] py-4">
      <div>
        <h3 className="text-sm font-semibold">Aviso do momento</h3>
        <p className="text-xs text-muted">
          Um recado com prazo: instabilidade, manutenção, atraso, mudança de horário. O assistente usa quando alguém pergunta ou o assunto tem a ver, e o aviso some sozinho no fim do prazo (até {MOMENT_NOTICE_MAX_DAYS} dias).
        </p>
      </div>
      {notice ? (
        <p className="rounded-lg bg-brand-soft px-3 py-2 text-sm text-brand">
          No ar até {untilLabel(notice.until)}
          {author ? `, escrito ${author}` : ""}.
        </p>
      ) : (
        lastUntil && <p className="text-xs text-muted">O último aviso venceu em {untilLabel(lastUntil)}.</p>
      )}
      <ActionForm action={save} className="flex flex-col gap-3">
        <MomentNoticeFields notice={notice} defaultUntil={defaultUntil}>
          <SubmitButton pendingLabel="Salvando…" className="btn-primary">
            {notice ? "Salvar aviso" : "Pôr o aviso no ar"}
          </SubmitButton>
        </MomentNoticeFields>
      </ActionForm>
      {notice && (
        <ActionForm action={clear}>
          <SubmitButton pendingLabel="Tirando…" className="text-xs font-semibold text-muted hover:text-ink hover:underline">
            Tirar o aviso agora
          </SubmitButton>
        </ActionForm>
      )}
    </section>
  );
}

/** O texto e o prazo do aviso (no cartão do portal e no modal do painel); `children` vai ao lado do prazo. */
export function MomentNoticeFields({ notice, defaultUntil, children }: { notice: MomentNotice | null; defaultUntil: string; children?: React.ReactNode }) {
  return (
    <>
      <label className="flex flex-col gap-1 text-sm">
        <span className="label">O aviso</span>
        <textarea name="moment_notice" required minLength={5} maxLength={MOMENT_NOTICE_MAX} rows={3} defaultValue={notice?.text ?? ""} className="input" placeholder="Ex.: a internet está instável no bairro Centro desde as 14h; a previsão de volta é às 18h." />
      </label>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="label">Vale até (horário de Brasília)</span>
          <input type="datetime-local" name="moment_notice_until" required defaultValue={notice ? untilToInput(notice.until) : defaultUntil} className="input" />
        </label>
        {children}
      </div>
    </>
  );
}
