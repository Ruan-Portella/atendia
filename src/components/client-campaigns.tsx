import Link from "next/link";
import { CampaignBoard, type BoardBot } from "@/components/campaign-board";
import { ClientReminderSettings } from "@/components/client-reminder-settings";

/**
 * Cliente → Campanhas (leva B3): as campanhas e os lembretes dos chatbots deste cliente, o limite
 * de envio do número dele, o fuso e a declaração de consentimento para lembretes.
 */
export function ClientCampaigns({ clientId, clientName, bots, inPlan, isOwner }: { clientId: string; clientName: string; bots: BoardBot[]; inPlan: boolean; isOwner: boolean }) {
  return (
    <div className="flex max-w-[1080px] flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-[640px] text-sm text-muted">Promoções para quem aceitou receber novidades e lembretes de utilidade por planilha, pelo WhatsApp de {clientName}.</p>
        {inPlan && (
          <div className="flex flex-wrap gap-2">
            <Link href={`/painel/campanhas/nova?cliente=${clientId}&tipo=lembrete`} className="btn-ghost">
              Novo lembrete
            </Link>
            <Link href={`/painel/campanhas/nova?cliente=${clientId}`} className="btn-primary">
              Nova campanha
            </Link>
          </div>
        )}
      </div>
      {!inPlan && (
        <div className="card flex flex-col gap-2 p-5 text-sm">
          <p className="font-semibold">Campanhas fazem parte dos planos pagos (Freelancer, Agência e Escala).</p>
          <p className="text-ink-2">No teste grátis, dá para preparar tudo: a oferta de novidades no WhatsApp do chatbot, os contatos com o aceite e os modelos de marketing.</p>
          {isOwner && (
            <Link href="/painel/cobranca" className="btn-ghost self-start">
              Ver planos
            </Link>
          )}
        </div>
      )}
      <CampaignBoard bots={bots} showClient={false} limits={inPlan} />
      <div className="grid gap-5 lg:grid-cols-2">
        <ClientReminderSettings clientId={clientId} clientName={clientName} />
      </div>
    </div>
  );
}
