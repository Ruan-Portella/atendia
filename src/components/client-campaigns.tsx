import Link from "next/link";
import { BellRing, Plus, Repeat } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CampaignBoard, type BoardBot } from "@/components/campaign-board";
import { ClientReminderSettings } from "@/components/client-reminder-settings";
import { NewCampaignFlow } from "@/components/new-campaign";
import { DialogButton } from "@/components/ui/setting-row";
import { campaignBotOptions } from "@/app/painel/campanhas/bot-options";

const SHEET_DESCRIPTION = "Antes de enviar, você vê quantos recebem, quem fica de fora e por quê, e o custo estimado na Meta, que cobra direto da conta do cliente. O BoaVoz confere cada envio de novo (SAIR, aceite e 18+).";

/**
 * Cliente → Campanhas (leva B3): as campanhas e os lembretes dos chatbots deste cliente, o limite
 * de envio do número dele, o fuso e a declaração de consentimento para lembretes. Redesenho
 * (23/10/2026, a pedido do usuário): Nova campanha e Novo lembrete abrem o painel lateral da tela
 * Campanhas (só com os chatbots deste cliente), e os ajustes viram linhas com modal. O fuso e o
 * consentimento vêm antes da lista (rodada 2 das telas, 23/10).
 */
export async function ClientCampaigns({ clientId, clientName, bots }: { clientId: string; clientName: string; bots: BoardBot[] }) {
  const options = await campaignBotOptions(await createClient(), createAdminClient(), clientId);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-[560px] text-sm text-muted">Promoções para quem aceitou receber novidades e lembretes de utilidade, pelo WhatsApp de {clientName}.</p>
        <div className="flex flex-wrap gap-2">
          <Link href={`/painel/campanhas/reguas?cliente=${clientId}`} className="btn-ghost">
            <Repeat size={15} />
            Réguas
          </Link>
          <DialogButton label="Novo lembrete" icon={<BellRing size={15} />} className="btn-ghost" title="Novo lembrete" description={SHEET_DESCRIPTION} size="sheet" footer="close">
            <NewCampaignFlow bots={options} initialKind="lembrete" />
          </DialogButton>
          <DialogButton label="Nova campanha" icon={<Plus size={15} />} className="btn-primary" title="Nova campanha" description={SHEET_DESCRIPTION} size="sheet" footer="close">
            <NewCampaignFlow bots={options} />
          </DialogButton>
        </div>
      </div>
      <ClientReminderSettings clientId={clientId} clientName={clientName} />
      <CampaignBoard bots={bots} showClient={false} limits />
    </div>
  );
}
