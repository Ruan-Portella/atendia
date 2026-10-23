import { Ban, Bot, Unlock } from "lucide-react";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { AutoSwitch, DialogButton, SettingGroup, SettingRow } from "@/components/ui/setting-row";
import { StatusPill } from "@/components/ui/form-section";
import { liftMeasure, pauseAgencyAi, resumeAgencyAi, setAgencyFeatures, suspendChannel } from "@/app/admin/(protegido)/acoes";
import { FEATURES, type Feature } from "@/lib/features";
import type { AgencyRow, MeasureRow } from "@/lib/backoffice";
import { relativeTime } from "@/lib/utils";

const WHAT_HAPPENS = "No WhatsApp e no Instagram, as mensagens ficam guardadas, viram pedido de atendente e o contato recebe uma vez o aviso fixo. No site, o widget mostra o formulário de contato.";
const CHANNEL_LABEL: Record<string, string> = { all: "todos os canais", whatsapp: "WhatsApp", instagram: "Instagram", widget: "site" };
const SOURCE_LABEL: Record<MeasureRow["source"], string> = { boavoz: "BoaVoz", meta_order: "Ordem da Meta", meta_violation: "Infração na Meta", meta_restriction: "Restrição da Meta" };

/**
 * As ações numa agência do backoffice (rodada 2 das telas, 23/10/2026, a pedido do usuário: "mais
 * modais e menos scroll"): pausar ou religar a IA, a liberação do WhatsApp e do Instagram em chaves
 * que salvam na hora e a suspensão de canal num modal, com as medidas ativas em linhas.
 */
export function AgencyControls({ agency, bots, measures }: { agency: AgencyRow; bots: Array<{ id: string; label: string }>; measures: MeasureRow[] }) {
  const features = Object.keys(FEATURES) as Feature[];
  // as chaves salvam juntas (o setAgencyFeatures lê todas): cada uma leva as outras ligadas
  const others = (skip: Feature): Record<string, string> => Object.fromEntries(features.filter((f) => f !== skip && agency.features.includes(f)).map((f) => [f, "on"]));
  return (
    <div className="flex flex-col gap-5">
      <SettingGroup title="IA e liberação">
        {agency.aiPausedAt ? (
          <SettingRow
            icon={<Bot size={18} />}
            title="IA desta agência"
            badge={<StatusPill tone="danger">pausada</StatusPill>}
            summary={`Desde ${relativeTime(agency.aiPausedAt)}${agency.aiPausedReason ? ` · ${agency.aiPausedReason}` : ""}`}
            summaryTone="warn"
            trailing={
              <ConfirmAction action={resumeAgencyAi.bind(null, agency.id)} title="Religar a IA desta agência?" description="Os bots dela voltam a responder com IA a partir da próxima mensagem." confirmLabel="Religar" danger={false} className="btn-primary">
                Religar
              </ConfirmAction>
            }
          />
        ) : (
          <SettingRow
            icon={<Bot size={18} />}
            title="IA desta agência"
            badge={<StatusPill tone="ok">ligada</StatusPill>}
            summary="Pausar a IA de todos os chatbots desta agência"
            dialogTitle="Pausar a IA desta agência"
            description={`${WHAT_HAPPENS} A agência vê um aviso no painel.`}
            action={pauseAgencyAi.bind(null, agency.id)}
            saveLabel="Pausar a IA"
          >
            <div>
              <label htmlFor="agencia-pausa-motivo" className="label">
                Motivo (fica registrado)
              </label>
              <input id="agencia-pausa-motivo" name="reason" required minLength={3} maxLength={200} className="input" />
            </div>
          </SettingRow>
        )}
        {features.map((f) => (
          <SettingRow
            key={f}
            icon={<Unlock size={18} />}
            title={`${FEATURES[f].label} liberado`}
            summary={FEATURES[f].description}
            trailing={<AutoSwitch checked={agency.features.includes(f)} action={setAgencyFeatures.bind(null, agency.id)} name={f} fields={others(f)} label={`${FEATURES[f].label} liberado`} confirmOff={{ title: `Tirar a liberação do ${FEATURES[f].label}?`, description: "Tirar não desconecta o que já está ligado; só impede conectar de novo." }} />}
          />
        ))}
      </SettingGroup>

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <h3 className="kpi-label">Suspensão de canal</h3>
          <DialogButton
            label="Suspender"
            icon={<Ban size={14} />}
            className="btn-ghost py-1.5 text-[13px] text-danger"
            title="Suspender um canal"
            description="Nada sai pelo canal, nem a resposta da equipe pelo painel. As mensagens que chegam ficam gravadas e o contato recebe uma vez o aviso de canal indisponível (nunca na coexistência). No site, o widget some."
            action={suspendChannel.bind(null, agency.id)}
            saveLabel="Suspender"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="suspender-canal" className="label">
                  Canal
                </label>
                <select id="suspender-canal" name="channel" defaultValue="all" className="input">
                  {Object.entries(CHANNEL_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="suspender-bot" className="label">
                  Chatbot
                </label>
                <select id="suspender-bot" name="bot_id" defaultValue="" className="input">
                  <option value="">todos os chatbots</option>
                  {bots.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="suspender-motivo" className="label">
                Motivo (fica registrado)
              </label>
              <input id="suspender-motivo" name="reason" required minLength={3} maxLength={200} className="input" />
            </div>
          </DialogButton>
        </div>
        <div className="card flex flex-col divide-y divide-line-2 overflow-hidden">
          {measures.length === 0 && <p className="px-4 py-5 text-sm text-muted">Nenhuma medida ativa nesta agência.</p>}
          {measures.map((m) => (
            <SettingRow
              key={m.id}
              icon={<Ban size={18} />}
              title={`${SOURCE_LABEL[m.source]} · ${CHANNEL_LABEL[m.channel] ?? m.channel}`}
              summary={[m.botLabel, m.wabaId ? `WABA ${m.wabaId}` : null, m.reason ?? "sem motivo", `${relativeTime(m.createdAt)}${m.createdBy ? ` por ${m.createdBy}` : ""}`].filter(Boolean).join(" · ")}
              summaryTone={m.feature === "channel" ? "warn" : "muted"}
              trailing={
                <ConfirmAction action={liftMeasure.bind(null, m.id)} title="Levantar esta medida?" description={m.source === "boavoz" ? "O canal volta a funcionar se nada mais o bloqueia." : "Só levante uma medida da Meta quando ela tiver sido resolvida no Gerenciador do WhatsApp."} confirmLabel="Levantar" danger={false} className="btn-ghost">
                  Levantar
                </ConfirmAction>
              }
            />
          ))}
        </div>
      </section>
    </div>
  );
}
