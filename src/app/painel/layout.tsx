import { requireAgency } from "@/lib/agency";
import { can } from "@/lib/team";
import { num } from "@/lib/plans";
import { daysUntil, initials } from "@/lib/utils";
import { PanelShell } from "@/components/panel-shell";
import { PlanAlert } from "@/components/plan-alert";
import { HandoffWatcher } from "@/components/handoff-watcher";
import { NoticeStrip } from "@/components/notice-strip";
import { panelNotices } from "@/lib/ai-pause";
import { createAdminClient } from "@/lib/supabase/admin";
import { pendingAlerts } from "@/lib/security-alerts";
import { SecurityAlertStrip } from "@/components/security-alert-strip";

const SUSPENDED_LABEL: Record<string, string> = { all: "todos os canais", whatsapp: "WhatsApp", instagram: "Instagram", widget: "chat do site" };

export default async function PainelLayout({ children }: LayoutProps<"/painel">) {
  const { agency, plan, usage, quota, role } = await requireAgency();
  const trialDays = plan.id === "trial" ? daysUntil(agency.trial_ends_at) : null;
  // pausa, desligamento e suspensão pelo backoffice, ordem da Meta: a agência precisa saber por que parou
  const notices = await panelNotices(createAdminClient(), agency.id);
  // eventos graves da auditoria ainda não vistos (chave nova, URL trocada, acesso do suporte…),
  // para quem cuida da Segurança (dono e administrador)
  const alerts = can(role, "security") ? await pendingAlerts(createAdminClient(), agency.id, agency.security_alerts_seen_at ?? null).catch(() => []) : [];
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
      role={role}
      planName={plan.name}
      trialDays={trialDays}
      usage={usage}
      limit={quota}
      usageLabel={`${num(usage)} / ${num(quota)}`}
      notices={
        <>
          {alerts.length > 0 && <SecurityAlertStrip alerts={alerts} />}
          {banners.map((text) => <NoticeStrip key={text}>{text}</NoticeStrip>)}
          {can(role, "config") && <PlanAlert planId={plan.id} trialDays={trialDays} usage={usage} limit={quota} />}
        </>
      }
    >
      <HandoffWatcher endpoint="/api/painel/pending" />
      {children}
    </PanelShell>
  );
}
