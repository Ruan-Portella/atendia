import Link from "next/link";
import { requirePermission } from "@/lib/agency";
import { createClient } from "@/lib/supabase/server";
import { campaignsInPlan } from "@/lib/plan-limits";
import { CampaignBoard } from "@/components/campaign-board";

export const metadata = { title: "Campanhas" };

/**
 * Campanhas, visão geral (leva B3): o que está saindo e agendado em todos os clientes do escopo,
 * com o limite de cada número. A casa de cada campanha é a aba Campanhas do cliente; daqui também
 * dá para criar, escolhendo o chatbot.
 */
export default async function CampaignsPage() {
  const { plan, role } = await requirePermission("config");
  const inPlan = campaignsInPlan(plan.id);
  // a RLS limita aos chatbots do escopo de quem está logado
  const { data: bots } = await (await createClient()).from("bots").select("id, name, client_name, client_id").eq("is_demo", false);

  return (
    <div className="flex max-w-[1080px] flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold sm:text-[28px]">Campanhas</h1>
          <p className="text-sm text-muted">
            Todas as campanhas e lembretes dos seus clientes, num lugar só. Cada cliente também tem a aba Campanhas, com os dele, o fuso e a declaração para lembretes.
          </p>
        </div>
        {inPlan && (
          <Link href="/painel/campanhas/nova" className="btn-primary">
            Nova campanha
          </Link>
        )}
      </div>

      {!inPlan && (
        <div className="card flex flex-col gap-2 p-5 text-sm">
          <p className="font-semibold">Campanhas fazem parte dos planos pagos (Freelancer, Agência e Escala).</p>
          <p className="text-ink-2">No teste grátis, dá para preparar tudo: ligar a oferta de novidades no WhatsApp do chatbot, importar contatos com o aceite e criar os modelos de marketing.</p>
          {role === "owner" && (
            <Link href="/painel/cobranca" className="btn-ghost self-start">
              Ver planos
            </Link>
          )}
        </div>
      )}

      <CampaignBoard bots={(bots ?? []).map((b) => ({ id: b.id as string, name: b.name as string, client_name: b.client_name as string, client_id: (b.client_id as string | null) ?? null }))} showClient limits={inPlan} />
    </div>
  );
}
