import Link from "next/link";
import { backFrom } from "@/lib/back-link";
import { ConversationsBrowser } from "@/components/conversations-browser";
import { isConversationFilter } from "@/lib/conversation-list";
import { notFound } from "next/navigation";
import { ArrowRight, Building2, Download, Headset, Layers, LayoutDashboard, Plus, Settings2, Trash2, Users } from "lucide-react";
import { requireAgency } from "@/lib/agency";
import { can } from "@/lib/team";
import { createClient } from "@/lib/supabase/server";
import { brl, num } from "@/lib/plans";
import { getBotStats, getPendingHandoffs, resolvedPct } from "@/lib/panel";
import { PendingHandoffs } from "@/components/pending-handoffs";
import { cn, daysAgoIso, initials } from "@/lib/utils";
import { agencyBaseUrl } from "@/lib/domain";
import { Status } from "@/components/status";
import { Kpi } from "@/components/kpi";
import { BotFace } from "@/components/bot-face";
import { CreateButton } from "@/components/create-dialogs";
import { BotRowActions } from "@/components/bot-row-actions";
import { LeadList, type LeadRow } from "@/components/lead-list";
import { listLeads } from "@/lib/leads";
import { ClientFields } from "@/components/client-fields";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { ClientCompliance } from "@/components/client-compliance";
import { ClientAccessTab, ClientReportTab } from "@/components/client-settings-tabs";
import { DialogButton, SettingGroup, SettingRow } from "@/components/ui/setting-row";
import { ClientPrivacy } from "@/components/client-privacy";
import { ExportLinks } from "@/components/export-links";
import { periodLabel } from "@/lib/report";
import { deleteBot, deleteClientRecord, eraseContactData, updateClientRecord } from "../../actions";
import { ContactsList } from "@/components/contacts-list";
import { ClientCampaigns } from "@/components/client-campaigns";
import { ClientIntegrationsSummary } from "@/components/integrations/client-integrations-summary";
import { ClientSectors } from "@/components/client-sectors";
import { ClientQuickReplies } from "@/components/client-quick-replies";
import { listQuickReplies } from "@/lib/quick-replies";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientHolidays, eligibleSectorMembers, listSectors } from "@/lib/sectors";

export const metadata = { title: "Cliente" };
// a Nova campanha da aba Campanhas monta o público na prévia (até 10.000 contatos) e consulta a Meta
export const maxDuration = 60;

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
  sensitive_mode?: boolean | null;
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
    supabase.from("bots").select("id, name, client_name, client_site, status, public_key, appearance, face, template_id, sensitive_mode").eq("client_id", id).eq("is_demo", false).order("created_at"),
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
  const [pending, leads, { data: members }, { count: memberCount }] = await Promise.all([
    tab === "visao" ? getPendingHandoffs(supabase, botIds) : Promise.resolve([]),
    tab === "leads" ? listLeads(supabase, { botIds, limit: 200 }) : Promise.resolve([] as LeadRow[]),
    tab === "acesso" || (tab === "relatorio" && client.report_email)
      ? supabase.from("client_members").select("id, email, role, display_name, last_login_at, created_at, invited_by_key").eq("client_id", id).order("created_at")
      : Promise.resolve({ data: [] as Array<{ id: string; email: string; role: string; display_name: string | null; last_login_at: string | null; created_at: string; invited_by_key: string | null }> }),
    tab === "visao" && canConfig ? supabase.from("client_members").select("id", { count: "exact", head: true }).eq("client_id", id) : Promise.resolve({ count: null }),
  ]);
  const href = (t: Tab) => `/painel/clientes/${id}?tab=${t}`;

  return (
    <>
      <div className="flex flex-col gap-4">
        <Link href={backFrom(sp.de)?.href ?? "/painel/clientes"} className="text-[13px] font-medium text-muted hover:text-ink">← {backFrom(sp.de)?.label ?? "Clientes"}</Link>
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

          {/* 23/10 (pedido do usuário): os atalhos vêm antes dos chatbots */}
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

          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-medium">Chatbots</h2>
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

        </>
      )}

      {tab === "leads" && (
        // redesenho (23/10/2026): exportar e o pedido LGPD como botões no alto; o pedido abre um modal
        <>
          {((leads ?? []).length > 0 && can(role, "export")) || can(role, "security") ? (
            <div className="flex flex-wrap justify-end gap-2">
              {can(role, "security") && (
                <DialogButton label="Apagar os dados de uma pessoa" icon={<Trash2 size={15} />} className="btn-ghost" title="Apagar os dados de uma pessoa (pedido LGPD)" description="Apaga os contatos com esse e-mail ou telefone e as conversas em que eles foram deixados, em todos os chatbots deste cliente. Não tem desfazer." action={eraseContactData.bind(null, client.id)} saveLabel="Apagar dados" danger>
                  <div>
                    <label htmlFor="erase-contact" className="label">
                      E-mail ou WhatsApp que a pessoa deixou no chat
                    </label>
                    <input id="erase-contact" name="contact" required maxLength={120} className="input" placeholder="ana@exemplo.com ou (21) 99999-0000" />
                  </div>
                </DialogButton>
              )}
              {(leads ?? []).length > 0 && can(role, "export") && (
                <a href={`/api/leads/export?cliente=${client.id}`} className="btn-ghost">
                  <Download size={15} />
                  Exportar CSV
                </a>
              )}
            </div>
          ) : null}
          <LeadList leads={leads} from={`/painel/clientes/${id}?tab=leads`} originLabel="Chatbot" originOf={(bid) => botName.get(bid) ?? ""} empty="Nenhum lead deste cliente ainda. Eles aparecem aqui assim que um visitante deixar contato no chat." />
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
        // 23/10 (pedido do usuário): no jeito da Caixa de entrada, a lista e a conversa ao lado
        <ConversationsBrowser
          db={supabase}
          bots={bots.map((b) => ({ id: b.id, name: b.name, client_name: b.client_name, client_id: client.id, appearance: b.appearance, face: b.face, sensitive_mode: b.sensitive_mode }))}
          filter={isConversationFilter(sp.f) ? sp.f : "todas"}
          limit={Math.min(400, Math.max(40, Number(sp.n) || 40))}
          selectedId={typeof sp.c === "string" && /^[0-9a-f-]{36}$/i.test(sp.c) ? sp.c : null}
          earlier={Math.min(50, Number(sp.ant) || 0)}
          showBot={bots.length > 1}
          hrefFor={(o) => `/painel/clientes/${id}?tab=conversas${o.filter && o.filter !== "todas" ? `&f=${o.filter}` : ""}${o.limit && o.limit > 40 ? `&n=${o.limit}` : ""}${o.conversationId ? `&c=${o.conversationId}` : ""}${o.earlier ? `&ant=${o.earlier}` : ""}`}
        />
      )}

      {tab === "relatorio" && <ClientReportTab client={client} base={base} memberEmails={(members ?? []).map((m) => m.email)} />}

      {tab === "acesso" && <ClientAccessTab client={client} base={base} members={members ?? []} />}

      {tab === "conformidade" && <ClientCompliance clientId={client.id} clientName={client.name} />}

      {tab === "setores" && <SectorsTab agencyId={agency.id} clientId={client.id} />}
      {tab === "respostas" && <ClientQuickReplies clientId={client.id} replies={await listQuickReplies(createAdminClient(), client.id)} />}

      {tab === "dados" && (
        // redesenho (23/10/2026): o cadastro numa linha com o modal, e o resto em grupos de linhas
        <div className="flex flex-col gap-5">
          <SettingGroup title="Cadastro">
            <SettingRow
              icon={<Building2 size={18} />}
              title="Dados do cliente"
              summary={[client.name, client.site?.replace(/^https?:\/\//, ""), client.price_cents ? `${brl(client.price_cents / 100)} por mês` : null].filter(Boolean).join(" · ")}
              description="Mudar o nome aqui atualiza o nome que aparece no chat de todos os chatbots deste cliente."
              action={updateClientRecord.bind(null, client.id)}
            >
              <ClientFields name={client.name} site={client.site} priceCents={client.price_cents} />
            </SettingRow>
          </SettingGroup>
          {can(role, "integrations") && <ClientIntegrationsSummary agencyId={agency.id} clientId={client.id} bots={bots.map((b) => ({ id: b.id, name: b.name }))} />}
          {can(role, "security") && <ClientPrivacy clientId={client.id} clientName={client.name} clientMonths={(client.retention_months as number | null) ?? null} agencyMonths={agency.retention_months} />}
          {can(role, "export") && <ExportLinks clientId={client.id} description={`Os dados de ${client.name}: conversas, contatos e leads, em CSV (abre no Excel) ou JSON. Na saída do cliente, entregue a ele. A exportação fica registrada.`} />}
          <SettingGroup title="Excluir">
            <SettingRow
              icon={<Trash2 size={18} />}
              title="Excluir este cliente"
              summary={bots.length ? "Para excluir o cliente, exclua os chatbots dele antes" : "Ele sai da sua lista de clientes, sem desfazer"}
              trailing={
                <ConfirmAction action={deleteClientRecord.bind(null, client.id)} title="Excluir este cliente?" description={<><strong className="text-ink">{client.name}</strong> sai da sua lista de clientes. Não tem desfazer.</>} confirmLabel="Excluir cliente" disabled={bots.length > 0} className="btn-danger py-1.5 text-xs">
                  Excluir
                </ConfirmAction>
              }
            />
          </SettingGroup>
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
