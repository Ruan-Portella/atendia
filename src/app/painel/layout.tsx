import { requireAgency } from "@/lib/agency";
import { num } from "@/lib/plans";
import { daysUntil, initials } from "@/lib/utils";
import { PanelShell } from "@/components/panel-shell";

export default async function PainelLayout({ children }: LayoutProps<"/painel">) {
  const { agency, plan, usage } = await requireAgency();
  const trialDays = plan.id === "trial" ? daysUntil(agency.trial_ends_at) : null;

  return (
    <PanelShell
      agency={{ name: agency.name, logo_url: agency.logo_url, brand_color: agency.brand_color, initials: initials(agency.name) }}
      planName={plan.name}
      trialDays={trialDays}
      usage={usage}
      limit={plan.conversations}
      usageLabel={`${num(usage)} / ${num(plan.conversations)}`}
    >
      {children}
    </PanelShell>
  );
}
