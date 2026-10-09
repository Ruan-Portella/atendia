import { createClient } from "@/lib/supabase/server";
import { CLIENT_TIMEZONES, DEFAULT_TIMEZONE, formatInZone } from "@/lib/timezone";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { declareUtilityConsent, revokeUtilityConsent, saveClientTimezone } from "@/app/painel/campanhas/actions";

const ORIGIN_LABEL: Record<string, string> = { cadastro: "No cadastro", contrato: "No contrato", compra: "Na compra", outro: "Outro lugar" };

/**
 * Cliente → Dados (leva B3, parte 5): o fuso usado na agenda dos lembretes e das campanhas, e a
 * declaração de consentimento para lembretes, feita uma vez pelo cliente (o negócio).
 */
export async function ClientReminderSettings({ clientId, clientName }: { clientId: string; clientName: string }) {
  const { data: c } = await (await createClient()).from("clients").select("timezone, utility_consent_origin, utility_consent_text, utility_consent_by, utility_consent_at").eq("id", clientId).maybeSingle();
  const tz = (c?.timezone as string | null) ?? DEFAULT_TIMEZONE;
  return (
    <>
      <ActionForm key={tz} action={saveClientTimezone.bind(null, clientId)} className="card flex flex-col gap-3 p-6">
        <div>
          <h3 className="font-semibold">Fuso horário</h3>
          <p className="text-sm text-muted">Usado na data e hora dos lembretes, no agendamento das campanhas e no aviso de envio entre 20h e 8h.</p>
        </div>
        <select name="timezone" defaultValue={tz} className="input" aria-label="Fuso horário">
          {CLIENT_TIMEZONES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <SubmitButton className="btn-ghost self-start">Salvar fuso</SubmitButton>
      </ActionForm>

      <section className="card flex flex-col gap-3 p-6">
        <div>
          <h3 className="font-semibold">Consentimento para lembretes</h3>
          <p className="text-sm text-muted">
            O WhatsApp exige que a pessoa tenha aceitado receber mensagens da empresa. Sem esta declaração, os lembretes (consulta, vencimento, revisão) só vão para quem já mandou mensagem ao
            chatbot. Com ela, vão para todos da planilha, menos quem pediu para sair.
          </p>
        </div>
        {c?.utility_consent_at ? (
          <>
            <div className="flex flex-col gap-1 rounded-lg bg-ground p-3 text-sm">
              <span className="font-semibold">Declaração ativa · {ORIGIN_LABEL[c.utility_consent_origin as string] ?? (c.utility_consent_origin as string)}</span>
              <span className="whitespace-pre-line text-ink-2">{c.utility_consent_text as string}</span>
              <span className="text-xs text-muted">
                Feita por {(c.utility_consent_by as string | null) ?? "?"} em {formatInZone(c.utility_consent_at as string, tz)}.
              </span>
            </div>
            <ConfirmAction
              action={revokeUtilityConsent.bind(null, clientId)}
              title="Revogar a declaração?"
              description="Lembretes novos passam a ir só para quem já falou com o chatbot. Os já agendados continuam."
              confirmLabel="Revogar"
              className="self-start text-xs font-semibold text-danger hover:underline"
            >
              Revogar a declaração
            </ConfirmAction>
          </>
        ) : (
          <ActionForm action={declareUtilityConsent.bind(null, clientId)} className="flex flex-col gap-3">
            <div>
              <label className="label" htmlFor="consent-origin">Onde os contatos aceitaram</label>
              <select id="consent-origin" name="origin" required defaultValue="" className="input">
                <option value="" disabled>
                  Escolha…
                </option>
                {Object.entries(ORIGIN_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="consent-text">Como foi o aceite (o texto do contrato ou do cadastro)</label>
              <textarea id="consent-text" name="text" required minLength={20} maxLength={1000} rows={3} className="input" placeholder="Ex.: no cadastro da clínica, a pessoa marca “Aceito receber lembretes de consulta pelo WhatsApp”." />
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="confirm" className="mt-1" />
              <span>Declaro, em nome de {clientName}, que os contatos dos lembretes aceitaram receber avisos dela pelo WhatsApp, e que ela consegue provar isso.</span>
            </label>
            <SubmitButton className="btn-ghost self-start">Registrar a declaração</SubmitButton>
          </ActionForm>
        )}
      </section>
    </>
  );
}
