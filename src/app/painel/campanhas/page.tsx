import { Plus } from "lucide-react";
import { requirePermission } from "@/lib/agency";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CampaignBoard } from "@/components/campaign-board";
import { CampaignsHeader } from "@/components/campaigns-header";
import { DialogButton } from "@/components/ui/setting-row";
import { NewCampaignFlow } from "@/components/new-campaign";
import { campaignBotOptions } from "./bot-options";

export const metadata = { title: "Campanhas e réguas" };
// o painel de Nova campanha monta o público na prévia (até 10.000 contatos ou 2.000 linhas) e consulta a Meta
export const maxDuration = 60;

/**
 * Campanhas e réguas → Campanhas (leva B3; redesenho, etapa 5): o que está saindo e agendado em
 * todos os clientes do escopo, com o limite de cada número, e a Nova campanha num painel lateral. A
 * casa de cada campanha é a aba Campanhas do cliente.
 */
export default async function CampaignsPage() {
  await requirePermission("config");
  const supabase = await createClient();
  // a RLS limita aos chatbots do escopo de quem está logado
  const [{ data: bots }, options] = await Promise.all([supabase.from("bots").select("id, name, client_name, client_id").eq("is_demo", false), campaignBotOptions(supabase, createAdminClient())]);

  return (
    <div className="flex flex-col gap-6">
      <CampaignsHeader
        active="campanhas"
        action={
          <DialogButton
            label="Nova campanha"
            icon={<Plus size={15} />}
            className="btn-primary"
            title="Nova campanha"
            description="Antes de enviar, você vê quantos recebem, quem fica de fora e por quê, e o custo estimado na Meta, que cobra direto da conta do cliente. O BoaVoz confere cada envio de novo (SAIR, aceite e 18+)."
            size="sheet"
            footer="close"
          >
            <NewCampaignFlow bots={options} />
          </DialogButton>
        }
      />
      <CampaignBoard bots={(bots ?? []).map((b) => ({ id: b.id as string, name: b.name as string, client_name: b.client_name as string, client_id: (b.client_id as string | null) ?? null }))} showClient limits />
    </div>
  );
}
