import Link from "next/link";
import { CampaignBoard, type BoardBot } from "@/components/campaign-board";
import { ClientReminderSettings } from "@/components/client-reminder-settings";

/**
 * Cliente → Campanhas (leva B3): as campanhas e os lembretes dos chatbots deste cliente, o limite
 * de envio do número dele, o fuso e a declaração de consentimento para lembretes.
 */
export function ClientCampaigns({ clientId, clientName, bots }: { clientId: string; clientName: string; bots: BoardBot[] }) {
  return (
    <div className="flex max-w-[1080px] flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-[640px] text-sm text-muted">Promoções para quem aceitou receber novidades e lembretes de utilidade por planilha, pelo WhatsApp de {clientName}.</p>
        <div className="flex flex-wrap gap-2">
          <Link href={`/painel/campanhas/nova?cliente=${clientId}&tipo=lembrete`} className="btn-ghost">
            Novo lembrete
          </Link>
          <Link href={`/painel/campanhas/nova?cliente=${clientId}`} className="btn-primary">
            Nova campanha
          </Link>
        </div>
      </div>
      <CampaignBoard bots={bots} showClient={false} limits />
      <div className="grid gap-5 lg:grid-cols-2">
        <ClientReminderSettings clientId={clientId} clientName={clientName} />
      </div>
    </div>
  );
}
