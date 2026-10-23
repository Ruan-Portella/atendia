import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Download, ExternalLink, Headset, Layers, LayoutDashboard, Plus, Settings2, Users } from "lucide-react";
import { requireAgency } from "@/lib/agency";
import { can } from "@/lib/team";
import { createClient } from "@/lib/supabase/server";
import { brl, num } from "@/lib/plans";
import { getBotStats, getPendingHandoffs, resolvedPct } from "@/lib/panel";
import { PendingHandoffs } from "@/components/pending-handoffs";
import { handoffStatus } from "@/lib/handoff-status";
import { HandoffBadge } from "@/components/handoff-badge";
import { ConversationStateBadge } from "@/components/conversation-state";
import { cn, daysAgoIso, initials, relativeTime } from "@/lib/utils";
import { agencyBaseUrl } from "@/lib/domain";
import { Status } from "@/components/status";
import { Kpi } from "@/components/kpi";
import { BotFace } from "@/components/bot-face";
import { CreateButton } from "@/components/create-dialogs";
import { BotRowActions } from "@/components/bot-row-actions";
import { LeadList, type LeadRow } from "@/components/lead-list";
import { listLeads } from "@/lib/leads";
import { ClientFields } from "@/components/client-fields";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { CopyButton } from "@/components/copy-button";
import { ClientCompliance } from "@/components/client-compliance";
import { ClientPrivacy } from "@/components/client-privacy";
import { ExportLinks } from "@/components/export-links";
import { currentPeriodBR, periodLabel, portalUrl, shiftPeriod } from "@/lib/report";
import { addClientMember, deleteBot, deleteClientRecord, disablePortal, enablePortal, eraseContactData, removeClientMember, resendClientInvite, saveReportEmail, sendReportNow, setClientMemberRole, setClientPermissions, updateClientRecord } from "../../actions";
import { ContactsList } from "@/components/contacts-list";
import { ClientCampaigns } from "@/components/client-campaigns";
import { ClientIntegrationsSummary } from "@/components/integrations/client-integrations-summary";
import { ClientSectors } from "@/components/client-sectors";
import { ClientQuickReplies } from "@/components/client-quick-replies";
import { listQuickReplies } from "@/lib/quick-replies";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientHolidays, eligibleSectorMembers, listSectors } from "@/lib/sectors";

export const metadata = { title: "Cliente" };

const TABS = [
  ["visao", "Resumo"],
  ["contatos", "Contatos"],
  ["leads", "Leads"],
  ["campanhas", "Campanhas"],
  ["conversas", "Conversas"],
  ["setores", "Setores"],
  ["respostas", "Respostas prontas"],
  ["dados", "Dados do cliente"],
  ["relatorio", "Relatório e portal"],
  ["acesso", "Acesso do cliente"],
  ["conformidade", "Conformidade"],
] as const;
type Tab = (typeof TABS)[number][0];

/**
 * As 4 seções do cliente (redesenho, etapa 4), no lugar das 11 abas: Visão geral, Pessoas,
 * Atendimento e Ajustes. Os endereços (?tab=) continuam valendo; "chatbots" virou a Visão geral.
 */
const SECTIONS: Array<{ key: string; label: string; icon: typeof Users; tabs: Tab[] }> = [
  { key: "visao", label: "Visão geral", icon: LayoutDashboard, tabs: ["visao"] },
  { key: "pessoas", label: "Pessoas", icon: Users, tabs: ["contatos", "leads", "campanhas"] },
  { key: "atendimento", label: "Atendimento", icon: Headset, tabs: ["conversas", "setores", "respostas"] },
  { key: "ajustes", label: "Ajustes", icon: Settings2, tabs: ["dados", "relatorio", "acesso", "conformidade"] },
];

const CHANNEL_LABEL: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram", widget: "Site", painel: "Teste" };

interface BotRow {
  id: string;
  name: string;
  /** o modelo de onde ele herda (pacote Plataforma) */
  template_id: string | null;
  client_name: string;
  client_site: string | null;
  status: string;
  public_key: string;
  appearance: { color?: string; avatar_text?: string } | null;
  face: unknown;
}

/** Um cartão de resumo da Visão geral, que leva à aba onde se ajusta. */
function SummaryCard({ title, href, children }: { title: string; href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="card group flex flex-col gap-2 p-4 transition-[transform,box-shadow] duration-[220ms] ease-[var(--ease-out)] hover:-translate-y-0.5">
      <span className="flex items-center justify-between gap-2">
        <span className="text-[15px] font-medium text-ink">{title}</span>
        <ArrowRight size={15} className="text-muted transition-transform duration-[120ms] group-hover:translate-x-0.5 group-hover:text-ink" />
      </span>
      <span className="text-[13px] leading-relaxed text-muted">{children}</span>
    </Link>
  );
}

export default async function ClientPanelPage({ params, searchParams }: PageProps<"/painel/clientes/[id]">) {
  const [{ id }, sp, { role }] = await Promise.all([params, searchParams, requireAgency()]);
  // equipe (leva B1'): o atendente vê os chatbots (para chegar às conversas) e as conversas
  const canConfig = can(role, "config");
  const tabs = TABS.filter(([t]) => canConfig || t === "visao" || t === "conversas");
  const asked = sp.tab === "chatbots" ? "visao" : sp.tab;
  const tab = (tabs.some(([t]) => t === asked) ? asked : "visao") as Tab;
  const label = new Map<string, string>(tabs.map(([t, l]) => [t, l]));
  const sections = SECTIONS.map((s) => ({ ...s, tabs: s.tabs.filter((t) => label.has(t)) })).filter((s) => s.tabs.length);
  const section = sections.find((s) => s.tabs.includes(tab)) ?? sections[0];
  const supabase = await createClient();
  // a RLS limita os dados à agência logada
  const [{ agency }, { data: client }, { data: botData }, stats] = await Promise.all([
    requireAgency(),
    supabase.from("clients").select("id, name, site, external_id, price_cents, created_at, portal_token, report_email, report_last_period, allow_handoff, allow_knowledge, allow_hours, handoff_notify, retention_months").eq("id", id).maybeSingle(),
    supabase.from("bots").select("id, name, client_name, client_site, status, public_key, appearance, face, template_id").eq("client_id", id).eq("is_demo", false).order("created_at"),
    getBotStats(supabase, daysAgoIso(30)),
  ]);
  if (!client) notFound();
  const bots = (botData ?? []) as BotRow[];
  // o nome do modelo de cada chatbot derivado, para a etiqueta "do modelo"
  const templateIds = [...new Set(bots.flatMap((b) => (b.template_id ? [b.template_id] : [])))];
  const { data: templateRows } = templateIds.length ? await supabase.from("bots").select("id, name").in("id", templateIds) : { data: [] };
  const templateName = new Map((templateRows ?? []).map((r) => [r.id as string, r.name as string]));
  const botIds = bots.map((b) => b.id);
  const botName = new Map(bots.map((b) => [b.id, b.name]));
  const total = bots.reduce((t, b) => {
    const s = stats.of(b.id);
    return { conversations: t.conversations + s.conversations, needsHuman: t.needsHuman + s.needsHuman, leads: t.leads + s.leads };
  }, { conversations: 0, needsHuman: 0, leads: 0 });
  const pct = resolvedPct(total);
  const base = agencyBaseUrl(agency);

  // Só busca o que a aba aberta mostra.
  const [pending, leads, { data: conversations }, { data: members }, { count: memberCount }] = await Promise.all([
    tab === "visao" || tab === "conversas" ? getPendingHandoffs(supabase, botIds) : Promise.resolve([]),
    tab === "leads" ? listLeads(supabase, { botIds, limit: 200 }) : Promise.resolve([] as LeadRow[]),
    tab === "conversas" && botIds.length
      ? supabase.from("conversations").select("id, bot_id, started_at, last_message_at, visitor_seen_at, message_count, needs_human, channel, handoff_requested_at, takeover_at, handled_at, handoff_urgent_at, last_contact_at, last_reply_at").in("bot_id", botIds).order("last_message_at", { ascending: false }).limit(50)
      : Promise.resolve({ data: [] as Array<{ id: string; bot_id: string; started_at: string; last_message_at: string; visitor_seen_at: string | null; message_count: number; needs_human: boolean; channel: string; handoff_requested_at: string | null; takeover_at: string | null; handled_at: string | null; handoff_urgent_at: string | null; last_contact_at: string | null; last_reply_at: string | null }> }),
    tab === "acesso" || (tab === "relatorio" && client.report_email)
      ? supabase.from("client_members").select("id, email, role, display_name, last_login_at, created_at, invited_by_key").eq("client_id", id).order("created_at")
      : Promise.resolve({ data: [] as Array<{ id: string; email: string; role: string; display_name: string | null; last_login_at: string | null; created_at: string; invited_by_key: string | null }> }),
    tab === "visao" && canConfig ? supabase.from("client_members").select("id", { count: "exact", head: true }).eq("client_id", id) : Promise.resolve({ count: null }),
  ]);
  const href = (t: Tab) => `/painel/clientes/${id}?tab=${t}`;
  const botFace = new Map(bots.map((b) => [b.id, b]));

  return (
    <>
      <div className="flex flex-col gap-4">
        <Link href="/painel/clientes" className="text-[13px] font-medium text-muted hover:text-ink">← Clientes</Link>
        <div className="flex flex-wrap items-center gap-4">
          {/* os rostos dos chatbots do cliente, um sobre o outro (sem chatbot, as iniciais) */}
          {bots.length ? (
            <span className="flex shrink-0 items-center">
              {bots.slice(0, 3).map((b, k) => (
                <BotFace key={b.id} color={b.appearance?.color} face={b.face} size={44} alive={k === 0} className={cn("outline-[3px] outline-ground", k > 0 && "-ml-3")} />
              ))}
            </span>
          ) : (
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-raised text-sm font-semibold text-ink">{initials(client.name)}</span>
          )}
          <div className="min-w-0 flex-1 leading-tight">
            <h1 className="truncate text-[26px] font-light sm:text-[30px]">{client.name}</h1>
            <p className="mt-1 truncate text-[13px] text-muted">
              {client.site ? <a href={/^https?:\/\//.test(client.site) ? client.site : `https://${client.site}`} target="_blank" rel="noopener" className="hover:text-ink">{client.site.replace(/^https?:\/\//, "")}</a> : "sem site"} · cliente desde {new Date(client.created_at).toLocaleDateString("pt-BR")}
              {client.external_id ? <> · no sistema da plataforma: <code className="font-mono text-[12px]">{client.external_id}</code></> : null}
            </p>
          </div>
          {canConfig && <CreateButton kind="chatbot" clientId={client.id} className="btn-primary w-full sm:w-auto"><Plus size={15} />Novo chatbot</CreateButton>}
        </div>

        {/* as 4 seções e, embaixo, as abas da seção aberta */}
        <nav aria-label="Seções do cliente" className="flex flex-col gap-2">
          <div className="flex gap-1 overflow-x-auto rounded-[14px] bg-panel p-1 shadow-[inset_0_0_0_1px_var(--color-line)] [scrollbar-width:none] sm:self-start">
            {sections.map((s) => {
              const on = s.key === section.key;
              const Icon = s.icon;
              return (
                <Link key={s.key} href={href(s.tabs[0])} aria-current={on ? "page" : undefined} className={cn("flex shrink-0 items-center gap-2 whitespace-nowrap rounded-[10px] px-3.5 py-2 text-sm transition-colors duration-[120ms]", on ? "bg-raised font-medium text-ink shadow-[inset_0_1px_0_var(--highlight)]" : "text-ink-2 hover:text-ink")}>
                  <Icon size={16} className={on ? "text-brand" : "text-muted"} />
                  {s.label}
                </Link>
              );
            })}
          </div>
          {section.tabs.length > 1 && (
            <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
              {section.tabs.map((t) => (
                <Link key={t} href={href(t)} aria-current={t === tab ? "page" : undefined} className={cn("shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] transition-colors duration-[120ms]", t === tab ? "bg-ink font-medium text-ground" : "bg-raised/70 text-ink-2 hover:bg-raised hover:text-ink")}>
                  {label.get(t)}
                </Link>
              ))}
            </div>
          )}
        </nav>
      </div>

      {tab === "visao" && (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Kpi label="Conversas" value={num(total.conversations)} sub={`30 dias · ${bots.length} chatbot${bots.length === 1 ? "" : "s"}`} />
            <Kpi label="Leads" value={num(total.leads)} sub="nome e contato entregues" />
            <Kpi label="Sem humano" value={`${pct}%`} sub={`${100 - pct}% pediram atendente`} />
            {canConfig && <Kpi label="Você cobra" value={client.price_cents ? brl(client.price_cents / 100) : "—"} sub={client.price_cents ? "por mês" : "defina em Ajustes"} />}
          </div>

          <PendingHandoffs items={pending} showClient={false} hrefFor={(h) => `/painel/caixa?fila=todas&c=${h.id}`} />

          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-medium">Chatbots</h2>
              {canConfig && bots.length > 0 && <CreateButton kind="chatbot" clientId={client.id} className="btn-ghost px-3 py-1.5 text-[13px]"><Plus size={14} />Novo</CreateButton>}
            </div>
            {bots.length === 0 ? (
              <div className="card flex flex-col items-start gap-3 p-6">
                <p className="text-sm text-muted">{canConfig ? "Este cliente ainda não tem chatbots." : "Nenhum chatbot deste cliente no seu escopo."}</p>
                {canConfig && <CreateButton kind="chatbot" clientId={client.id} className="btn-primary"><Plus size={15} />Criar o primeiro chatbot</CreateButton>}
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {bots.map((b, k) => {
                  const s = stats.of(b.id);
                  return (
                    <div key={b.id} className="card group relative flex flex-col gap-4 p-4 transition-[transform,box-shadow] duration-[220ms] ease-[var(--ease-out)] hover:-translate-y-0.5" style={{ animation: `rise-in var(--dur-base) var(--ease-out) ${k * 50}ms both` }}>
                      <div className="flex items-start gap-3">
                        <BotFace color={b.appearance?.color} face={b.face} size={44} />
                        <div className="min-w-0 flex-1 leading-tight">
                          {/* o cartão inteiro abre o chatbot; o menu fica por cima */}
                          <Link href={`/painel/bots/${b.id}`} className="block truncate font-medium text-ink after:absolute after:inset-0 after:rounded-[16px]">{b.name}</Link>
                          <span className="mt-0.5 block truncate text-[12.5px] text-muted">{b.client_site?.replace(/^https?:\/\//, "") ?? "sem site"}</span>
                          {b.template_id && (
                            <span title="Herda do modelo o que ele não libera para mudar; recebe o que for publicado nele" className="mt-1 inline-flex max-w-full items-center gap-1 rounded-full bg-raised px-2 py-px text-[11.5px] text-ink-2">
                              <Layers size={11} className="shrink-0" />
                              <span className="truncate">do modelo {templateName.get(b.template_id) ?? ""}</span>
                            </span>
                          )}
                        </div>
                        <div className="relative z-10">
                          <BotRowActions
                            bot={{ id: b.id, name: b.name, client_name: b.client_name, is_demo: false, status: b.status }}
                            demoUrl={null}
                            embedSnippet={`<script src="${base}/widget.js" data-key="${b.public_key}" async></script>`}
                            whatsappUrl={null}
                            onDelete={deleteBot.bind(null, b.id, undefined)}
                          />
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-[12.5px]">
                        <Status status={b.status} />
                        <span className="font-mono text-[11.5px] text-muted tabular">{num(s.conversations)} conversas · {num(s.leads)} leads</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {canConfig && (
            <section className="grid gap-3 md:grid-cols-3">
              <SummaryCard title="Relatório do mês" href={href("relatorio")}>
                {client.report_email ? <>Vai para <span className="text-ink-2">{client.report_email}</span> todo dia 1º. </> : "Sem e-mail para o relatório: o cliente não recebe o resumo do mês. "}
                {client.report_last_period ? <>Último: <span className="capitalize">{periodLabel(client.report_last_period)}</span>.</> : null}
              </SummaryCard>
              <SummaryCard title="Área do cliente" href={href("acesso")}>
                {memberCount ? `${memberCount} ${memberCount === 1 ? "pessoa entra" : "pessoas entram"} na área do cliente` : "Ninguém do cliente entra ainda"}
                {client.allow_handoff ? " · atendem as conversas" : ""}.
              </SummaryCard>
              <SummaryCard title="Link do cliente" href={href("relatorio")}>
                {client.portal_token ? "Ligado: a página com os números do mês, com a sua marca." : "Desligado. Crie o link para o cliente ver os números sem login."}
              </SummaryCard>
            </section>
          )}
        </>
      )}

      {tab === "leads" && (
        <>
          {(leads ?? []).length > 0 && can(role, "export") && (
            <div className="flex justify-end">
              <a href={`/api/leads/export?cliente=${client.id}`} className="btn-ghost"><Download size={15} />Exportar CSV</a>
            </div>
          )}
          <LeadList leads={leads} originLabel="Chatbot" originOf={(bid) => botName.get(bid) ?? ""} empty="Nenhum lead deste cliente ainda. Eles aparecem aqui assim que um visitante deixar contato no chat." />
          {can(role, "security") && (
            <details className="card group p-4">
              <summary className="cursor-pointer list-none text-sm font-medium text-ink-2 [&::-webkit-details-marker]:hidden">Apagar os dados de uma pessoa (pedido LGPD)</summary>
              <ActionForm action={eraseContactData.bind(null, client.id)} className="mt-3 flex flex-wrap items-end gap-2">
                <div className="min-w-[240px] flex-1">
                  <label htmlFor="erase-contact" className="label">E-mail ou WhatsApp que ela deixou no chat</label>
                  <input id="erase-contact" name="contact" required maxLength={120} className="input" placeholder="ana@exemplo.com ou (21) 99999-0000" />
                </div>
                <SubmitButton pendingLabel="Apagando…" className="btn-danger">Apagar dados</SubmitButton>
                <p className="w-full text-xs text-muted">Apaga os contatos com esse e-mail ou telefone e as conversas em que eles foram deixados, em todos os chatbots deste cliente. Não tem desfazer.</p>
              </ActionForm>
            </details>
          )}
        </>
      )}

      {tab === "contatos" && (
        <ContactsList
          botIds={botIds}
          bots={new Map(bots.map((b) => [b.id, { name: b.name, color: b.appearance?.color ?? null, face: b.face }]))}
          contactHref={(c) => `/painel/clientes/${client.id}/contatos/${c.id}`}
          searchParams={sp}
          basePath={`/painel/clientes/${client.id}`}
          hidden={{ tab: "contatos" }}
          importHref={`/painel/clientes/${client.id}/contatos/importar`}
          emptyText="Nenhum contato ainda. Cada pessoa que conversa com os chatbots deste cliente pelo WhatsApp, pelo Instagram ou identificada no site aparece aqui."
        />
      )}

      {tab === "campanhas" && <ClientCampaigns clientId={client.id} clientName={client.name} bots={bots.map((b) => ({ id: b.id, name: b.name, client_name: b.client_name, client_id: client.id }))} />}

      {tab === "conversas" && (
        <>
          <PendingHandoffs items={pending} showClient={false} hrefFor={(h) => `/painel/caixa?fila=todas&c=${h.id}`} />
          <div className="card overflow-hidden">
            {(conversations ?? []).length === 0 && <p className="p-6 text-sm text-muted">Nenhuma conversa ainda.</p>}
            {(conversations ?? []).map((c) => {
              const b = botFace.get(c.bot_id);
              return (
                <Link key={c.id} href={`/painel/caixa?fila=todas&c=${c.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line-2 px-4 py-3 text-sm transition-colors duration-[120ms] last:border-0 hover:bg-raised/50">
                  <BotFace color={b?.appearance?.color} face={b?.face} size={24} />
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate font-medium text-ink">{botName.get(c.bot_id)}</span>
                    <span className="block text-[12.5px] text-muted">começou {relativeTime(c.started_at)} · {c.message_count} mensagens</span>
                  </span>
                  <span className="rounded-md px-1.5 py-px text-[11px] text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line-strong)]">{CHANNEL_LABEL[c.channel] ?? c.channel}</span>
                  <ConversationStateBadge conv={c} />
                  {handoffStatus(c) ? <HandoffBadge conv={c} /> : c.needs_human ? <span className="text-xs text-muted">precisou de ajuda</span> : null}
                </Link>
              );
            })}
          </div>
        </>
      )}

      {tab === "relatorio" && (
        <div className="flex max-w-[720px] flex-col gap-5">
          <section className="card flex flex-col gap-3 p-5">
            <div>
              <h2 className="text-base font-medium">Link do cliente</h2>
              <p className="text-sm text-muted">Uma página com a sua marca onde {client.name} vê os números do mês. Sem login: quem tiver o link consegue abrir, por isso ela não mostra contatos nem conversas. Esses ficam na área do cliente, com login pelo e-mail (Acesso do cliente).</p>
            </div>
            {client.portal_token ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-[10px] border border-line bg-field px-3 py-2 font-mono text-xs">{portalUrl(client.portal_token, base)}</code>
                  <CopyButton text={portalUrl(client.portal_token, base)} label="Copiar link" className="btn-ghost" />
                  <a href={portalUrl(client.portal_token, base)} target="_blank" rel="noopener" className="btn-ghost"><ExternalLink size={15} />Abrir</a>
                </div>
                <div className="flex flex-wrap gap-2">
                  <ConfirmAction action={enablePortal.bind(null, client.id)} title="Trocar o link?" description="O link atual para de funcionar e um novo é gerado. Use se o link foi parar em quem não devia." confirmLabel="Trocar link" className="btn-ghost text-xs">Trocar link</ConfirmAction>
                  <ConfirmAction action={disablePortal.bind(null, client.id)} title="Desligar o link?" description="Ninguém mais consegue abrir a página do cliente. O relatório por e-mail passa a levar para a entrada da área do cliente." confirmLabel="Desligar" className="btn-ghost text-xs text-danger">Desligar link</ConfirmAction>
                </div>
              </>
            ) : (
              <ActionForm action={enablePortal.bind(null, client.id)}>
                <SubmitButton pendingLabel="Gerando…" className="btn-primary">Criar link do cliente</SubmitButton>
              </ActionForm>
            )}
          </section>

          <section className="card flex flex-col gap-3 p-5">
            <div>
              <h2 className="text-base font-medium">Relatório mensal por e-mail</h2>
              <p className="text-sm text-muted">Todo dia 1º, {client.name} recebe um resumo do mês anterior (pessoas atendidas, contatos, % resolvido sozinho) com a sua marca e o link acima (ou a entrada da área do cliente, se o link estiver desligado). O e-mail leva só números, nunca contatos. É o que mostra para o cliente por que ele paga você.</p>
            </div>
            <ActionForm key={client.report_email ?? ""} action={saveReportEmail.bind(null, client.id)} className="flex flex-wrap items-end gap-2">
              <div className="min-w-[220px] flex-1">
                <label htmlFor="report_email" className="label">E-mail do cliente</label>
                <input id="report_email" name="report_email" type="email" maxLength={200} defaultValue={client.report_email ?? ""} className="input" placeholder="dono@clinicasorriso.com.br" />
              </div>
              <SubmitButton className="btn-primary">Salvar</SubmitButton>
            </ActionForm>
            {client.report_email && !(members ?? []).some((m) => m.email === client.report_email) && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] bg-raised/60 px-3 py-2.5 text-sm">
                <span className="text-ink-2">Para ver os contatos e as conversas, <strong className="text-ink">{client.report_email}</strong> precisa de acesso à área do cliente.</span>
                <ActionForm action={addClientMember.bind(null, client.id)}>
                  <input type="hidden" name="email" value={client.report_email} />
                  <SubmitButton pendingLabel="Enviando convite…" className="btn-ghost text-xs">Dar acesso e convidar</SubmitButton>
                </ActionForm>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-2 pt-3 text-sm">
              <span className="text-muted">{client.report_last_period ? <>Último enviado: <span className="capitalize">{periodLabel(client.report_last_period)}</span>.</> : "Nenhum relatório enviado ainda."}</span>
              <ConfirmAction
                action={sendReportNow.bind(null, client.id, undefined)}
                title={`Enviar o relatório de ${periodLabel(shiftPeriod(currentPeriodBR(), -1))}?`}
                description={<>Vai para <strong className="text-ink">{client.report_email ?? "o e-mail do cliente"}</strong> agora.</>}
                confirmLabel="Enviar agora"
                danger={false}
                disabled={!client.report_email}
                className="btn-ghost"
              >
                Enviar o do mês passado agora
              </ConfirmAction>
            </div>
          </section>
        </div>
      )}

      {tab === "acesso" && (
        <div className="flex max-w-[720px] flex-col gap-5">
          <section className="card flex flex-col gap-3 p-5">
            <div>
              <h2 className="text-base font-medium">Pessoas com acesso</h2>
              <p className="text-sm text-muted">Elas entram na área do cliente (<code className="font-mono text-[12px]">{base.replace(/^https?:\/\//, "")}/cliente</code>) com um link no e-mail, sem senha. O <strong className="text-ink-2">gestor</strong> vê o relatório, as conversas, os canais, a privacidade e a equipe (convida atendentes); o <strong className="text-ink-2">atendente</strong> vê só as conversas.</p>
            </div>
            <ActionForm action={addClientMember.bind(null, client.id)} className="flex flex-wrap items-end gap-2">
              <div className="min-w-[220px] flex-1">
                <label htmlFor="member-email" className="label">E-mail</label>
                <input id="member-email" name="email" type="email" required maxLength={200} className="input" placeholder="recepcao@clinicasorriso.com.br" />
              </div>
              <div>
                <label htmlFor="member-role" className="label">Papel</label>
                <select id="member-role" name="role" defaultValue="manager" className="input">
                  <option value="manager">Gestor</option>
                  <option value="agent">Atendente</option>
                </select>
              </div>
              <SubmitButton pendingLabel="Enviando convite…" className="btn-primary">Adicionar e convidar</SubmitButton>
            </ActionForm>
            <div className="overflow-hidden rounded-[12px] border border-line">
              {(members ?? []).length === 0 && <p className="p-4 text-sm text-muted">Ninguém ainda.</p>}
              {(members ?? []).map((m) => (
                <div key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line-2 px-4 py-3 text-sm last:border-0">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-raised text-[11px] font-semibold text-ink">{initials(m.display_name ?? m.email)}</span>
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate font-medium text-ink">{m.display_name ?? m.email}</span>
                    <span className="block truncate text-[12.5px] text-muted">
                      {m.display_name ? `${m.email} · ` : ""}
                      {m.last_login_at ? `entrou ${relativeTime(m.last_login_at)}` : "ainda não entrou"}
                      {m.invited_by_key ? " · convidada pela API" : ""}
                    </span>
                  </span>
                  <ActionForm action={setClientMemberRole.bind(null, client.id, m.id)} className="flex items-center gap-1.5">
                    <select name="role" defaultValue={m.role} aria-label={`Papel de ${m.email}`} className="input w-auto py-1 text-xs">
                      <option value="manager">Gestor</option>
                      <option value="agent">Atendente</option>
                    </select>
                    <SubmitButton pendingLabel="…" className="text-xs font-medium text-brand hover:text-brand-2">Salvar</SubmitButton>
                  </ActionForm>
                  <ConfirmAction action={resendClientInvite.bind(null, client.id, m.id)} title="Reenviar o link?" description={<>Um link novo de acesso vai para <strong className="text-ink">{m.email}</strong>.</>} confirmLabel="Reenviar" danger={false} className="text-xs font-medium text-brand hover:text-brand-2">Reenviar link</ConfirmAction>
                  <ConfirmAction action={removeClientMember.bind(null, client.id, m.id)} title="Tirar o acesso?" description={<><strong className="text-ink">{m.email}</strong> não consegue mais entrar na área do cliente.</>} confirmLabel="Tirar acesso" className="text-xs font-medium text-danger hover:underline">Remover</ConfirmAction>
                </div>
              ))}
            </div>
          </section>

          <section className="card flex flex-col gap-3 p-5">
            <div>
              <h2 className="text-base font-medium">O que {client.name} pode fazer</h2>
              <p className="text-sm text-muted">Vale para as pessoas acima, nos dois papéis.</p>
            </div>
            <ActionForm key={`${client.allow_handoff}${client.allow_knowledge}${client.allow_hours}${client.handoff_notify}`} action={setClientPermissions.bind(null, client.id)} className="flex flex-col gap-3">
              <label className="flex items-start gap-2.5 text-sm">
                <input type="checkbox" name="allow_handoff" defaultChecked={client.allow_handoff} className="mt-1" />
                <span><strong className="font-medium">Atender conversas</strong><span className="block text-muted">Assumir quando o visitante pede alguém, responder e devolver ao assistente. Eles também recebem o aviso por e-mail.</span></span>
              </label>
              <fieldset className="ml-6 flex flex-col gap-1.5 rounded-[12px] border border-line-2 bg-raised/40 px-3 py-2.5 text-sm">
                <legend className="px-1 text-xs font-medium text-muted">Quem recebe o e-mail quando um visitante pede atendimento</legend>
                <label className="flex items-center gap-2">
                  <input type="radio" name="handoff_notify" value="all" defaultChecked={client.handoff_notify !== "client"} />
                  Você (agência) e as pessoas do cliente
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="handoff_notify" value="client" defaultChecked={client.handoff_notify === "client"} />
                  Só as pessoas do cliente (você delegou o atendimento)
                </label>
                <span className="text-xs text-muted">Se o cliente não puder atender ou não tiver ninguém cadastrado, o e-mail continua indo para você, para nenhum pedido ficar sem aviso.</span>
              </fieldset>
              <label className="flex items-start gap-2.5 text-sm">
                <input type="checkbox" name="allow_knowledge" defaultChecked={client.allow_knowledge} className="mt-1" />
                <span><strong className="font-medium">Ensinar o assistente</strong><span className="block text-muted">Só o gestor: responder as perguntas sem resposta e criar/editar textos e FAQs. Site e PDFs continuam só com você.</span></span>
              </label>
              <label className="flex items-start gap-2.5 text-sm">
                <input type="checkbox" name="allow_hours" defaultChecked={client.allow_hours} className="mt-1" />
                <span><strong className="font-medium">Editar o horário de atendimento</strong><span className="block text-muted">Só o gestor: os dias e horas em que a equipe atende, em cada assistente. Fora do horário, o assistente diz quando a equipe volta.</span></span>
              </label>
              <SubmitButton className="btn-primary self-start">Salvar permissões</SubmitButton>
            </ActionForm>
          </section>
        </div>
      )}

      {tab === "conformidade" && <ClientCompliance clientId={client.id} clientName={client.name} />}

      {tab === "setores" && <SectorsTab agencyId={agency.id} clientId={client.id} />}
      {tab === "respostas" && <ClientQuickReplies clientId={client.id} replies={await listQuickReplies(createAdminClient(), client.id)} />}

      {tab === "dados" && (
        <div className="flex max-w-[640px] flex-col gap-5">
          <ActionForm key={client.name + client.price_cents} action={updateClientRecord.bind(null, client.id)} className="card flex flex-col gap-4 p-5">
            <div>
              <h2 className="text-base font-medium">Dados do cliente</h2>
              <p className="text-sm text-muted">Mudar o nome aqui atualiza o nome que aparece no chat de todos os chatbots deste cliente.</p>
            </div>
            <ClientFields name={client.name} site={client.site} priceCents={client.price_cents} />
            <SubmitButton className="btn-primary self-start">Salvar</SubmitButton>
          </ActionForm>
          {can(role, "integrations") && <ClientIntegrationsSummary agencyId={agency.id} clientId={client.id} bots={bots.map((b) => ({ id: b.id, name: b.name }))} />}
          {can(role, "security") && <ClientPrivacy clientId={client.id} clientName={client.name} clientMonths={(client.retention_months as number | null) ?? null} agencyMonths={agency.retention_months} />}
          {can(role, "export") && <ExportLinks clientId={client.id} description={`Os dados de ${client.name}: conversas, contatos e leads, em CSV (abre no Excel) ou JSON. Na saída do cliente, entregue a ele. A exportação fica registrada.`} />}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-danger-line px-4 py-3">
            <span className="text-sm text-muted">{bots.length ? "Para excluir o cliente, exclua os chatbots dele antes." : "Excluir este cliente da sua lista."}</span>
            <ConfirmAction
              action={deleteClientRecord.bind(null, client.id)}
              title="Excluir este cliente?"
              description={<><strong className="text-ink">{client.name}</strong> sai da sua lista de clientes. Não tem desfazer.</>}
              confirmLabel="Excluir cliente"
              disabled={bots.length > 0}
            >
              Excluir cliente
            </ConfirmAction>
          </div>
        </div>
      )}
    </>
  );
}

/** Aba Setores (Caixa de entrada, parte 1): tabelas internas, lidas com a service role depois de a RLS confirmar o cliente. */
async function SectorsTab({ agencyId, clientId }: { agencyId: string; clientId: string }) {
  const admin = createAdminClient();
  const [sectors, eligible, holidays, { data: client }] = await Promise.all([
    listSectors(admin, [clientId]),
    eligibleSectorMembers(admin, { agencyId, clientId }),
    clientHolidays(admin, clientId),
    admin.from("clients").select("managers_see_all_sectors").eq("id", clientId).maybeSingle(),
  ]);
  return <ClientSectors clientId={clientId} sectors={sectors} eligible={eligible} holidays={holidays} seeAll={Boolean(client?.managers_see_all_sectors)} />;
}
