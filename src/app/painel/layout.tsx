import { isBusinessMode } from "@/lib/first-access";
import Link from "next/link";
import { redirect } from "next/navigation";
import { dateBR } from "@/lib/retention";
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
import { TeamWhatsAppStrip } from "@/components/team-whatsapp-strip";
import { NOTICE_CONSENT_SHORT, noticeStatus } from "@/lib/team-whatsapp";
import { company } from "@/lib/company";
import { AppTheme } from "@/components/app-theme";
import { createClient } from "@/lib/supabase/server";
import { memberName } from "@/lib/team";
import type { SidebarClient } from "@/components/sidebar-nav";
import { GoTo } from "@/components/go-to";
import { cookies } from "next/headers";
import { MENU_COOKIE } from "@/lib/theme";
import { OnboardingWidget } from "@/components/onboarding-widget";
import { getOnboarding, ONBOARDING_COOKIE, ONBOARDING_GOAL } from "@/lib/onboarding";
import { createBot, createClientRecord, hideOnboarding } from "@/app/painel/actions";
import { createDerivedAction } from "@/app/painel/modelos/actions";
import { CreateDialogs } from "@/components/create-dialogs";
import { getClientOptions } from "@/lib/panel";

// o manifest deixa adicionar o painel à tela de início (no iPhone, os avisos no celular só chegam
// assim; Memória e avisos, parte 2)
export const metadata = { manifest: "/manifest.webmanifest", appleWebApp: { capable: true, title: "BoaVoz" } };

const SUSPENDED_LABEL: Record<string, string> = { all: "todos os canais", whatsapp: "WhatsApp", instagram: "Instagram", widget: "chat do site" };

export default async function PainelLayout({ children }: LayoutProps<"/painel">) {
  const { agency, usage, quota, bots, role, member, packs } = await requireAgency();
  // primeiro acesso (Entrada e docs, parte 1): o dono diz como vai usar o BoaVoz antes do painel
  if (role === "owner" && !agency.profile) redirect("/comecar");
  const accountLabel = agency.billing_status === "past_due" ? "Pagamento atrasado" : agency.billing_status === "active" ? "Assinatura" : "Conta grátis";
  // pausa, desligamento e suspensão pelo backoffice, ordem da Meta: a agência precisa saber por que parou
  const notices = await panelNotices(createAdminClient(), agency.id);
  // eventos graves da auditoria ainda não vistos (chave nova, URL trocada, acesso do suporte…),
  // para quem cuida da Segurança (dono e administrador)
  const alerts = can(role, "security") ? await pendingAlerts(createAdminClient(), agency.id, agency.security_alerts_seen_at ?? null).catch(() => []) : [];
  // avisos e ajuda no WhatsApp: a faixa do convite fica no topo até a pessoa confirmar ou fechar
  const whatsappNotice = await noticeStatus(createAdminClient(), member.id).catch(() => null);
  const channelNames = notices.suspended.map((c) => SUSPENDED_LABEL[c] ?? c).join(", ");
  // os clientes no menu, como canais (a RLS deixa só os do escopo de quem entrou)
  const supabase = await createClient();
  const { data: clientRows, count: clientCount } = await supabase
    .from("clients")
    .select("id, name, bots(id, appearance, face, is_demo, created_at)", { count: "exact" })
    .eq("agency_id", agency.id)
    .eq("bots.is_demo", false)
    .order("name")
    .limit(50);
  const sidebarClients: SidebarClient[] = (clientRows ?? []).map((c) => {
    const bots = ((c.bots ?? []) as Array<{ id: string; appearance: { color?: string } | null; face: unknown; created_at: string }>).sort((a, b) => a.created_at.localeCompare(b.created_at));
    return { id: c.id as string, name: c.name as string, color: bots[0]?.appearance?.color ?? null, face: bots[0]?.face ?? null, botIds: bots.map((b) => b.id) };
  });
  // o perfil do negócio (23/10/2026): Chatbots no lugar de Clientes, sem demos; vale com até um cliente
  const business = isBusinessMode(agency.profile, clientCount ?? sidebarClients.length) ? { clientId: sidebarClients[0]?.id ?? null } : null;
  // os modais de Novo cliente e Novo chatbot (redesenho, etapa 5): o "+" do menu, o Ctrl K e as telas abrem daqui
  const clientOptions = can(role, "config") ? await getClientOptions(supabase, agency.id) : [];
  // os modelos, para o Novo chatbot começar de um (Plataforma, para quem vê a conta inteira)
  const templatesOn = can(role, "config") && member.scope === "all" && packs.includes("plataforma");
  const { data: templateRows } = templatesOn ? await supabase.from("bots").select("id, name").eq("is_template", true).is("version_of", null).order("created_at") : { data: [] };
  // primeiros passos (redesenho, etapa 5): um widget no canto, em todo o painel, para quem configura
  const onboarding = can(role, "config") && (await cookies()).get(ONBOARDING_COOKIE)?.value !== "hidden" ? await getOnboarding(supabase, agency, { admin: createAdminClient(), packs }).catch(() => null) : null;
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
      packs={packs}
      wholeAccount={member.scope === "all"}
      accountLabel={accountLabel}
      usage={usage}
      limit={quota}
      usageLabel={`${num(usage)} / ${num(quota)}`}
      clients={sidebarClients}
      clientCount={clientCount ?? sidebarClients.length}
      business={business}
      me={{ name: memberName(member), email: member.email, avatarUrl: member.avatar_url ?? null }}
      goTo={<GoTo role={role} packs={packs} wholeAccount={member.scope === "all"} business={business} clients={sidebarClients.map(({ id, name, color, face }) => ({ id, name, color, face }))} />}
      menuCollapsed={(await cookies()).get(MENU_COOKIE)?.value === "fechado"}
      notices={
        <>
          {alerts.length > 0 && <SecurityAlertStrip alerts={alerts} />}
          {banners.map((text) => <NoticeStrip key={text}>{text}</NoticeStrip>)}
          {/* exclusão da conta pedida pelo dono: todos veem a data; o dono pode desistir */}
          {agency.deletion_scheduled_for && (
            <NoticeStrip
              action={
                role === "owner" ? (
                  <Link href="/painel/seguranca?aba=conta" className="font-semibold underline">
                    Desistir
                  </Link>
                ) : null
              }
            >
              A conta será excluída em {dateBR(agency.deletion_scheduled_for)}, com os chatbots, as conversas e os contatos. Até lá, tudo continua funcionando.
            </NoticeStrip>
          )}
          {whatsappNotice && <TeamWhatsAppStrip status={whatsappNotice} brand={company.brand} consent={NOTICE_CONSENT_SHORT} />}
          {can(role, "config") && <PlanAlert bots={bots} billing={{ status: agency.billing_status, cancelAt: agency.billing_cancel_at }} />}
        </>
      }
    >
      <AppTheme />
      <HandoffWatcher endpoint="/api/painel/pending" />
      {can(role, "config") && <CreateDialogs createClient={member.scope === "all" ? createClientRecord : null} createBot={createBot} createDerived={templatesOn ? createDerivedAction : undefined} templates={(templateRows ?? []).map((t) => ({ id: t.id as string, name: t.name as string }))} clients={clientOptions} suggestedName={agency.profile === "business" ? agency.name : ""} business={Boolean(business)} />}
      {onboarding && <OnboardingWidget steps={onboarding} goal={ONBOARDING_GOAL[agency.profile ?? "agency"]} changeProfile={role === "owner" ? (agency.profile ?? "agency") : null} clientCount={clientCount ?? sidebarClients.length} hide={hideOnboarding} />}
      {children}
    </PanelShell>
  );
}
