import { Bot, Globe, MessageCircle } from "lucide-react";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { SettingGroup, SettingRow } from "@/components/ui/setting-row";
import { StatusPill } from "@/components/ui/form-section";
import { closeChannel, disableWhatsAppAll, enableWhatsAppAll, openChannel, pauseAllAi, resumeAllAi } from "@/app/admin/(protegido)/acoes";
import { FEATURES, type Feature } from "@/lib/features";
import type { PlatformFlags } from "@/lib/backoffice";
import { relativeTime } from "@/lib/utils";

const WHAT_HAPPENS = "No WhatsApp e no Instagram, as mensagens ficam guardadas, viram pedido de atendente e o contato recebe uma vez o aviso fixo. No site, o widget mostra o formulário de contato.";
const OPENING: Record<Feature, string> = {
  whatsapp: "Toda agência passa a conectar números do WhatsApp sem liberação. O chatbot só atende com um tamanho assinado.",
  instagram: "Toda agência passa a conectar contas do Instagram sem liberação. O chatbot só atende com um tamanho assinado.",
};

/** O motivo e o "entendi" dos modais de emergência. */
function ReasonFields({ id, confirm }: { id: string; confirm: string }) {
  return (
    <>
      <div>
        <label htmlFor={`${id}-motivo`} className="label">
          Motivo (fica registrado)
        </label>
        <input id={`${id}-motivo`} name="reason" required minLength={3} maxLength={200} className="input" />
      </div>
      <label className="flex items-start gap-2.5 rounded-[12px] bg-raised p-3 text-sm">
        <input type="checkbox" name="confirm" required className="mt-0.5 accent-brand" />
        <span className="text-ink-2">{confirm}</span>
      </label>
    </>
  );
}

/**
 * As chaves da plataforma na Visão geral do backoffice (rodada 2 das telas, 23/10/2026, a pedido do
 * usuário: "menos scroll e mais modais"): a chave geral da IA, o desligamento do WhatsApp (plano B
 * da Meta) e a abertura dos canais, cada uma numa linha; ligar ou desligar abre o modal com o
 * motivo, e religar pede a confirmação.
 */
export function PlatformSwitches({ flags }: { flags: PlatformFlags }) {
  const by = flags.updatedBy ? ` (${flags.updatedBy})` : "";
  const openAt: Record<Feature, string | null> = { whatsapp: flags.whatsappOpenAt, instagram: flags.instagramOpenAt };
  return (
    <SettingGroup title="Chaves da plataforma">
      {flags.aiPausedAt ? (
        <SettingRow
          icon={<Bot size={18} />}
          title="IA de todas as agências"
          badge={<StatusPill tone="danger">pausada</StatusPill>}
          summary={`Desde ${relativeTime(flags.aiPausedAt)}${by}${flags.aiPausedReason ? ` · ${flags.aiPausedReason}` : ""}`}
          summaryTone="warn"
          trailing={
            <ConfirmAction action={resumeAllAi} title="Religar a IA de todos?" description="Os bots voltam a responder com IA a partir da próxima mensagem." confirmLabel="Religar" danger={false} className="btn-primary">
              Religar
            </ConfirmAction>
          }
        />
      ) : (
        <SettingRow
          icon={<Bot size={18} />}
          title="Chave geral da IA (emergência)"
          badge={<StatusPill tone="ok">ligada</StatusPill>}
          summary="Para a IA de todas as agências de uma vez"
          dialogTitle="Pausar a IA de todos"
          description={`Para a IA de todas as agências de uma vez (ex.: a IA começou a errar feio ou a OpenAI está fora). ${WHAT_HAPPENS}`}
          action={pauseAllAi}
          saveLabel="Pausar a IA de todos"
        >
          <ReasonFields id="ia-todos" confirm="Entendi: todos os bots param de responder com IA até alguém religar." />
        </SettingRow>
      )}
      {flags.whatsappDisabledAt ? (
        <SettingRow
          icon={<MessageCircle size={18} />}
          title="WhatsApp de todas as agências"
          badge={<StatusPill tone="danger">desligado</StatusPill>}
          summary={`Desde ${relativeTime(flags.whatsappDisabledAt)}${by}. Nada entra nem sai, nem a resposta da equipe${flags.whatsappDisabledReason ? ` · ${flags.whatsappDisabledReason}` : ""}`}
          summaryTone="warn"
          trailing={
            <ConfirmAction action={enableWhatsAppAll} title="Religar o WhatsApp de todos?" description="As mensagens que chegarem a partir de agora voltam a ser recebidas e respondidas. As que chegaram com ele desligado não foram gravadas." confirmLabel="Religar" danger={false} className="btn-primary">
              Religar
            </ConfirmAction>
          }
        />
      ) : (
        <SettingRow
          icon={<MessageCircle size={18} />}
          title="Desligar o WhatsApp de todos (plano B da Meta)"
          badge={<StatusPill tone="ok">ligado</StatusPill>}
          summary="Para quando a Meta mandar parar a plataforma inteira"
          dialogTitle="Desligar o WhatsApp de todos"
          description="Para quando a Meta mandar parar a plataforma inteira. Nada entra nem sai pela API do WhatsApp: as mensagens que chegarem não são gravadas, a IA não responde e a equipe não consegue enviar pelo painel. Instagram e site seguem normais."
          action={disableWhatsAppAll}
          saveLabel="Desligar o WhatsApp de todos"
        >
          <ReasonFields id="wa-todos" confirm="Entendi: nenhum WhatsApp recebe nem envia até alguém religar." />
        </SettingRow>
      )}
      {(Object.keys(FEATURES) as Feature[]).map((c) =>
        openAt[c] ? (
          <SettingRow
            key={c}
            icon={<Globe size={18} />}
            title={`Abertura do ${FEATURES[c].label}`}
            badge={<StatusPill tone="ok">aberto para todos</StatusPill>}
            summary={`Desde ${relativeTime(openAt[c]!)}`}
            trailing={
              <ConfirmAction action={closeChannel.bind(null, c)} title={`Fechar a abertura do ${FEATURES[c].label}?`} description="Só as agências liberadas uma a uma conseguem conectar. Nada do que já está conectado cai." confirmLabel="Fechar" className="btn-ghost">
                Fechar
              </ConfirmAction>
            }
          />
        ) : (
          <SettingRow
            key={c}
            icon={<Globe size={18} />}
            title={`Abertura do ${FEATURES[c].label}`}
            badge={<StatusPill>só liberados</StatusPill>}
            summary="Hoje só conectam as agências liberadas na página de cada uma"
            dialogTitle={`Abrir o ${FEATURES[c].label} para todos`}
            description={`${OPENING[c]} Hoje só conectam as agências liberadas na página de cada uma.`}
            action={openChannel.bind(null, c)}
            saveLabel={`Abrir o ${FEATURES[c].label}`}
          >
            <label className="flex items-start gap-2.5 rounded-[12px] bg-raised p-3 text-sm">
              <input type="checkbox" name="confirm" required className="mt-0.5 accent-brand" />
              <span className="text-ink-2">A Meta já aprovou o que este canal precisa.</span>
            </label>
          </SettingRow>
        ),
      )}
    </SettingGroup>
  );
}
