import { requireAgency } from "@/lib/agency";
import { can } from "@/lib/team";
import { num } from "@/lib/plans";
import { initials } from "@/lib/utils";
import { PanelShell } from "@/components/panel-shell";
import { PlanAlert } from "@/components/plan-alert";
import { HandoffWatcher } from "@/components/handoff-watcher";
import { NoticeStrip } from "@/components/notice-strip";
import { panelNotices } from "@/lib/ai-pause";
import { createAdminClient } from "@/lib/supabase/admin";
import { pendingAlerts } from "@/lib/security-alerts";
import { SecurityAlertStrip } from "@/components/security-alert-strip";
import { TeamWhatsAppCard } from "@/components/team-whatsapp-card";
import { noticeStatus } from "@/lib/team-whatsapp";

const SUSPENDED_LABEL: Record<string, string> = { all: "todos os canais", whatsapp: "WhatsApp", instagram: "Instagram", widget: "chat do site" };

export default async function PainelLayout({ children }: LayoutProps<"/painel">) {
  const { agency, usage, quota, bots, role, member } = await requireAgency();
  const accountLabel = agency.billing_status === "past_due" ? "Pagamento atrasado" : agency.billing_status === "active" ? "Assinatura" : "Conta grátis";
  // pausa, desligamento e suspensão pelo backoffice, ordem da Meta: a agência precisa saber por que parou
  const notices = await panelNotices(createAdminClient(), agency.id);
  // eventos graves da auditoria ainda não vistos (chave nova, URL trocada, acesso do suporte…),
  // para quem cuida da Segurança (dono e administrador)
  const alerts = can(role, "security") ? await pendingAlerts(createAdminClient(), agency.id, agency.security_alerts_seen_at ?? null).catch(() => []) : [];
  // avisos e ajuda no WhatsApp: o cartão do número fica no topo até a pessoa confirmar ou fechar
  const whatsappNotice = await noticeStatus(createAdminClient(), member.id).catch(() => null);
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
      accountLabel={accountLabel}
      usage={usage}
      limit={quota}
      usageLabel={`${num(usage)} / ${num(quota)}`}
      notices={
        <>
          {alerts.length > 0 && <SecurityAlertStrip alerts={alerts} />}
          {banners.map((text) => <NoticeStrip key={text}>{text}</NoticeStrip>)}
          {whatsappNotice && <TeamWhatsAppCard status={whatsappNotice} variant="top" />}
          {can(role, "config") && <PlanAlert bots={bots} billing={{ status: agency.billing_status, cancelAt: agency.billing_cancel_at }} />}
        </>
      }
    >
      <HandoffWatcher endpoint="/api/painel/pending" />
      {children}
    </PanelShell>
  );
}
