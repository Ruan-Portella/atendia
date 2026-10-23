import { Clock, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { CLIENT_TIMEZONES, DEFAULT_TIMEZONE, formatInZone } from "@/lib/timezone";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { SettingGroup, SettingRow } from "@/components/ui/setting-row";
import { declareUtilityConsent, revokeUtilityConsent, saveClientTimezone } from "@/app/painel/campanhas/actions";

const ORIGIN_LABEL: Record<string, string> = { cadastro: "No cadastro", contrato: "No contrato", compra: "Na compra", outro: "Outro lugar" };

/**
 * Cliente → Campanhas (leva B3, parte 5): o fuso usado na agenda dos lembretes e das campanhas, e a
 * declaração de consentimento para lembretes, feita uma vez pelo cliente (o negócio). Redesenho
 * (23/10/2026, a pedido do usuário): duas linhas com o resumo, cada uma abrindo um modal.
 */
export async function ClientReminderSettings({ clientId, clientName }: { clientId: string; clientName: string }) {
  const { data: c } = await (await createClient()).from("clients").select("timezone, utility_consent_origin, utility_consent_text, utility_consent_by, utility_consent_at").eq("id", clientId).maybeSingle();
  const tz = (c?.timezone as string | null) ?? DEFAULT_TIMEZONE;
  const tzLabel = CLIENT_TIMEZONES.find((t) => t.id === tz)?.label ?? tz;
  const declared = Boolean(c?.utility_consent_at);
  return (
    <SettingGroup title="Ajustes dos envios">
      <SettingRow icon={<Clock size={18} />} title="Fuso horário" summary={tzLabel} description="Usado na data e hora dos lembretes, no agendamento das campanhas e no aviso de envio entre 20h e 8h." action={saveClientTimezone.bind(null, clientId)}>
        <div>
          <label htmlFor="client-tz" className="label">
            Fuso do cliente
          </label>
          <select id="client-tz" name="timezone" defaultValue={tz} className="input">
            {CLIENT_TIMEZONES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </SettingRow>

      {declared ? (
        <SettingRow
          icon={<ShieldCheck size={18} />}
          title="Consentimento para lembretes"
          summary={`Declaração ativa · ${ORIGIN_LABEL[c!.utility_consent_origin as string] ?? (c!.utility_consent_origin as string)}`}
          summaryTone="ok"
          description="Com a declaração, os lembretes vão para todos da planilha, menos quem pediu para sair."
          footer="close"
          footerStart={
            <ConfirmAction
              action={revokeUtilityConsent.bind(null, clientId)}
              title="Revogar a declaração?"
              description="Lembretes novos passam a ir só para quem já falou com o chatbot. Os já agendados continuam."
              confirmLabel="Revogar"
              className="text-sm font-semibold text-danger hover:underline"
            >
              Revogar a declaração
            </ConfirmAction>
          }
        >
          <div className="flex flex-col gap-1.5 rounded-[12px] bg-raised p-3 text-sm">
            <span className="font-medium text-ink">{ORIGIN_LABEL[c!.utility_consent_origin as string] ?? (c!.utility_consent_origin as string)}</span>
            <span className="whitespace-pre-line text-ink-2">{c!.utility_consent_text as string}</span>
            <span className="text-xs text-muted">
              Feita por {(c!.utility_consent_by as string | null) ?? "?"} em {formatInZone(c!.utility_consent_at as string, tz)}.
            </span>
          </div>
        </SettingRow>
      ) : (
        <SettingRow
          icon={<ShieldCheck size={18} />}
          title="Consentimento para lembretes"
          summary="Sem declaração: os lembretes só vão para quem já mandou mensagem ao chatbot"
          summaryTone="warn"
          description="O WhatsApp exige que a pessoa tenha aceitado receber mensagens da empresa. Com esta declaração, feita uma vez, os lembretes (consulta, vencimento, revisão) vão para todos da planilha, menos quem pediu para sair."
          action={declareUtilityConsent.bind(null, clientId)}
          saveLabel="Registrar a declaração"
        >
          <fieldset className="flex flex-col gap-2">
            <legend className="label">Onde os contatos aceitaram</legend>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(ORIGIN_LABEL).map(([value, label]) => (
                <label key={value} className="flex cursor-pointer items-center gap-2 rounded-[12px] border border-line px-3 py-2.5 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft/60 has-[:checked]:font-medium">
                  <input type="radio" name="origin" value={value} required className="accent-brand" />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label className="label" htmlFor="consent-text">
              Como foi o aceite (o texto do contrato ou do cadastro)
            </label>
            <textarea id="consent-text" name="text" required minLength={20} maxLength={1000} rows={3} className="input" placeholder="Ex.: no cadastro da clínica, a pessoa marca “Aceito receber lembretes de consulta pelo WhatsApp”." />
          </div>
          <label className="flex items-start gap-2.5 rounded-[12px] bg-raised p-3 text-sm">
            <input type="checkbox" name="confirm" required className="mt-0.5 accent-brand" />
            <span>Declaro, em nome de {clientName}, que os contatos dos lembretes aceitaram receber avisos dela pelo WhatsApp, e que ela consegue provar isso.</span>
          </label>
        </SettingRow>
      )}
    </SettingGroup>
  );
}
