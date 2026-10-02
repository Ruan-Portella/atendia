import { requireAgency } from "@/lib/agency";
import { num } from "@/lib/plans";
import { daysUntil, initials } from "@/lib/utils";
import { PanelShell } from "@/components/panel-shell";
import { PlanAlert } from "@/components/plan-alert";
import { HandoffWatcher } from "@/components/handoff-watcher";
import { AlertTriangle } from "lucide-react";
import { panelNotices } from "@/lib/ai-pause";
import { createAdminClient } from "@/lib/supabase/admin";

const SUSPENDED_LABEL: Record<string, string> = { all: "todos os canais", whatsapp: "WhatsApp", instagram: "Instagram", widget: "chat do site" };

export default async function PainelLayout({ children }: LayoutProps<"/painel">) {
  const { agency, plan, usage } = await requireAgency();
  const trialDays = plan.id === "trial" ? daysUntil(agency.trial_ends_at) : null;
  // pausa, desligamento e suspensão pelo backoffice, ordem da Meta: a agência precisa saber por que parou
  const notices = await panelNotices(createAdminClient(), agency.id);
  const channelNames = notices.suspended.map((c) => SUSPENDED_LABEL[c] ?? c).join(", ");
  const banners = [
    notices.aiPaused && "A IA da sua conta está pausada pela equipe BoaVoz. As mensagens continuam chegando em Conversas para a sua equipe responder; no site, os visitantes veem o formulário de contato. Dúvidas: fale com o suporte.",
    notices.whatsappDisabled && "O WhatsApp está desligado temporariamente para todos os clientes do BoaVoz. Nada entra nem sai pelo WhatsApp até ser religado; Instagram e site seguem normais.",
    notices.suspended.length > 0 && `Canal suspenso pela equipe BoaVoz (${channelNames}). Nada sai por ele, nem a resposta da sua equipe; quem escrever recebe uma vez o aviso de canal indisponível. Fale com o suporte.`,
    notices.metaOrder && "A Meta desativou um número de WhatsApp da sua conta. Nada entra nem sai por esse número até a Meta reativar; confira o Gerenciador do WhatsApp.",
  ].filter((b): b is string => Boolean(b));

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
      {banners.map((text) => (
        <div key={text} className="flex items-center gap-3 rounded-xl border border-[#f0c9c9] bg-danger-soft px-4 py-3 text-sm text-danger">
          <AlertTriangle size={17} className="shrink-0" />
          <span>{text}</span>
        </div>
      ))}
      <PlanAlert planId={plan.id} trialDays={trialDays} usage={usage} limit={plan.conversations} />
      {children}
    </PanelShell>
  );
}
