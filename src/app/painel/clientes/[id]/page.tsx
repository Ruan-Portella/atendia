import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, ExternalLink, Plus } from "lucide-react";
import { requireAgency } from "@/lib/agency";
import { createClient } from "@/lib/supabase/server";
import { brl, num } from "@/lib/plans";
import { getBotStats, getPendingHandoffs, resolvedPct } from "@/lib/panel";
import { PendingHandoffs } from "@/components/pending-handoffs";
import { ConversationStateBadge } from "@/components/conversation-state";
import { daysAgoIso, initials, relativeTime } from "@/lib/utils";
import { agencyBaseUrl } from "@/lib/domain";
import { Status } from "@/components/status";
import { Kpi } from "@/components/kpi";
import { BotRowActions } from "@/components/bot-row-actions";
import { LeadList, type LeadRow } from "@/components/lead-list";
import { ClientFields } from "@/components/client-fields";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { CopyButton } from "@/components/copy-button";
import { currentPeriodBR, periodLabel, portalUrl, shiftPeriod } from "@/lib/report";
import { addClientMember, deleteBot, eraseContactData, deleteClientRecord, disablePortal, enablePortal, removeClientMember, resendClientInvite, saveReportEmail, sendReportNow, setClientPermissions, updateClientRecord } from "../../actions";

export const metadata = { title: "Cliente" };

const TABS = [
  ["chatbots", "Chatbots"],
  ["leads", "Leads"],
  ["conversas", "Conversas"],
  ["relatorio", "Relatório e portal"],
  ["acesso", "Acesso do cliente"],
  ["dados", "Dados do cliente"],
] as const;
type Tab = (typeof TABS)[number][0];

interface BotRow {
  id: string;
  name: string;
  client_name: string;
  client_site: string | null;
  status: string;
  public_key: string;
  appearance: { color?: string; avatar_text?: string } | null;
}

export default async function ClientPanelPage({ params, searchParams }: PageProps<"/painel/clientes/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const tab = (TABS.some(([t]) => t === sp.tab) ? sp.tab : "chatbots") as Tab;
  const supabase = await createClient();
  // a RLS limita os dados à agência logada
  const [{ agency }, { data: client }, { data: botData }, stats] = await Promise.all([
    requireAgency(),
    supabase.from("clients").select("id, name, site, price_cents, created_at, portal_token, report_email, report_last_period, allow_handoff, allow_knowledge").eq("id", id).maybeSingle(),
    supabase.from("bots").select("id, name, client_name, client_site, status, public_key, appearance").eq("client_id", id).eq("is_demo", false).order("created_at"),
    getBotStats(supabase, daysAgoIso(30)),
  ]);
  if (!client) notFound();
  const bots = (botData ?? []) as BotRow[];
  const botIds = bots.map((b) => b.id);
  const botName = new Map(bots.map((b) => [b.id, b.name]));
  const total = bots.reduce((t, b) => {
    const s = stats.of(b.id);
    return { conversations: t.conversations + s.conversations, needsHuman: t.needsHuman + s.needsHuman, leads: t.leads + s.leads };
  }, { conversations: 0, needsHuman: 0, leads: 0 });
  const pct = resolvedPct(total);
  const base = agencyBaseUrl(agency);

  // Só busca o que a aba aberta mostra.
  const [pending, { data: leads }, { data: conversations }, { data: members }] = await Promise.all([
    getPendingHandoffs(supabase, botIds),
    tab === "leads" && botIds.length
      ? supabase.from("leads").select("id, bot_id, conversation_id, name, phone, email, notes, created_at").in("bot_id", botIds).order("created_at", { ascending: false }).limit(200)
      : Promise.resolve({ data: [] as LeadRow[] }),
    tab === "conversas" && botIds.length
      ? supabase.from("conversations").select("id, bot_id, started_at, last_message_at, visitor_seen_at, message_count, needs_human, channel, handoff_requested_at, handled_at").in("bot_id", botIds).order("last_message_at", { ascending: false }).limit(50)
      : Promise.resolve({ data: [] as Array<{ id: string; bot_id: string; started_at: string; last_message_at: string; visitor_seen_at: string | null; message_count: number; needs_human: boolean; channel: string; handoff_requested_at: string | null; handled_at: string | null }> }),
    tab === "acesso"
      ? supabase.from("client_members").select("id, email, last_login_at, created_at").eq("client_id", id).order("created_at")
      : Promise.resolve({ data: [] as Array<{ id: string; email: string; last_login_at: string | null; created_at: string }> }),
  ]);

  return (
    <>
      <div className="flex flex-col gap-3">
        <Link href="/painel/clientes" className="text-sm font-semibold text-muted">← Clientes</Link>
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-bold text-brand">{initials(client.name)}</span>
          <div className="min-w-0 flex-1 leading-tight">
            <h1 className="truncate text-2xl font-bold sm:text-[28px]">{client.name}</h1>
            <p className="truncate text-sm text-muted">
              {client.site ? <a href={/^https?:\/\//.test(client.site) ? client.site : `https://${client.site}`} target="_blank" rel="noopener" className="hover:underline">{client.site.replace(/^https?:\/\//, "")}</a> : "sem site"} · cliente desde {new Date(client.created_at).toLocaleDateString("pt-BR")}
            </p>
          </div>
          <Link href={`/painel/bots/novo?cliente=${client.id}`} className="btn-primary w-full sm:w-auto"><Plus size={15} />Novo chatbot</Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-3.5 xl:grid-cols-4">
        <Kpi label="Conversas (30 dias)" value={num(total.conversations)} sub={`em ${bots.length} chatbot${bots.length === 1 ? "" : "s"}`} />
        <Kpi label="Leads (30 dias)" value={num(total.leads)} sub="nome + contato entregues" />
        <Kpi label="Resolvidas sem humano" value={`${pct}%`} sub={`${100 - pct}% pediram atendente`} />
        <Kpi label="Você cobra" value={client.price_cents ? brl(client.price_cents / 100) : "—"} sub={client.price_cents ? "por mês" : "defina em Dados do cliente"} />
      </div>

      <PendingHandoffs items={pending} showClient={false} />

      <nav className="-mb-1 flex gap-1 overflow-x-auto border-b border-line [scrollbar-width:none]">
        {TABS.map(([key, label]) => (
          <Link key={key} href={`/painel/clientes/${id}?tab=${key}`} className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm ${tab === key ? "border-brand font-semibold text-brand" : "border-transparent font-medium text-ink-2 hover:text-ink"}`}>
            {label}{key === "conversas" && pending.length > 0 ? <span className="ml-1.5 rounded-full bg-amber-soft px-1.5 py-0.5 text-[11px] font-semibold text-amber-ink">{pending.length}</span> : null}
          </Link>
        ))}
      </nav>

      {tab === "chatbots" && (
        <div className="card overflow-hidden">
          {bots.length === 0 && (
            <div className="flex flex-col items-start gap-3 p-6">
              <p className="text-sm text-muted">Este cliente ainda não tem chatbots.</p>
              <Link href={`/painel/bots/novo?cliente=${client.id}`} className="btn-primary"><Plus size={15} />Criar o primeiro chatbot</Link>
            </div>
          )}
          {bots.map((b) => {
            const s = stats.of(b.id);
            return (
              <div key={b.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line-2 px-4 py-3.5 text-sm last:border-0 lg:px-[18px]">
                <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: b.appearance?.color ?? "#1f4e3d" }}>{b.appearance?.avatar_text ?? initials(b.client_name)}</span>
                <span className="min-w-0 flex-1 leading-tight">
                  <Link href={`/painel/bots/${b.id}`} className="block truncate font-semibold hover:underline">{b.name}</Link>
                  <span className="block truncate text-xs text-muted">{b.client_site?.replace(/^https?:\/\//, "") ?? "sem site"}</span>
                </span>
                <Status status={b.status} />
                <span className="tabular text-muted">{num(s.conversations)} conversas</span>
                <span className="tabular text-muted">{num(s.leads)} leads</span>
                <Link href={`/painel/bots/${b.id}`} className="text-[13px] font-semibold text-brand">Editar</Link>
                <BotRowActions
                  bot={{ id: b.id, name: b.name, client_name: b.client_name, is_demo: false, status: b.status }}
                  demoUrl={null}
                  embedSnippet={`<script src="${base}/widget.js" data-key="${b.public_key}" async></script>`}
                  whatsappUrl={null}
                  onDelete={deleteBot.bind(null, b.id, undefined)}
                />
              </div>
            );
          })}
        </div>
      )}

      {tab === "leads" && (
        <>
          {(leads ?? []).length > 0 && (
            <div className="flex justify-end">
              <a href={`/api/leads/export?cliente=${client.id}`} className="btn-ghost"><Download size={15} />Exportar CSV</a>
            </div>
          )}
          <ActionForm action={eraseContactData.bind(null, client.id)} className="card flex flex-wrap items-end gap-2 p-4">
            <div className="min-w-[240px] flex-1">
              <label htmlFor="erase-contact" className="label">Apagar os dados de uma pessoa (pedido LGPD)</label>
              <input id="erase-contact" name="contact" required maxLength={120} className="input" placeholder="E-mail ou WhatsApp que ela deixou no chat" />
            </div>
            <SubmitButton pendingLabel="Apagando…" className="btn-danger">Apagar dados</SubmitButton>
            <p className="w-full text-xs text-muted">Apaga os contatos com esse e-mail ou telefone e as conversas em que eles foram deixados, em todos os chatbots deste cliente. Não tem desfazer.</p>
          </ActionForm>
          <LeadList leads={(leads ?? []) as LeadRow[]} originLabel="Chatbot" originOf={(bid) => botName.get(bid) ?? ""} empty="Nenhum lead deste cliente ainda. Eles aparecem aqui assim que um visitante deixar contato no chat." />
        </>
      )}

      {tab === "conversas" && (
        <div className="card overflow-hidden">
          {(conversations ?? []).length === 0 && <p className="p-5 text-sm text-muted">Nenhuma conversa ainda.</p>}
          {(conversations ?? []).map((c) => (
            <Link key={c.id} href={`/painel/bots/${c.bot_id}/conversas/${c.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-2 px-4 py-3 text-sm last:border-0 hover:bg-ground">
              <span className="text-muted">{relativeTime(c.started_at)}</span>
              <span className="font-medium">{botName.get(c.bot_id)}</span>
              <span>{c.message_count} mensagens</span>
              <span className="text-xs text-muted">{c.channel}</span>
              <ConversationStateBadge conv={c} />
              {c.handoff_requested_at && !c.handled_at ? <span className="ml-auto rounded-full bg-amber-soft px-2 py-0.5 text-xs font-semibold text-amber-ink">esperando atendente</span> : c.needs_human ? <span className="ml-auto text-xs text-muted">precisou de ajuda</span> : null}
            </Link>
          ))}
        </div>
      )}

      {tab === "relatorio" && (
        <div className="flex max-w-[720px] flex-col gap-5">
          <section className="card flex flex-col gap-3 p-5">
            <div>
              <h2 className="text-base font-bold">Link do cliente</h2>
              <p className="text-sm text-muted">Uma página com a sua marca onde {client.name} vê o relatório do mês, os contatos capturados e as conversas. Somente leitura, sem login: quem tiver o link consegue abrir.</p>
            </div>
            {client.portal_token ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-lg border border-line bg-ground px-3 py-2 text-xs">{portalUrl(client.portal_token, base)}</code>
                  <CopyButton text={portalUrl(client.portal_token, base)} label="Copiar link" className="btn-ghost" />
                  <a href={portalUrl(client.portal_token, base)} target="_blank" rel="noopener" className="btn-ghost"><ExternalLink size={15} />Abrir</a>
                </div>
                <div className="flex flex-wrap gap-2">
                  <ConfirmAction action={enablePortal.bind(null, client.id)} title="Trocar o link?" description="O link atual para de funcionar e um novo é gerado. Use se o link foi parar em quem não devia." confirmLabel="Trocar link" className="btn-ghost text-xs">Trocar link</ConfirmAction>
                  <ConfirmAction action={disablePortal.bind(null, client.id)} title="Desligar o link?" description="Ninguém mais consegue abrir a página do cliente. O relatório por e-mail também deixa de ter link até você criar outro." confirmLabel="Desligar" className="btn-ghost text-xs text-danger">Desligar link</ConfirmAction>
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
              <h2 className="text-base font-bold">Relatório mensal por e-mail</h2>
              <p className="text-sm text-muted">Todo dia 1º, {client.name} recebe um resumo do mês anterior (pessoas atendidas, contatos, % resolvido sozinho) com a sua marca e o link acima. É o que mostra para o cliente por que ele paga você.</p>
            </div>
            <ActionForm key={client.report_email ?? ""} action={saveReportEmail.bind(null, client.id)} className="flex flex-wrap items-end gap-2">
              <div className="min-w-[220px] flex-1">
                <label htmlFor="report_email" className="label">E-mail do cliente</label>
                <input id="report_email" name="report_email" type="email" maxLength={200} defaultValue={client.report_email ?? ""} className="input" placeholder="dono@clinicasorriso.com.br" />
              </div>
              <SubmitButton className="btn-primary">Salvar</SubmitButton>
            </ActionForm>
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
              <h2 className="text-base font-bold">O que {client.name} pode fazer</h2>
              <p className="text-sm text-muted">As pessoas abaixo entram na área do cliente (<code>{base.replace(/^https?:\/\//, "")}/cliente</code>) com um link no e-mail, sem senha. Sempre podem ver o relatório, os contatos e as conversas.</p>
            </div>
            <ActionForm key={`${client.allow_handoff}${client.allow_knowledge}`} action={setClientPermissions.bind(null, client.id)} className="flex flex-col gap-3">
              <label className="flex items-start gap-2.5 text-sm">
                <input type="checkbox" name="allow_handoff" defaultChecked={client.allow_handoff} className="mt-1" />
                <span><strong>Atender conversas</strong><span className="block text-muted">Assumir quando o visitante pede alguém, responder e devolver ao assistente. Eles também recebem o aviso por e-mail.</span></span>
              </label>
              <label className="flex items-start gap-2.5 text-sm">
                <input type="checkbox" name="allow_knowledge" defaultChecked={client.allow_knowledge} className="mt-1" />
                <span><strong>Ensinar o assistente</strong><span className="block text-muted">Responder as perguntas sem resposta e criar/editar textos e FAQs. Site e PDFs continuam só com você.</span></span>
              </label>
              <SubmitButton className="btn-primary self-start">Salvar permissões</SubmitButton>
            </ActionForm>
          </section>

          <section className="card flex flex-col gap-3 p-5">
            <div>
              <h2 className="text-base font-bold">Pessoas com acesso</h2>
              <p className="text-sm text-muted">Adicione o e-mail de cada pessoa (dono, recepção…). Ela recebe um convite com o link de entrada.</p>
            </div>
            <ActionForm action={addClientMember.bind(null, client.id)} className="flex flex-wrap items-end gap-2">
              <div className="min-w-[220px] flex-1">
                <label htmlFor="member-email" className="label">E-mail</label>
                <input id="member-email" name="email" type="email" required maxLength={200} className="input" placeholder="recepcao@clinicasorriso.com.br" />
              </div>
              <SubmitButton pendingLabel="Enviando convite…" className="btn-primary">Adicionar e convidar</SubmitButton>
            </ActionForm>
            <div className="overflow-hidden rounded-xl border border-line">
              {(members ?? []).length === 0 && <p className="p-4 text-sm text-muted">Ninguém ainda.</p>}
              {(members ?? []).map((m) => (
                <div key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-2 px-4 py-3 text-sm last:border-0">
                  <span className="min-w-0 flex-1 truncate font-medium">{m.email}</span>
                  <span className="text-xs text-muted">{m.last_login_at ? `entrou ${relativeTime(m.last_login_at)}` : "ainda não entrou"}</span>
                  <ConfirmAction action={resendClientInvite.bind(null, client.id, m.id)} title="Reenviar o link?" description={<>Um link novo de acesso vai para <strong className="text-ink">{m.email}</strong>.</>} confirmLabel="Reenviar" danger={false} className="text-xs font-semibold text-brand hover:underline">Reenviar link</ConfirmAction>
                  <ConfirmAction action={removeClientMember.bind(null, client.id, m.id)} title="Tirar o acesso?" description={<><strong className="text-ink">{m.email}</strong> não consegue mais entrar na área do cliente.</>} confirmLabel="Tirar acesso" className="text-xs font-semibold text-danger hover:underline">Remover</ConfirmAction>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {tab === "dados" && (
        <div className="flex max-w-[560px] flex-col gap-5">
          <ActionForm key={client.name + client.price_cents} action={updateClientRecord.bind(null, client.id)} className="card flex flex-col gap-4 p-6">
            <ClientFields name={client.name} site={client.site} priceCents={client.price_cents} />
            <p className="text-xs text-muted">Mudar o nome aqui atualiza o nome que aparece no chat de todos os chatbots deste cliente.</p>
            <SubmitButton className="btn-primary self-start">Salvar</SubmitButton>
          </ActionForm>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line px-4 py-3">
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
