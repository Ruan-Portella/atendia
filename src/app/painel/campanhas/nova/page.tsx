import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/agency";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { campaignsInPlan } from "@/lib/plan-limits";
import { CampaignWizard } from "@/components/campaign-wizard";

export const metadata = { title: "Nova campanha" };
// a prévia monta o público (até 10.000 contatos) e consulta a Meta
export const maxDuration = 60;

/** Nova campanha (leva B3, parte 4a): os chatbots do escopo com o WhatsApp conectado. */
export default async function NewCampaignPage() {
  const { plan } = await requirePermission("config");
  if (!campaignsInPlan(plan.id)) notFound();
  const supabase = await createClient();
  const { data: bots } = await supabase.from("bots").select("id, name, client_name").eq("is_demo", false).order("name");
  const ids = (bots ?? []).map((b) => b.id as string);
  const { data: channels } = ids.length ? await createAdminClient().from("whatsapp_channels").select("bot_id").in("bot_id", ids).is("disconnected_at", null).not("waba_id", "is", null) : { data: [] };
  const connected = new Set((channels ?? []).map((c) => c.bot_id as string));
  const options = (bots ?? []).filter((b) => connected.has(b.id as string)).map((b) => ({ id: b.id as string, name: b.name as string, clientName: (b.client_name as string | null) ?? "" }));

  return (
    <div className="flex max-w-[860px] flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Link href="/painel/campanhas" className="text-sm font-semibold text-muted">
          ← Campanhas
        </Link>
        <h1 className="text-2xl font-bold sm:text-[28px]">Nova campanha</h1>
        <p className="text-sm text-muted">
          Só vai para quem aceitou receber novidades deste número e não pediu para sair. Antes de criar, você vê quantos recebem, quem fica de fora e o custo estimado na Meta, que cobra direto da conta do cliente.
        </p>
      </div>
      <CampaignWizard bots={options} />
    </div>
  );
}
