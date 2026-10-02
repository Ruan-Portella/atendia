import { requireAgency } from "@/lib/agency";
import { num } from "@/lib/plans";
import { daysUntil, initials } from "@/lib/utils";
import { PanelShell } from "@/components/panel-shell";
import { PlanAlert } from "@/components/plan-alert";
import { HandoffWatcher } from "@/components/handoff-watcher";
import { AlertTriangle } from "lucide-react";
import { isAiPaused } from "@/lib/ai-pause";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function PainelLayout({ children }: LayoutProps<"/painel">) {
  const { agency, plan, usage } = await requireAgency();
  const trialDays = plan.id === "trial" ? daysUntil(agency.trial_ends_at) : null;
  // pausa pelo backoffice (desta agência ou a chave geral): a agência precisa saber por que a IA parou
  const aiPaused = await isAiPaused(createAdminClient(), agency.id);

  return (
    <PanelShell
      agency={{ name: agency.name, logo_url: agency.logo_url, brand_color: agency.brand_color, initials: initials(agency.name) }}
      planName={plan.name}
      trialDays={trialDays}
      usage={usage}
      limit={plan.conversations}
      usageLabel={`${num(usage)} / ${num(plan.conversations)}`}
    >
      <HandoffWatcher endpoint="/api/painel/pending" />
      {aiPaused && (
        <div className="flex items-center gap-3 rounded-xl border border-[#f0c9c9] bg-danger-soft px-4 py-3 text-sm text-danger">
          <AlertTriangle size={17} className="shrink-0" />
          <span>A IA da sua conta está pausada pela equipe BoaVoz. As mensagens continuam chegando em Conversas para a sua equipe responder; no site, os visitantes veem o formulário de contato. Dúvidas: fale com o suporte.</span>
        </div>
      )}
      <PlanAlert planId={plan.id} trialDays={trialDays} usage={usage} limit={plan.conversations} />
      {children}
    </PanelShell>
  );
}
