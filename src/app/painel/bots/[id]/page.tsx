import Link from "next/link";
import { actionCapNotice } from "@/lib/action-limits";
import { FREE_LINKED_SHORT, freeLinked } from "@/lib/person-signals";
import { TEST_ANSWERS_FREE, botHasAi, num } from "@/lib/plans";
import { BotActions } from "@/components/integrations/bot-actions";
import { FixedContextCard } from "@/components/integrations/fixed-context-card";
import { TemplateInheritance, type DerivedItem } from "@/components/templates/template-inheritance";
import { InheritedList } from "@/components/templates/inherited-list";
import { createDerivedAction, publishTemplateAction, setTemplateUnlockedAction, restoreVersionAction } from "@/app/painel/modelos/actions";
import { OVERRIDE_FIELDS, TEMPLATE_FIELD_LABEL, hasUnpublished, readySourceCount, templateVersions, unlockedFields, type OverrideField, type TemplateField as InheritField } from "@/lib/bot-template";
import type { Persona } from "@/lib/ai";
import { saveFixedContext } from "@/app/painel/integracoes/actions";
import { requireAgencyMfa } from "@/lib/agency-mfa";
import { notFound, redirect } from "next/navigation";
import { requireAgency } from "@/lib/agency";
import { attendantOf, can } from "@/lib/team";
import { createClient } from "@/lib/supabase/server";
import { daysAgoIso, initials, relativeTime } from "@/lib/utils";
import { getClientOptions } from "@/lib/panel";
import { agencyBaseUrl } from "@/lib/domain";
import { embeddedSignupConfig } from "@/lib/whatsapp";
import { channelAccessOf } from "@/lib/features";
import { WhatsAppConnect } from "@/components/whatsapp-connect";
import { MomentNoticeCard } from "@/components/moment-notice-card";
import { activeMomentNotice, defaultUntilInput } from "@/lib/moment-notice";
import { CoexistenceConnect } from "@/components/coexistence-connect";
import { esVariantOf } from "@/lib/embedded-signup";
import { ConnectChecklist } from "@/components/connect-checklist";
import { ConnectLinkButton } from "@/components/connect-link-button";
import { WhatsAppTemplates } from "@/components/whatsapp-templates";
import { WhatsAppDiagnostics } from "@/components/whatsapp-diagnostics";
import { disconnectNextStep } from "@/lib/whatsapp-diagnostics";
import { WhatsAppUsage } from "@/components/whatsapp-usage";
import { TemplateSender } from "@/components/template-sender";
import { createAdminClient } from "@/lib/supabase/admin";
import { listUnanswered } from "@/lib/unanswered";
import { listRefusals } from "@/lib/scope-refusals";
import { countLeads } from "@/lib/leads";
import { listSendable, loadTemplateChannel, type SendableTemplate } from "@/lib/whatsapp-templates";
import { Status } from "@/components/status";
import { SourcesManager, type SourceItem } from "@/components/sources-manager";
import { LiveTest } from "@/components/live-test";
import { configBotId } from "@/lib/bot-template";
import { CopyButton } from "@/components/copy-button";
import { ConvertDemo } from "@/components/convert-demo";
import { InstallGuide } from "@/components/install-guide";
import { ChatPreviewSheet } from "@/components/chat-preview-sheet";
import { WidgetPositionPicker } from "@/components/widget-position";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { MarketingOptInForm } from "@/components/marketing-optin-form";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { ClientPicker } from "@/components/client-picker";
import { saveMomentNotice, clearMomentNotice, setSatisfactionSurvey } from "../../actions";
import { SatisfactionCard } from "@/components/satisfaction-card";
import { EvolutionTable } from "@/components/evolution-table";
import { botEvolution } from "@/lib/evolution";
import { satisfactionSummary } from "@/lib/satisfaction";
import { detachFromTemplate, markTransferReviewed, resetDerivedField } from "../../actions";
import { answerUnanswered, completeWhatsAppSignup, createWhatsAppConnectLink, disconnectInstagram, startWhatsAppConversation, connectWhatsApp, convertDemo, deleteBot, disconnectWhatsApp, pauseBot, resolveUnanswered, resumeBot, setAutoRefresh, setBotStatus, setMarketingOptIn, setPostPriceRule, updateBot } from "../../actions";
import { PostPriceCard } from "@/components/post-price-card";
import { IceBreakersCard, KeywordsCard, RefLinksCard, type KeywordItem, type PostChoice, type RefLinkItem } from "@/components/instagram-direct-cards";
import { addRefLink, removeKeyword, removeRefLink, saveCommentsAi, saveIceBreakers, saveKeyword } from "@/app/painel/instagram/actions";
import { commentsEnabled } from "@/lib/instagram";
import { InstagramCommentsCard } from "@/components/instagram-comments-card";
import { listComments, type CommentItem } from "@/lib/instagram-comments";
import { iceBreakersOf } from "@/lib/instagram-direct";
import { IG_USERNAME_PANEL_MS, refreshInstagramUsername } from "@/lib/instagram-channel";
import { renamedNotice } from "@/lib/instagram-links";
import { BotPauseButton } from "@/components/bot-pause";
import { BotRoutines } from "@/components/routines/bot-routines";
import { ChannelAcceptGate } from "@/components/channel-accept-gate";
import { UnansweredItem } from "@/components/unanswered-item";
import { FailedSends } from "@/components/failed-sends";
import { ConversationStateBadge } from "@/components/conversation-state";
import { HandoffBadge } from "@/components/handoff-badge";
import { handoffStatus } from "@/lib/handoff-status";
import { DEFAULT_AI_NOTICE, DEFAULT_AWAY_MESSAGE, DEFAULT_BACK_NOTICE, DEFAULT_ENTRY_NOTICE, NO_DATE_NOTICE, nextOpening, whenLabel, type HumanHandoff } from "@/lib/handoff-hours";
import { SIGNATURE_FORMATS, SIGNATURE_LABEL } from "@/lib/signature";
import { TICKET_SUBJECTS_MAX, type TicketForm } from "@/lib/tickets";
import { HUMAN_ONLY_NOTICE } from "@/lib/chat";
import { GATE_TEXTS } from "@/lib/gate/rules";
import { TemplateField } from "@/components/template-field";
import { HoursFields } from "@/components/hours-fields";
import type { RegulatedChannel } from "@/lib/gate/sales-channel";

export const metadata = { title: "Editor do chatbot" };

const TABS = [
  ["fontes", "Base de conhecimento"],
  ["personalidade", "Personalidade"],
  ["aparencia", "Aparência e marca"],
  ["leads", "Captura de leads"],
  ["atendimento", "Atendimento humano"],
  ["roteiros", "Roteiros"],
  ["acoes", "Ações"],
  ["conversas", "Conversas"],
  ["evolucao", "Evolução"],
  ["whatsapp", "WhatsApp"],
  ["instagram", "Instagram"],
  ["instalacao", "Instalação"],
  ["heranca", "Herança"],
] as const;
type Tab = (typeof TABS)[number][0];
/** O bot modelo (D', parte 2b) não atende: só a configuração comum e a Herança. */
const TEMPLATE_TABS = new Set<string>(["fontes", "personalidade", "aparencia", "atendimento", "roteiros", "acoes", "heranca"]);

export default async function BotEditorPage({ params, searchParams }: PageProps<"/painel/bots/[id]">) {
  const [{ id }, sp, { agency: owner, role, member, packs }] = await Promise.all([params, searchParams, requireAgency()]);
  // equipe (leva B1'): o atendente vê só as conversas do chatbot
  const canConfig = can(role, "config");
  // canais da Meta: liberação da agência no backoffice, ou abertura geral
  const access = await channelAccessOf(createAdminClient(), owner);
  const waAllowed = access.whatsapp === "liberado";
  const igAllowed = access.instagram === "liberado";
  // bot modelo (D', parte 2b): só as abas da configuração comum, mais a Herança (que os outros não têm)
  const { data: kind } = await (await createClient()).from("bots").select("is_template").eq("id", id).maybeSingle();
  const isTemplate = Boolean(kind?.is_template);
  const tabs = TABS.filter(([t]) => (canConfig || t === "conversas") && (t === "whatsapp" ? waAllowed : t === "instagram" ? igAllowed : true) && (isTemplate ? TEMPLATE_TABS.has(t) : t !== "heranca"));
  const tab = (tabs.some(([t]) => t === sp.tab) ? sp.tab : canConfig ? "fontes" : "conversas") as Tab;
  // Ações (C pública): dono e administrador mexem com o segundo fator; o editor só vê. Cadastrar e
  // testar não precisa do pacote; a IA só usa as ações com o Integrações
  const manageActions = can(role, "integrations");
  const integrations = packs.includes("integracoes");
  if (tab === "acoes" && manageActions) await requireAgencyMfa(`/painel/bots/${id}?tab=acoes`);
  const supabase = await createClient();

  // Tudo em paralelo e só o que a aba aberta usa. O texto bruto das fontes (sites e PDFs
  // inteiros) não vem mais: só o de textos/FAQs, que o modal de edição precisa.
  const none = Promise.resolve({ data: null, count: null });
  const [{ agency }, { data: bot }, { count: ownReady }, { data: sourceMeta }, { data: sourceTexts }, unanswered, { data: conversations }, leadCount, { data: igRow }, { data: whatsapp }] = await Promise.all([
    requireAgency(),
    supabase.from("bots").select("*").eq("id", id).maybeSingle(),
    supabase.from("sources").select("id", { count: "exact", head: true }).eq("bot_id", id).eq("status", "ready"),
    // as fontes com etiqueta de contexto (enviadas pela API, uma por cliente de um SaaS) ficam fora da lista: só a contagem
    tab === "fontes" ? supabase.from("sources").select("id, kind, title, url, status, chunk_count, pages, error, refresh_error, created_by, updated_at, sync_total, sync_requested_at, last_refreshed_at").eq("bot_id", id).is("context", null).order("created_at") : none,
    tab === "fontes" ? supabase.from("sources").select("id, content").eq("bot_id", id).is("context", null).in("kind", ["text", "faq"]) : none,
    tab === "fontes" ? listUnanswered(supabase, { botIds: [id], limit: 10 }) : Promise.resolve(null),
    tab === "conversas" ? supabase.from("conversations").select("id, started_at, last_message_at, visitor_seen_at, message_count, needs_human, channel, handoff_requested_at, takeover_at, handled_at, handoff_urgent_at, last_contact_at, last_reply_at").eq("bot_id", id).order("last_message_at", { ascending: false }).limit(30) : none,
    tab === "leads" ? countLeads(supabase, id) : Promise.resolve(null),
    // a aba Fontes também: os posts do Instagram são uma fonte (E1)
    tab === "instagram" || (tab === "fontes" && igAllowed) ? supabase.from("instagram_channels").select("ig_user_id, username, previous_username, username_changed_at, token_expires_at, disconnected_at, disconnect_reason, created_at").eq("bot_id", id).maybeSingle() : none,
    tab === "whatsapp" ? supabase.from("whatsapp_channels").select("phone_number_id, business_id, display_phone, verified_name, created_at, disconnected_at, disconnect_reason, coexistence").eq("bot_id", id).maybeSingle() : none,
  ]);
  if (!bot) notFound();
  // uma versão publicada do modelo (parte 3) não se edita: o editor é o do modelo
  if (bot.version_of) redirect(`/painel/bots/${bot.version_of}?tab=heranca`);
  // o nome de usuário muda no Instagram sem aviso e os links ig.me levam o nome (E1): confere na Meta
  // ao abrir a aba, no máximo uma vez por minuto (a consulta com a sessão já confirmou que o chatbot é da agência)
  const renamed = igRow && !igRow.disconnected_at && !bot.is_demo ? await refreshInstagramUsername(createAdminClient(), id, { maxAgeMs: IG_USERNAME_PANEL_MS }).catch(() => null) : null;
  const instagram = renamed && igRow ? { ...igRow, username: renamed.username, previous_username: renamed.previousUsername, username_changed_at: renamed.changedAt } : igRow;
  const igRenamed = instagram ? renamedNotice(instagram) : null;
  // o derivado usa a base do modelo: as fontes prontas dele contam no teste ao vivo e no Publicar
  const readySources = bot.template_id ? await readySourceCount(createAdminClient(), { id, template_id: bot.template_id as string }) : (ownReady ?? 0);
  // o teste ao vivo mostra o passo do roteiro (itens menores, parte 5): só com roteiro ligado (no derivado, os do modelo)
  const { count: liveRoutines } = await createAdminClient().from("routines").select("id", { count: "exact", head: true }).eq("bot_id", configBotId({ id, template_id: (bot.template_id as string | null) ?? null, config_bot_id: (bot.config_bot_id as string | null | undefined) ?? null })).eq("active", true);
  const hasLiveRoutines = (liveRoutines ?? 0) > 0;
  const clients = bot.is_demo || tab === "personalidade" || tab === "heranca" ? await getClientOptions(supabase, agency.id) : [];
  // aba Instagram (E1, partes 3a e 3b): os links ig.me com origem e as palavras-chave do chatbot
  const igTab = tab === "instagram" && !bot.is_demo;
  const commentsOn = commentsEnabled();
  const [refLinks, keywords, postChoices] = igTab
    ? await Promise.all([
        createAdminClient().from("instagram_ref_links").select("id, ref, label, note, created_at").eq("bot_id", id).order("created_at").then((r) => (r.data ?? []) as RefLinkItem[]),
        createAdminClient().from("instagram_keywords").select("id, words, dm_reply, comment_reply, comment_public, media_ids, active").eq("bot_id", id).order("created_at").then((r) => (r.data ?? []) as KeywordItem[]),
        // os posts da fonte do Instagram, para escolher onde a palavra vale nos comentários
        commentsOn ? createAdminClient().from("instagram_posts").select("media_id, caption, posted_at").eq("bot_id", id).order("posted_at", { ascending: false }).limit(100).then((r) => (r.data ?? []) as PostChoice[]) : Promise.resolve([] as PostChoice[]),
      ])
    : [[] as RefLinkItem[], [] as KeywordItem[], [] as PostChoice[]];
  // os comentários que chegaram (E1, parte 4a), com os posts para mostrar onde
  const comments: CommentItem[] = igTab && commentsOn ? await listComments(createAdminClient(), id) : [];
  const postsById = Object.fromEntries(postChoices.map((p) => [p.media_id, { caption: p.caption, posted_at: p.posted_at }]));
  // modelo (D'): os derivados, na Herança; derivado: o nome do modelo, na faixa do topo
  const derivedList = isTemplate && tab === "heranca" ? (((await createAdminClient().from("bots").select("id, name, client_name, status").eq("template_id", id).order("created_at")).data ?? []) as DerivedItem[]) : [];
  // modelo (parte 3): as versões, quantos derivados a publicação afeta e se há mudança não publicada
  const versions = isTemplate ? await templateVersions(createAdminClient(), id) : [];
  const derivedCount = isTemplate ? ((await createAdminClient().from("bots").select("id", { count: "exact", head: true }).eq("template_id", id)).count ?? 0) : 0;
  const currentVersion = versions.find((v) => v.id === bot.published_bot_id) ?? null;
  const unpublished = isTemplate && hasUnpublished(bot.draft_changed_at, currentVersion);
  const templateRow = bot.template_id
    ? ((await createAdminClient().from("bots").select("name, persona, business_topics, template_unlocked").eq("id", bot.template_id).maybeSingle()).data as { name: string; persona: Persona | null; business_topics: string | null; template_unlocked: string[] | null } | null)
    : null;
  const templateName = bot.template_id ? (templateRow?.name ?? "modelo") : null;
  // derivado (D', parte 2c): o que o modelo libera e o que já tem valor próprio
  const opens = (f: InheritField) => !templateRow || unlockedFields(templateRow).includes(f);
  const owns = (f: OverrideField) => Boolean(templateRow) && Object.prototype.hasOwnProperty.call((bot.overrides as Record<string, unknown> | null) ?? {}, f);
  const ownFields = templateRow ? ([...OVERRIDE_FIELDS.filter(owns), ...(bot.extra_instructions ? ["instrucoes" as const] : [])] as InheritField[]) : [];
  const textOf = new Map(((sourceTexts ?? []) as Array<{ id: string; content: string | null }>).map((t) => [t.id, t.content]));
  const sources: SourceItem[] = ((sourceMeta ?? []) as Array<Omit<SourceItem, "content">>).map((s) => ({ ...s, content: textOf.get(s.id) ?? null }));

  const persona = bot.persona ?? {};
  const appearance = bot.appearance ?? {};
  const leadCapture = bot.lead_capture ?? {};
  const handoff = (bot.human_handoff ?? {}) as HumanHandoff;
  // chamados no chat do site (Caixa de entrada, parte 7a): o que está guardado, ligado ou não
  const ticketForm = (bot.ticket_form ?? null) as TicketForm | null;
  // pedidos fora do assunto (trava de escopo): separados das perguntas sem resposta; tabela interna,
  // lida com a service role depois de a sessão confirmar o dono do chatbot
  const taggedSources = tab === "fontes" ? ((await supabase.from("sources").select("id", { count: "exact", head: true }).eq("bot_id", id).not("context", "is", null)).count ?? 0) : 0;
  const refusals = tab === "fontes" && !bot.is_demo
    ? await listRefusals(createAdminClient(), { botId: id, since: daysAgoIso(30), limit: 10 })
    : [];
  // exemplo do {volta} na prévia: a próxima abertura pelo horário salvo (ou um exemplo fixo)
  const nextOpen = nextOpening(handoff.hours);
  const awayExample = nextOpen ? whenLabel(nextOpen) : "segunda, das 9h às 18h";
  const regulated = (bot.regulated_channel ?? {}) as RegulatedChannel;
  const color = appearance.color ?? agency.brand_color;
  // domínio próprio da agência (quando verificado) nos links que o cliente e o prospect veem
  const base = agencyBaseUrl(agency);
  const demoUrl = bot.is_demo && bot.demo_slug ? `${base}/demo/${bot.demo_slug}` : null;
  const signup = embeddedSignupConfig();
  // "+ Nova conversa" pelo WhatsApp: precisa do número conectado e de modelos aprovados
  let newChatTemplates: SendableTemplate[] | null = null;
  if (tab === "conversas" && waAllowed && !bot.is_demo) {
    const ch = await loadTemplateChannel(createAdminClient(), id);
    newChatTemplates = ch ? await listSendable(ch, { marketing: true }).catch(() => []) : null;
  }
  const embedSnippet = `<script src="${base}/widget.js" data-key="${bot.public_key}" async></script>`;

  return (
    <div className="-mx-4 -my-5 flex min-h-full flex-col sm:-mx-6 sm:-my-7 lg:-mx-9">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-panel px-4 py-3 sm:px-5 md:px-7 md:py-3.5">
        {bot.is_template ? (
          <Link href="/painel/modelos" className="text-sm font-semibold text-muted">← Modelos</Link>
        ) : bot.client_id ? (
          <Link href={`/painel/clientes/${bot.client_id}`} className="max-w-[40vw] truncate text-sm font-semibold text-muted">← {bot.client_name}</Link>
        ) : (
          <Link href={bot.is_demo ? "/painel/demos" : "/painel/clientes"} className="text-sm font-semibold text-muted">← {bot.is_demo ? "Demos" : "Clientes"}</Link>
        )}
        <span className="hidden text-line sm:inline">/</span>
        <span className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: color }}>{appearance.avatar_text ?? initials(bot.client_name)}</span>
        <span className="display min-w-0 truncate text-base font-bold sm:text-lg">{bot.name} · {bot.client_name}</span>
        <Status status={bot.is_template ? "template" : bot.is_demo ? "demo" : bot.status} />
        {canConfig && <div className="flex w-full flex-wrap gap-2 sm:ml-auto sm:w-auto">
          {demoUrl && <CopyButton text={demoUrl} label="Copiar link da demo" className="btn-ghost flex-1 sm:flex-none" />}
          {!bot.is_demo && !bot.is_template && <CopyButton text={embedSnippet} label="Copiar código" className="btn-ghost flex-1 sm:flex-none" />}
          {bot.is_template && (
            <>
              <span className={`self-center text-xs font-semibold ${unpublished ? "text-amber-ink" : "text-muted"}`}>
                {unpublished ? "Mudanças não publicadas" : currentVersion ? `Versão ${currentVersion.number} publicada` : "Ainda sem versão"}
              </span>
              <ConfirmAction
                action={publishTemplateAction.bind(null, id)}
                title="Publicar o modelo?"
                description={derivedCount ? `Afeta ${derivedCount} chatbot${derivedCount === 1 ? "" : "s"} derivado${derivedCount === 1 ? "" : "s"}: ${derivedCount === 1 ? "ele passa" : "eles passam"} a usar o rascunho atual (personalidade, instruções, assuntos, ações e roteiros). Dá para voltar a uma versão anterior na aba Herança.` : "Nenhum chatbot derivado ainda: a versão fica pronta para os próximos."}
                confirmLabel="Publicar"
                danger={false}
                className={unpublished ? "btn-primary flex-1 sm:flex-none" : "btn-ghost flex-1 sm:flex-none"}
              >
                Publicar
              </ConfirmAction>
            </>
          )}
          {!bot.is_demo && bot.status === "live" && !bot.paused_at && <BotPauseButton action={pauseBot.bind(null, id)} className="btn-ghost flex-1 sm:flex-none" />}
          {!bot.is_demo && !bot.is_template && (
            <ActionForm action={setBotStatus.bind(null, id, bot.status === "live" ? "draft" : "live")}>
              <SubmitButton pendingLabel={bot.status === "live" ? "Tirando do ar…" : "Publicando…"} className={bot.status === "live" ? "btn-ghost" : "btn-primary"} disabled={!readySources && bot.status !== "live"} title={!readySources ? "Adicione pelo menos uma fonte" : ""}>
                {bot.status === "live" ? "Tirar do ar" : "Publicar"}
              </SubmitButton>
            </ActionForm>
          )}
        </div>}
      </div>

      {bot.paused_at && (
        <div className="flex flex-wrap items-center gap-3 border-b border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger sm:px-5 md:px-7">
          <div className="min-w-0">
            <strong>A IA deste chatbot está pausada</strong> desde {relativeTime(bot.paused_at)}{bot.pause_reason ? ` · ${bot.pause_reason}` : ""}.
            <span className="block text-ink-2">
              No WhatsApp e no Instagram, as mensagens ficam em Conversas como pedido de atendente{bot.pause_notify ? " e o contato recebe o aviso uma vez" : ", sem aviso ao contato"}; no site, aparece o formulário de contato.
              {canConfig && (waAllowed || igAllowed) && <> Para cortar o canal de vez, desconecte na aba {waAllowed && <Link href={`/painel/bots/${id}?tab=whatsapp`} className="underline">WhatsApp</Link>}{waAllowed && igAllowed && " ou "}{igAllowed && <Link href={`/painel/bots/${id}?tab=instagram`} className="underline">Instagram</Link>}.</>}
            </span>
          </div>
          {canConfig && <div className="w-full sm:ml-auto sm:w-auto">
            <ActionForm action={resumeBot.bind(null, id)}>
              <SubmitButton pendingLabel="Retomando…" className="btn-primary w-full sm:w-auto">Retomar a IA</SubmitButton>
            </ActionForm>
          </div>}
        </div>
      )}

      {bot.is_demo && (
        <div className="flex flex-wrap items-center gap-3 border-b border-line bg-amber-soft px-4 py-3 text-sm sm:px-5 md:px-7">
          <span className="font-semibold text-amber-ink">Esta é uma demo.</span>
          <span className="text-ink-2">Mande o link para o prospect{bot.demo_views > 0 ? ` (aberto ${bot.demo_views} ${bot.demo_views === 1 ? "vez" : "vezes"})` : ""}. Quando ele fechar, converta em chatbot pago; a base de conhecimento fica.</span>
          <div className="w-full sm:ml-auto sm:w-auto">
            <ConvertDemo action={convertDemo.bind(null, id)} clients={clients} clientName={bot.client_name} assistantName={bot.name} />
          </div>
        </div>
      )}

      {templateName && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line bg-brand-soft px-4 py-3 text-sm text-brand sm:px-5 md:px-7">
          <span className="min-w-0">
            Este chatbot segue o modelo <Link href={`/painel/bots/${bot.template_id}?tab=heranca`} className="font-semibold underline">{templateName}</Link>: a personalidade, as instruções, as ações, os roteiros e a base comum vêm dele.
          </span>
          {canConfig && (
            <ConfirmAction
              action={detachFromTemplate.bind(null, id)}
              title="Desligar do modelo?"
              description="Este chatbot fica com uma cópia das ações, dos roteiros e da base do modelo e para de receber as mudanças dele. Não dá para ligar de novo."
              confirmLabel="Desligar do modelo"
              className="ml-auto text-xs font-semibold text-brand hover:underline"
            >
              Desligar do modelo
            </ConfirmAction>
          )}
        </div>
      )}

      {bot.transfer_review_at && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line bg-amber-soft px-4 py-3 text-sm text-amber-ink sm:px-5 md:px-7">
          <span className="min-w-0">
            <strong>Este chatbot veio de outra conta</strong> ({new Date(bot.transfer_review_at).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}). Confira antes de seguir: as ações estão desligadas, sem segredo e sem cabeçalhos (aba Ações); o destino do atendimento humano (aba Atendimento humano); o aviso de leads; o excedente, desligado; e as campanhas pausadas. O negócio precisa fazer o aceite do canal de novo para os dados irem para os seus webhooks e a sua API.
          </span>
          {canConfig && (
            <ConfirmAction action={markTransferReviewed.bind(null, id)} title="Tudo conferido?" description="A faixa sai deste chatbot. As ações continuam como estão (desligadas até você ligar cada uma)." confirmLabel="Marcar como conferido" danger={false} className="ml-auto text-xs font-semibold underline">
              Marcar como conferido
            </ConfirmAction>
          )}
        </div>
      )}

      {/* a aba Evolução (a tabela) usa a largura toda, sem o teste ao vivo */}
      <div className={`grid flex-1 ${tab === "evolucao" ? "lg:grid-cols-[200px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)]" : "lg:grid-cols-[200px_minmax(0,1fr)_360px] xl:grid-cols-[220px_minmax(0,1fr)_400px]"}`}>
        {/* no desktop as abas ficam presas no topo ao rolar; a linha divisória fica no conteúdo */}
        <nav className="flex flex-row items-center gap-1 overflow-x-auto border-b border-line px-3 py-2 [scrollbar-width:none] lg:sticky lg:top-0 lg:max-h-dvh lg:flex-col lg:items-stretch lg:self-start lg:overflow-y-auto lg:border-b-0 lg:p-3.5">
          {tabs.map(([key, label]) => (
            <Link key={key} href={`/painel/bots/${id}?tab=${key}`} className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-sm lg:py-2.5 ${tab === key ? "bg-brand-soft font-semibold text-brand" : "font-medium text-ink-2 hover:bg-ground"}`}>
              {label}
            </Link>
          ))}
          {canConfig && <div className="ml-auto shrink-0 lg:ml-0 lg:mt-3 lg:border-t lg:border-line-2 lg:pt-3">
            <ConfirmAction
              action={deleteBot.bind(null, id, bot.client_id ? `/painel/clientes/${bot.client_id}` : bot.is_demo ? "/painel/demos" : "/painel/clientes")}
              title={`Excluir ${bot.is_template ? "este modelo" : bot.is_demo ? "esta demo" : "este chatbot"}?`}
              description={
                <>
                  <strong className="text-ink">{bot.name} · {bot.client_name}</strong> será apagado com a base de conhecimento, as conversas e os leads.{bot.status === "live" ? " O balão some do site do cliente na hora, sem precisar mexer no código dele." : ""} Não tem desfazer.
                </>
              }
              confirmLabel="Excluir definitivamente"
              className="px-3 text-xs font-medium text-danger hover:underline"
            >
              Excluir {bot.is_template ? "modelo" : bot.is_demo ? "demo" : "chatbot"}
            </ConfirmAction>
          </div>}
        </nav>

        <section className="flex min-w-0 flex-col gap-5 px-4 py-5 pb-24 sm:px-5 md:px-7 md:py-6 lg:border-l lg:border-line lg:pb-6">
          {tab === "fontes" && (
            <>
              <div>
                <h2 className="text-[22px] font-bold">Base de conhecimento</h2>
                <p className="text-sm text-muted">Tudo que {bot.name} sabe vem daqui. Ele não inventa o que não está nas fontes.</p>
              </div>
              {bot.template_id && <InheritedList kind="fontes" templateId={bot.template_id} configId={bot.template_id} templateName={templateName ?? "modelo"} />}
              {bot.template_id && !opens("base") ? (
                <p className="max-w-[860px] text-sm text-muted">O modelo não libera base própria: este chatbot usa só a base do modelo.</p>
              ) : (
                <SourcesManager
                  botId={id}
                  sources={sources}
                  instagram={igAllowed && !bot.is_demo && !isTemplate ? { username: instagram?.username ?? instagram?.ig_user_id ?? null, connected: Boolean(instagram && !instagram.disconnected_at), withAi: botHasAi(bot) } : null}
                />
              )}
              {taggedSources > 0 && (
                <p className="max-w-[860px] rounded-lg bg-ground px-3 py-2 text-sm text-ink-2">
                  Mais {num(taggedSources)} fonte{taggedSources === 1 ? "" : "s"} por contexto, enviada{taggedSources === 1 ? "" : "s"} pela API: cada uma vale só nas conversas do contexto dela (o cliente do sistema, a loja). A lista e a remoção ficam na API (<Link href="/docs/api/fontes" className="underline">Fontes</Link>).
                </p>
              )}
              {!bot.is_demo && (
                <MomentNoticeCard
                  notice={activeMomentNotice(bot)}
                  lastUntil={bot.moment_notice_until}
                  author={bot.moment_notice_by === "agência" ? "pela agência" : bot.moment_notice_by ? `por ${bot.moment_notice_by}` : null}
                  defaultUntil={defaultUntilInput()}
                  save={saveMomentNotice.bind(null, id)}
                  clear={clearMomentNotice.bind(null, id)}
                />
              )}
              {sources.some((s) => s.kind === "instagram") && <PostPriceCard rule={bot.post_price_rule ?? "citar"} maxDays={bot.post_price_max_days ?? 30} save={setPostPriceRule.bind(null, id)} />}
              {!bot.is_demo && sources.some((s) => s.kind === "site" || s.kind === "page") && (
                <ActionForm key={String(bot.auto_refresh)} action={setAutoRefresh.bind(null, id)} className="flex flex-wrap items-center gap-3 text-sm">
                  <label className="flex items-center gap-2"><input type="checkbox" name="auto_refresh" defaultChecked={bot.auto_refresh !== false} /> Reler o site do cliente automaticamente toda semana</label>
                  <SubmitButton pendingLabel="Salvando…" className="text-xs font-semibold text-brand hover:underline disabled:opacity-50">Salvar</SubmitButton>
                  <span className="w-full text-xs text-muted">Se nada mudou no site, não gasta nada. Se mudou, o assistente aprende sozinho.</span>
                </ActionForm>
              )}
              {unanswered && unanswered.length > 0 && (
                <div className="flex flex-col gap-2.5 rounded-xl border border-[#efd9a9] bg-amber-soft px-[18px] py-4">
                  <div className="text-sm font-semibold text-amber-ink">{unanswered.length} pergunta{unanswered.length > 1 ? "s" : ""} que {bot.name} não soube responder</div>
                  {unanswered.map((u) => (
                    <UnansweredItem key={u.id} question={u.question} answer={answerUnanswered.bind(null, u.id, id)} dismiss={resolveUnanswered.bind(null, u.id, id)} suggestion={u.suggestion} suggestedBy={u.suggestedBy} />
                  ))}
                  <p className="text-xs text-muted">Clique em “Responder” e escreva o que o assistente deve dizer: ele aprende na hora.</p>
                </div>
              )}
              {refusals.length > 0 && (
                <details className="rounded-xl border border-line px-[18px] py-3 text-sm">
                  <summary className="cursor-pointer font-semibold">
                    {refusals.length === 1 ? "1 pedido fora do assunto" : `${refusals.length} pedidos fora do assunto`} nos últimos 30 dias
                  </summary>
                  <p className="mt-1 text-xs text-muted">
                    {bot.name} recusou porque não tem a ver com o negócio: não é falta de informação na base. Se algum for do negócio, inclua o assunto em &ldquo;Assuntos do negócio&rdquo;, na aba Personalidade.
                  </p>
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {refusals.map((r) => (
                      <li key={r.id} className="flex flex-wrap items-baseline gap-x-2">
                        <span>{r.request || "(pedido sem resumo)"}</span>
                        <span className="text-xs text-muted">
                          {r.level === "fixo" ? "regra fixa (tarefa sem relação com o negócio)" : "fora do assunto"} · {relativeTime(r.created_at)}
                          {r.conversation_id && <> · <Link href={`/painel/bots/${id}/conversas/${r.conversation_id}`} className="underline">ver conversa</Link></>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}

          {tab === "personalidade" && (
            <ActionForm key={bot.updated_at} action={updateBot.bind(null, id)} className="flex max-w-[640px] flex-col gap-4">
              <div><h2 className="text-[22px] font-bold">Personalidade</h2><p className="text-sm text-muted">Como o assistente se apresenta e fala.</p></div>
              {templateRow && <p className="rounded-lg bg-brand-soft px-3 py-2 text-xs text-brand">O tom, as instruções e os assuntos do negócio vêm do modelo {templateRow.name}. Os campos travados mudam só no modelo.</p>}
              <div><label htmlFor="name" className="label">Nome do assistente{templateRow ? (owns("nome") ? " (deste chatbot)" : " (do modelo)") : ""}</label><input id="name" name="name" required minLength={2} maxLength={40} defaultValue={bot.name} disabled={!opens("nome")} className="input disabled:opacity-60" /></div>
              {!bot.is_demo && !bot.is_template && <ClientPicker clients={clients} defaultClientId={bot.client_id} suggestedName={bot.client_id ? "" : bot.client_name} idPrefix="pers" />}
              <div><label htmlFor="client_site" className="label">Site onde o chatbot fica</label><input id="client_site" name="client_site" maxLength={200} defaultValue={bot.client_site ?? ""} className="input" /></div>
              {templateRow ? (
                <div><span className="label">Tom de voz (do modelo)</span><p className="text-sm text-ink-2">{templateRow.persona?.tone ?? "—"}</p></div>
              ) : (
                <div><label htmlFor="tone" className="label">Tom de voz</label><input id="tone" name="tone" maxLength={200} defaultValue={persona.tone ?? "amigável, direto e profissional"} className="input" /></div>
              )}
              <div><label htmlFor="welcome" className="label">Mensagem de boas-vindas{templateRow ? (owns("saudacao") ? " (deste chatbot)" : " (do modelo)") : ""}</label><input id="welcome" name="welcome" maxLength={300} defaultValue={persona.welcome ?? ""} disabled={!opens("saudacao")} className="input disabled:opacity-60" /></div>
              {templateRow ? (
                <>
                  <div><span className="label">Instruções (do modelo)</span><p className="whitespace-pre-wrap rounded-lg bg-ground px-3 py-2 text-sm text-ink-2">{templateRow.persona?.instructions?.trim() || "Nenhuma."}</p></div>
                  {opens("instrucoes") && <div><label htmlFor="extra_instructions" className="label">Instruções extras deste chatbot (somadas às do modelo)</label><textarea id="extra_instructions" name="extra_instructions" rows={4} maxLength={4000} defaultValue={bot.extra_instructions ?? ""} className="input" /></div>}
                </>
              ) : (
                <div><label htmlFor="instructions" className="label">Instruções extras (o que sempre dizer, o que nunca dizer)</label><textarea id="instructions" name="instructions" rows={5} maxLength={4000} defaultValue={persona.instructions ?? ""} className="input" placeholder="Ex.: Sempre ofereça a avaliação gratuita. Nunca prometa desconto." /></div>
              )}
              {templateRow ? (
                <div><span className="label">Assuntos do negócio (do modelo)</span><p className="text-sm text-ink-2">{templateRow.business_topics?.trim() || "Nenhum além do negócio."}</p></div>
              ) : (
              <div>
                <label htmlFor="business_topics" className="label">Assuntos do negócio (WhatsApp e Instagram)</label>
                <textarea id="business_topics" name="business_topics" rows={3} maxLength={1000} defaultValue={bot.business_topics ?? ""} className="input" placeholder="Ex.: cuidados com os dentes, dicas de escovação, como funciona o plano odontológico." />
                <p className="mt-1 text-xs text-muted">No WhatsApp e no Instagram, o assistente conversa só sobre o negócio (regra da Meta contra assistentes de uso geral). Aqui você amplia os assuntos próximos que ele pode tratar. Fazer o trabalho pela pessoa (redação, tradução, programação) ou executar o serviço que a empresa vende continua bloqueado. No chat do site não há essa trava.</p>
              </div>
              )}
              {!bot.is_demo && (
                <div className="flex flex-col gap-1.5 rounded-xl border border-line-2 p-3">
                  <input type="hidden" name="memory_form" value="1" />
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" name="contact_memory" defaultChecked={Boolean(bot.contact_memory)} disabled={Boolean(bot.sensitive_mode)} className="mt-1" />
                    <span>
                      <span className="font-semibold">Memória do contato</span>
                      <span className="block text-xs text-muted">
                        {bot.sensitive_mode
                          ? "Desligada: o modo dados sensíveis está ligado neste chatbot."
                          : "O assistente lembra de uma conversa para outra o nome que a pessoa prefere e as preferências dela (até 10 fatos curtos), só neste chatbot. Nunca guarda saúde, religião, documentos, pagamento ou endereço completo. Vale 180 dias, aparece na ficha do contato e a pessoa pode pedir para esquecer. Desligar apaga as memórias deste chatbot."}
                      </span>
                    </span>
                  </label>
                </div>
              )}
              {bot.client_id && <p className="text-xs text-muted">O nome do cliente e quanto você cobra ficam no <Link href={`/painel/clientes/${bot.client_id}?tab=dados`} className="font-semibold text-brand hover:underline">painel do cliente</Link>.</p>}
              <SubmitButton className="btn-primary self-start">Salvar</SubmitButton>
            </ActionForm>
          )}

          {templateRow && ownFields.length > 0 && (tab === "personalidade" || tab === "aparencia" || tab === "atendimento") && (
            <section className="flex max-w-[640px] flex-col gap-2 rounded-xl border border-line bg-panel px-4 py-3 text-sm">
              <span className="font-semibold">Valores próprios deste chatbot</span>
              {ownFields.map((f) => (
                <div key={f} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-ink-2">{TEMPLATE_FIELD_LABEL[f]}{opens(f) ? "" : " (travado no modelo: vale o do modelo)"}</span>
                  <ActionForm action={resetDerivedField.bind(null, id, f)}>
                    <SubmitButton className="text-xs font-semibold text-brand hover:underline" pendingLabel="Voltando…">Voltar ao modelo</SubmitButton>
                  </ActionForm>
                </div>
              ))}
            </section>
          )}

          {tab === "aparencia" && (
            <ActionForm key={bot.updated_at} action={updateBot.bind(null, id)} className="flex max-w-[640px] flex-col gap-4">
              <div><h2 className="text-[22px] font-bold">Aparência e marca</h2><p className="text-sm text-muted">O visitante vê a marca do cliente no chat e a sua agência no rodapé. A {process.env.NEXT_PUBLIC_BRAND_NAME ?? "Boavoz"} nunca aparece.</p></div>
              {!opens("aparencia") && <p className="rounded-lg bg-brand-soft px-3 py-2 text-xs text-brand">A aparência vem do modelo {templateRow?.name}: muda só lá.</p>}
              <fieldset disabled={!opens("aparencia")} className="contents">
              <div className="grid gap-4 sm:grid-cols-2">
                <div><label htmlFor="color" className="label">Cor principal</label><input id="color" name="color" type="color" defaultValue={color} className="input h-11 p-1" /></div>
                <div><label htmlFor="avatar_text" className="label">Iniciais do avatar</label><input id="avatar_text" name="avatar_text" maxLength={2} defaultValue={appearance.avatar_text ?? initials(bot.client_name)} className="input" /></div>
              </div>
              <div><label htmlFor="suggested" className="label">Perguntas sugeridas (uma por linha, até 6)</label><textarea id="suggested" name="suggested" rows={4} defaultValue={(appearance.suggested_questions ?? []).join("\n")} className="input" /></div>
              <div className="border-t border-line pt-4">
                <h3 className="text-sm font-semibold">Balão no site do cliente</h3>
                <p className="mb-3 text-xs text-muted">Vale para o widget já instalado em até um minuto; não precisa trocar o código.</p>
                <WidgetPositionPicker position={appearance.position === "left" ? "left" : "right"} offset={Number(appearance.offset ?? 20)} color={color} />
              </div>
              </fieldset>
              {opens("aparencia") && <SubmitButton className="btn-primary self-start">Salvar</SubmitButton>}
            </ActionForm>
          )}

          {tab === "leads" && (
            <ActionForm key={bot.updated_at} action={updateBot.bind(null, id)} className="flex max-w-[640px] flex-col gap-4">
              <div><h2 className="text-[22px] font-bold">Captura de leads</h2><p className="text-sm text-muted">Quando o visitante quer agendar, orçar ou falar com alguém, o assistente pede nome e contato. {leadCount ?? 0} leads até agora.</p></div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="lead_enabled" defaultChecked={leadCapture.enabled !== false} /> Ativar captura de leads na conversa</label>
              <div><label htmlFor="notify_email" className="label">Avisar por e-mail (o dono do cliente, por exemplo)</label><input id="notify_email" name="notify_email" type="email" defaultValue={leadCapture.notify_email ?? ""} className="input" placeholder="recepcao@clinicasorriso.com.br" /></div>
              <div><label htmlFor="notify_whatsapp" className="label">WhatsApp para aviso (em breve)</label><input id="notify_whatsapp" name="notify_whatsapp" defaultValue={leadCapture.notify_whatsapp ?? ""} className="input" placeholder="+55 41 9…" /></div>
              <p className="text-xs text-muted">Você também recebe todos os leads no seu e-mail e na aba Leads do painel.</p>
              <SubmitButton className="btn-primary self-start">Salvar</SubmitButton>
            </ActionForm>
          )}

          {tab === "atendimento" && (
            <ActionForm key={bot.updated_at} action={updateBot.bind(null, id)} className="flex max-w-[640px] flex-col gap-5">
              <input type="hidden" name="handoff" value="1" />
              <div>
                <h2 className="text-[22px] font-bold">Atendimento humano</h2>
                <p className="text-sm text-muted">Quem pedir para falar com uma pessoa sempre consegue: o assistente avisa a equipe e a conversa aparece em Conversas para alguém assumir. Isso não pode ser desligado (regra da Meta no WhatsApp). Aqui você só complementa, tudo opcional.</p>
              </div>

              <section className="flex flex-col gap-3">
                <h3 className="text-sm font-semibold">Outros jeitos de falar com a equipe</h3>
                <p className="-mt-2 text-xs text-muted">O assistente oferece estes contatos quando alguém pede para falar com uma pessoa.</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div><label htmlFor="handoff_phone" className="label">Telefone</label><input id="handoff_phone" name="handoff_phone" maxLength={30} defaultValue={handoff.phone ?? ""} className="input" placeholder="(21) 3333-4444" /></div>
                  <div><label htmlFor="handoff_email" className="label">E-mail</label><input id="handoff_email" name="handoff_email" type="email" maxLength={200} defaultValue={handoff.email ?? ""} className="input" placeholder="contato@clinicasorriso.com.br" /></div>
                  <div><label htmlFor="handoff_site" className="label">Site</label><input id="handoff_site" name="handoff_site" maxLength={200} defaultValue={handoff.site ?? ""} className="input" placeholder="clinicasorriso.com.br" /></div>
                  <div><label htmlFor="handoff_form_url" className="label">Formulário de atendimento (link)</label><input id="handoff_form_url" name="handoff_form_url" maxLength={300} defaultValue={handoff.form_url ?? ""} className="input" placeholder="clinicasorriso.com.br/contato" /></div>
                </div>
                <div><label htmlFor="handoff_address" className="label">Atendimento presencial (endereço)</label><input id="handoff_address" name="handoff_address" maxLength={200} defaultValue={handoff.address ?? ""} className="input" placeholder="Rua das Flores, 100, Centro, Rio de Janeiro" /></div>
                <p className="text-xs text-muted">O telefone precisa ser diferente do número do WhatsApp do assistente (exceto quando o número também está no app WhatsApp Business do celular).</p>
              </section>

              <section className="flex flex-col gap-3 border-t border-line pt-4">
                <h3 className="text-sm font-semibold">Horário de atendimento da equipe</h3>
                <p className="-mt-2 text-xs text-muted">Horário de Brasília. Fora dele, o pedido de atendente fica registrado e o assistente diz quando a equipe volta (ex.: &quot;Nossa equipe volta segunda às 9h&quot;). Deixe o dia em branco para fechado; sem nenhum horário, o assistente só diz que a equipe responde assim que possível.</p>
                <HoursFields hours={handoff.hours} />
              </section>

              <section className="flex flex-col gap-4 border-t border-line pt-4">
                <div>
                  <h3 className="text-sm font-semibold">Textos do assistente</h3>
                  <p className="text-xs text-muted">Vêm preenchidos com o padrão. Para salvar, precisam ter o que é obrigatório: o aviso de IA diz que é um assistente virtual; com horário configurado, a mensagem de fora do horário diz quando a equipe volta.</p>
                </div>
                <TemplateField
                  id="ai_notice"
                  label="Aviso de IA (começo da primeira resposta no WhatsApp e no Instagram)"
                  hint="Variáveis: {nome} (o assistente) e {empresa} (o negócio)."
                  defaultValue={handoff.ai_notice ?? DEFAULT_AI_NOTICE}
                  fallback={DEFAULT_AI_NOTICE}
                  vars={{ nome: bot.name, empresa: bot.client_name }}
                  maxLength={300}
                />
                <TemplateField
                  id="away_message"
                  label="Mensagem de fora do horário (quando pedem atendente)"
                  hint="Variável: {volta} (quando a equipe volta, pelo horário acima). No horário, ou sem horário configurado, vai o texto fixo sem data."
                  defaultValue={handoff.away_message ?? DEFAULT_AWAY_MESSAGE}
                  fallback={DEFAULT_AWAY_MESSAGE}
                  vars={{ volta: awayExample }}
                  maxLength={400}
                />
                <div className="flex flex-col gap-1 border-t border-line-2 pt-3">
                  <h4 className="text-sm font-semibold">Anúncios do atendimento humano</h4>
                  <p className="text-xs text-muted">Nunca saem como mensagem própria: viram o começo de uma mensagem. Assumir a conversa não manda nada ao contato; as mensagens seguintes de quem assumiu saem sem anúncio.</p>
                </div>
                <TemplateField
                  id="entry_notice"
                  label={`Entrada: começo da primeira mensagem de quem assumir${templateRow ? (owns("anuncio") ? " (deste chatbot)" : " (do modelo)") : ""}`}
                  hint="Variáveis: {atendente} (o nome de exibição de quem assumiu, obrigatório) e {empresa}. A prévia usa o seu nome."
                  defaultValue={handoff.entry_notice ?? DEFAULT_ENTRY_NOTICE}
                  fallback={DEFAULT_ENTRY_NOTICE}
                  vars={{ atendente: attendantOf(member).name, empresa: bot.client_name }}
                  maxLength={300}
                  disabled={!opens("anuncio")}
                />
                <TemplateField
                  id="back_notice"
                  label="Volta para a IA: começo da próxima resposta do assistente"
                  hint="Variáveis: {nome} (o assistente) e {empresa}. Precisa dizer “assistente virtual”."
                  defaultValue={handoff.back_notice ?? DEFAULT_BACK_NOTICE}
                  fallback={DEFAULT_BACK_NOTICE}
                  vars={{ nome: bot.name, empresa: bot.client_name }}
                  maxLength={300}
                />
                <div className="flex flex-col gap-2 border-t border-line-2 pt-3">
                  <h4 className="text-sm font-semibold">Assinatura das mensagens da equipe</h4>
                  <p className="text-xs text-muted">No WhatsApp e no Instagram, o contato não vê quem escreveu: a assinatura põe o nome de quem atende na mensagem. No chat do site não sai assinatura, porque o nome e a foto já aparecem em cada mensagem. A mensagem com o anúncio de entrada ou de transferência sai sem assinatura (o anúncio já diz o nome).</p>
                  <label htmlFor="signature" className="label">Formato</label>
                  <select id="signature" name="signature" defaultValue={handoff.signature ?? "nenhuma"} className="input max-w-[460px]">
                    {SIGNATURE_FORMATS.map((f) => <option key={f} value={f}>{SIGNATURE_LABEL[f]}</option>)}
                  </select>
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" name="signature_smart" defaultChecked={handoff.signature_smart !== false} className="mt-1" />
                    <span>Assinatura inteligente: o nome só na primeira mensagem de cada sequência<span className="block text-xs text-muted">Mensagens seguidas da mesma pessoa saem sem o nome, até o contato responder ou outra pessoa escrever.</span></span>
                  </label>
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" name="signature_sector" defaultChecked={Boolean(handoff.signature_sector)} className="mt-1" />
                    <span>Com o setor junto do nome (Viviane · Financeiro)<span className="block text-xs text-muted">Usa o setor da conversa (Setores, na página do cliente). Conversa sem setor: só o nome.</span></span>
                  </label>
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" name="signature_locked" defaultChecked={Boolean(handoff.signature_locked)} className="mt-1" />
                    <span>Travar o formato<span className="block text-xs text-muted">Sem travar, cada pessoa pode escolher o próprio formato em Meu perfil. Travado, vale este para todo mundo.</span></span>
                  </label>
                </div>
                <details className="rounded-lg border border-line-2 px-3 py-2 text-sm">
                  <summary className="cursor-pointer text-xs font-semibold text-muted">Textos fixos (conformidade, só para consulta)</summary>
                  <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-ink-2">
                    <li>Pedido de atendente no horário ou sem horário: &ldquo;{NO_DATE_NOTICE}&rdquo;</li>
                    <li>Assistente pausado ou modo só humano: &ldquo;{HUMAN_ONLY_NOTICE}&rdquo;</li>
                    <li>Bebida e remédio no WhatsApp e no Instagram: &ldquo;{GATE_TEXTS.ageQuestion}&rdquo;</li>
                  </ul>
                </details>
              </section>

              <section className="flex flex-col gap-2 border-t border-line pt-4">
                <h3 className="text-sm font-semibold">Chat do site</h3>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="widget_button" defaultChecked={Boolean(handoff.widget_button)} className="mt-1" />
                  <span>
                    Mostrar o botão &ldquo;Falar com uma pessoa&rdquo; no chat do site
                    <span className="block text-xs text-muted">Com um toque, o visitante pede atendente sem precisar escrever; a conversa aparece em Conversas. Sem o botão, ele ainda pode pedir escrevendo.</span>
                  </span>
                </label>
              </section>

              <section className="flex flex-col gap-3 border-t border-line pt-4">
                <h3 className="text-sm font-semibold">Chamados no chat do site</h3>
                <p className="-mt-2 text-xs text-muted">O visitante abre um chamado com nome, e-mail, a descrição e, se você quiser, o telefone e o assunto. Ele recebe um protocolo, vira lead e o pedido entra na Caixa de entrada; a resposta chega no e-mail dele. O assunto com o nome de um setor do cliente vai para esse setor.</p>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="ticket_enabled" defaultChecked={Boolean(ticketForm?.enabled)} className="mt-1" />
                  <span>Receber chamados pelo chat do site</span>
                </label>
                <fieldset className="flex flex-col gap-1.5 text-sm">
                  <legend className="label">Como aparece</legend>
                  <label className="flex items-start gap-2"><input type="radio" name="ticket_mode" value="aba" defaultChecked={ticketForm?.mode !== "sozinho"} className="mt-1" /><span>Na aba &ldquo;Abrir chamado&rdquo;, ao lado da conversa com o assistente</span></label>
                  <label className="flex items-start gap-2"><input type="radio" name="ticket_mode" value="sozinho" defaultChecked={ticketForm?.mode === "sozinho"} className="mt-1" /><span>Só o formulário de chamado (sem a conversa)</span></label>
                </fieldset>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="ticket_phone" className="label">Telefone</label>
                    <select id="ticket_phone" name="ticket_phone" defaultValue={ticketForm?.phone ?? "nao"} className="input">
                      <option value="nao">Não pedir</option>
                      <option value="opcional">Pedir, opcional</option>
                      <option value="obrigatorio">Pedir, obrigatório</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="ticket_subjects" className="label">Assuntos (um por linha, até {TICKET_SUBJECTS_MAX}; vazio: sem o campo)</label>
                    <textarea id="ticket_subjects" name="ticket_subjects" rows={4} defaultValue={(ticketForm?.subjects ?? []).join("\n")} className="input" placeholder={"Financeiro\nTroca e devolução\nOutro assunto"} />
                  </div>
                </div>
              </section>

              <section className="flex flex-col gap-3 border-t border-line pt-4">
                <h3 className="text-sm font-semibold">Bebida alcoólica e remédio: onde o cliente finaliza a compra</h3>
                <p className="-mt-2 text-xs text-muted">No WhatsApp e no Instagram, o assistente só fala desses itens com quem confirmou ter 18 anos ou mais, e a compra nunca fecha no chat: ele manda o cliente para um destes caminhos, nesta ordem. Não vale link de WhatsApp nem de mensagem direta. Tudo em branco: o assistente usa o que estiver nas fontes.</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div><label htmlFor="regulated_site" className="label">Link do site (item ou cardápio)</label><input id="regulated_site" name="regulated_site" maxLength={300} defaultValue={regulated.site ?? ""} className="input" placeholder="bardoze.com.br/cardapio" /></div>
                  <div><label htmlFor="regulated_app" className="label">Link do app de delivery</label><input id="regulated_app" name="regulated_app" maxLength={300} defaultValue={regulated.app ?? ""} className="input" placeholder="ifood.com.br/delivery/…" /></div>
                  <div><label htmlFor="regulated_phone" className="label">Telefone para pedidos (ligação)</label><input id="regulated_phone" name="regulated_phone" maxLength={30} defaultValue={regulated.phone ?? ""} className="input" placeholder="(21) 3333-4444" /></div>
                </div>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="regulated_pickup" defaultChecked={Boolean(regulated.pickup)} /> Retirada no local (usa o endereço de Atendimento presencial)</label>
              </section>
              <SubmitButton className="btn-primary self-start">Salvar</SubmitButton>
            </ActionForm>
          )}
          {tab === "atendimento" && !bot.is_demo && (
            <SatisfactionCard on={Boolean(bot.satisfaction_survey)} summary={await satisfactionSummary(createAdminClient(), [id], daysAgoIso(30))} save={setSatisfactionSurvey.bind(null, id)} />
          )}

          {tab === "heranca" && isTemplate && (
            <TemplateInheritance
              templateId={id}
              unlocked={unlockedFields(bot)}
              derived={derivedList}
              clients={clients}
              manage={canConfig && member.scope === "all" && packs.includes("plataforma")}
              saveUnlocked={setTemplateUnlockedAction.bind(null, id)}
              createDerived={createDerivedAction.bind(null, id)}
              versions={versions}
              currentVersionId={bot.published_bot_id ?? null}
              restoreVersion={restoreVersionAction.bind(null, id)}
            />
          )}

          {tab === "evolucao" && (
            <section className="flex flex-col gap-4">
              <div>
                <h2 className="text-[22px] font-bold">Evolução</h2>
                <p className="max-w-[720px] text-sm text-muted">Os últimos 6 meses deste chatbot: quanto o assistente resolveu sem a equipe, quanto foi para a equipe, quanto tempo a equipe levou para assumir quem pediu atendimento (a mediana) e a satisfação de quem respondeu à pesquisa.{bot.client_id && !bot.is_demo ? " O cliente vê a mesma tabela no relatório, com os chatbots dele somados." : ""}</p>
              </div>
              <EvolutionTable months={await botEvolution(createAdminClient(), [id])} />
            </section>
          )}

          {tab === "conversas" && (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h2 className="text-[22px] font-bold">Conversas</h2><p className="text-sm text-muted">Últimas 30. Abra uma conversa para assumir e responder como pessoa da equipe.</p></div>
                {newChatTemplates && (
                  <details className="group w-full sm:w-auto">
                    <summary className="btn-primary cursor-pointer list-none [&::-webkit-details-marker]:hidden">+ Nova conversa</summary>
                    <div className="card mt-2 flex flex-col gap-3 p-4 sm:w-[420px]">
                      <p className="text-sm text-muted">Comece a falar com alguém pelo WhatsApp. A primeira mensagem precisa ser um modelo aprovado; quando a pessoa responder, {bot.name} (ou você) continua a conversa.</p>
                      <TemplateSender templates={newChatTemplates} action={startWhatsAppConversation.bind(null, id)} askPhone submitLabel="Enviar e abrir conversa" />
                    </div>
                  </details>
                )}
              </div>
              <div className="card overflow-hidden">
                {(conversations ?? []).length === 0 && <p className="p-5 text-sm text-muted">Nenhuma conversa ainda.</p>}
                {(conversations ?? []).map((c) => (
                  <Link key={c.id} href={`/painel/bots/${id}/conversas/${c.id}`} className="flex items-center gap-3 border-b border-line-2 px-4 py-3 text-sm last:border-0 hover:bg-ground">
                    <span className="text-muted">{relativeTime(c.started_at)}</span>
                    <span className="font-medium">{c.message_count} mensagens</span>
                    <span className="text-xs text-muted">{c.channel}</span>
                    <ConversationStateBadge conv={c} />
                    {handoffStatus(c) ? <HandoffBadge conv={c} className="ml-auto" /> : c.needs_human ? <span className="ml-auto text-xs text-muted">precisou de ajuda</span> : null}
                  </Link>
                ))}
              </div>
            </>
          )}

          {tab === "whatsapp" && (
            <div className="flex max-w-[640px] flex-col gap-4">
              <div>
                <h2 className="text-[22px] font-bold">WhatsApp</h2>
                <p className="text-sm text-muted">{bot.name} responde no WhatsApp do cliente com a mesma base de conhecimento. Pedidos de atendente aparecem em Conversas, e a sua resposta sai pelo WhatsApp.</p>
              </div>
              {bot.is_demo ? (
                <p className="rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink">Converta a demo em chatbot para ligar o WhatsApp.</p>
              ) : whatsapp?.disconnected_at ? (
                <div className="flex flex-col gap-4 rounded-xl border border-[#efd9a9] bg-amber-soft p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-amber-ink">desconectado</span>
                    <span className="display text-lg font-bold">{whatsapp.display_phone ?? whatsapp.phone_number_id}</span>
                  </div>
                  <p className="text-sm text-amber-ink">
                    Desconectado {relativeTime(whatsapp.disconnected_at)}{whatsapp.disconnect_reason ? `: ${whatsapp.disconnect_reason}` : ""}. {bot.name} parou de responder por este número. As conversas antigas continuam no painel.
                  </p>
                  <p className="text-sm text-amber-ink"><strong>Próximo passo:</strong> {disconnectNextStep(whatsapp.disconnect_reason, Boolean(whatsapp.coexistence))}</p>
                  {signup && (
                    <div className="flex flex-col gap-3">
                      <ConnectLinkButton action={createWhatsAppConnectLink.bind(null, id)} clientName={bot.client_name} />
                      <ChannelAcceptGate botId={id} clientId={bot.client_id} clientName={bot.client_name} agencyName={agency.name} channel="whatsapp">
                        <WhatsAppConnect appId={signup.appId} configId={signup.configId} graphVersion={signup.graphVersion} action={completeWhatsAppSignup.bind(null, id)} coexistence={Boolean(whatsapp.coexistence)} label="Conectar de novo agora" primary={false} />
                      </ChannelAcceptGate>
                    </div>
                  )}
                  <ConfirmAction
                    action={disconnectWhatsApp.bind(null, id)}
                    title="Remover este número?"
                    description="O número sai do chatbot e você pode conectar outro. As conversas antigas continuam no painel."
                    confirmLabel="Remover"
                    className="self-start text-xs font-medium text-danger hover:underline"
                  >
                    Remover número
                  </ConfirmAction>
                </div>
              ) : whatsapp ? (
                <>
                  <div className="card flex flex-col gap-3 p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-semibold text-brand">conectado</span>
                      {whatsapp.coexistence && <span className="rounded-full bg-ground px-2.5 py-0.5 text-xs font-semibold text-muted">também no app do celular</span>}
                      <span className="display text-lg font-bold">{whatsapp.display_phone ?? whatsapp.phone_number_id}</span>
                      {whatsapp.verified_name && <span className="text-sm text-muted">· {whatsapp.verified_name}</span>}
                    </div>
                    <p className="text-sm text-ink-2">Ligado {relativeTime(whatsapp.created_at)}. {bot.status === "live" ? "Mande uma mensagem para este número para testar." : "O chatbot não está publicado: ele só responde no WhatsApp depois de clicar em “Publicar” no topo."}</p>
                    <WhatsAppDiagnostics botId={id} />
                    <ChannelAcceptGate botId={id} clientId={bot.client_id} clientName={bot.client_name} agencyName={agency.name} channel="whatsapp" connected />
                    <ConfirmAction
                      action={disconnectWhatsApp.bind(null, id)}
                      title="Desconectar o WhatsApp?"
                      description={<>O assistente para de responder pelo número <strong className="text-ink">{whatsapp.display_phone ?? whatsapp.phone_number_id}</strong>. As conversas antigas continuam no painel.</>}
                      confirmLabel="Desconectar"
                      className="self-start text-xs font-medium text-danger hover:underline"
                    >
                      Desconectar
                    </ConfirmAction>
                  </div>
                  <MarketingOptInForm botId={id} on={Boolean(bot.marketing_optin_offer)} company={bot.client_name} canEdit={canConfig} action={setMarketingOptIn.bind(null, id)} />
                  <WhatsAppUsage botId={id} />
                  <WhatsAppTemplates botId={id} />
                </>
              ) : (
                <div className="card flex flex-col gap-4 p-5">
                  {signup ? (
                    <>
                      <div className="flex flex-col gap-2 rounded-xl border border-[#cfe3d8] bg-brand-soft p-4">
                        <div className="text-sm font-semibold">Mande um link para o cliente conectar</div>
                        <p className="text-sm text-ink-2">Quem conecta é o dono do WhatsApp, com o Facebook dele. O link abre uma página com a sua marca, explica o passo a passo e o cadastro do cartão na Meta. Não precisa de conta nem de senha.</p>
                        <ConnectLinkButton action={createWhatsAppConnectLink.bind(null, id)} clientName={bot.client_name} />
                      </div>
                      <p className="pt-1 text-xs font-semibold uppercase tracking-[0.06em] text-muted">Ou conecte agora, com o cliente do lado</p>
                      <ConnectChecklist />
                      <ChannelAcceptGate botId={id} clientId={bot.client_id} clientName={bot.client_name} agencyName={agency.name} channel="whatsapp">
                      <div className="flex flex-col gap-2 rounded-xl border border-line p-4">
                        <div className="text-sm font-semibold">Já atende pelo WhatsApp Business no celular</div>
                        <p className="text-sm text-ink-2">O número continua funcionando no app do celular. {bot.name} responde as mensagens; quando alguém da equipe responde pelo celular, a resposta aparece em Conversas e {bot.name} fica quieto naquela conversa por 1 hora.</p>
                        <CoexistenceConnect appId={signup.appId} configId={signup.configId} graphVersion={signup.graphVersion} action={completeWhatsAppSignup.bind(null, id)} label="Conectar o WhatsApp Business do celular" variant={esVariantOf(sp.es)} />
                        <p className="text-xs text-muted">No celular, abra o WhatsApp Business atualizado e aceite quando a Meta pedir para compartilhar contatos e histórico.</p>
                      </div>
                      <div className="flex flex-col gap-2 rounded-xl border border-line p-4">
                        <div className="text-sm font-semibold">Número novo, só para o atendimento</div>
                        <p className="text-sm text-ink-2">Um número que não está em nenhum WhatsApp. Ele passa a funcionar só pela API, sem app no celular.</p>
                        <WhatsAppConnect appId={signup.appId} configId={signup.configId} graphVersion={signup.graphVersion} action={completeWhatsAppSignup.bind(null, id)} label="Conectar número novo" primary={false} />
                      </div>
                      </ChannelAcceptGate>
                    </>
                  ) : (
                    <p className="text-sm text-muted">O botão de conexão aparece quando META_APP_ID e WHATSAPP_CONFIG_ID estiverem configurados.</p>
                  )}
                  <details className="border-t border-line-2 pt-3 text-sm">
                    <summary className="cursor-pointer text-xs font-semibold text-muted">Ligar pelo ID (número de teste do app)</summary>
                    {/* sem o cadastro da Meta configurado (ex.: dev com o número de teste), o aceite fica aqui */}
                    <div className="mt-3">
                      {signup ? (
                          <ActionForm action={connectWhatsApp.bind(null, id)} className="flex flex-col gap-4">
                            <div><label htmlFor="phone_number_id" className="label">Phone number ID</label><input id="phone_number_id" name="phone_number_id" required inputMode="numeric" className="input" placeholder="1234567890123456" /></div>
                            <div><label htmlFor="waba_id" className="label">WhatsApp Business Account ID (opcional)</label><input id="waba_id" name="waba_id" inputMode="numeric" className="input" /></div>
                            <p className="text-xs text-muted">Os dois aparecem no app da Meta, em WhatsApp › Configuração da API. Usa o token do servidor (WHATSAPP_TOKEN).</p>
                            <SubmitButton pendingLabel="Conferindo com a Meta…" className="btn-ghost self-start">Ligar pelo ID</SubmitButton>
                          </ActionForm>
                      ) : (
                        <ChannelAcceptGate botId={id} clientId={bot.client_id} clientName={bot.client_name} agencyName={agency.name} channel="whatsapp">
                            <ActionForm action={connectWhatsApp.bind(null, id)} className="flex flex-col gap-4">
                              <div><label htmlFor="phone_number_id" className="label">Phone number ID</label><input id="phone_number_id" name="phone_number_id" required inputMode="numeric" className="input" placeholder="1234567890123456" /></div>
                              <div><label htmlFor="waba_id" className="label">WhatsApp Business Account ID (opcional)</label><input id="waba_id" name="waba_id" inputMode="numeric" className="input" /></div>
                              <p className="text-xs text-muted">Os dois aparecem no app da Meta, em WhatsApp › Configuração da API. Usa o token do servidor (WHATSAPP_TOKEN).</p>
                              <SubmitButton pendingLabel="Conferindo com a Meta…" className="btn-ghost self-start">Ligar pelo ID</SubmitButton>
                            </ActionForm>
                        </ChannelAcceptGate>
                      )}
                    </div>
                  </details>
                </div>
              )}
              {!bot.is_demo && <FailedSends botId={id} channel="whatsapp" />}
            </div>
          )}

          {tab === "instagram" && (
            <div className="flex max-w-[640px] flex-col gap-4">
              <div>
                <h2 className="text-[22px] font-bold">Instagram</h2>
                <p className="text-sm text-muted">{bot.name} responde as mensagens diretas do Instagram do cliente com a mesma base de conhecimento. As mensagens do Instagram não são cobradas pela Meta.</p>
              </div>
              {sp.ig === "ok" && <p className="rounded-lg bg-brand-soft px-3 py-2 text-sm text-brand">Instagram conectado. Mande uma DM para a conta para testar.</p>}
              {typeof sp.ig_erro === "string" && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{sp.ig_erro}</p>}
              {bot.is_demo ? (
                <p className="rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink">Converta a demo em chatbot para ligar o Instagram.</p>
              ) : instagram && !instagram.disconnected_at ? (
                <div className="card flex flex-col gap-3 p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-semibold text-brand">conectado</span>
                    <span className="display text-lg font-bold">@{instagram.username ?? instagram.ig_user_id}</span>
                  </div>
                  {igRenamed && (
                    <p className="rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink">
                      A conta mudou o nome no Instagram, de @{igRenamed.from} para @{igRenamed.to} (o BoaVoz percebeu a troca {relativeTime(igRenamed.at)}). O nome e os links com origem abaixo já estão atualizados; os links com o nome antigo (na bio, no QR impresso, nos anúncios) não abrem mais o direct: troque pelos novos.
                    </p>
                  )}
                  <p className="text-sm text-ink-2">Ligado {relativeTime(instagram.created_at)}. {bot.status === "live" ? "Mande uma DM para a conta para testar." : "O chatbot não está publicado: ele só responde no Instagram depois de clicar em “Publicar” no topo."}</p>
                  <ChannelAcceptGate botId={id} clientId={bot.client_id} clientName={bot.client_name} agencyName={agency.name} channel="instagram" connected />
                  <p className="text-xs text-muted">Se o assistente não responder, confira no Instagram da conta: Configurações → Mensagens e respostas a stories → Ferramentas conectadas → “Permitir acesso às mensagens”. O acesso é renovado sozinho a cada 60 dias.</p>
                  <ConfirmAction
                    action={disconnectInstagram.bind(null, id)}
                    title="Desconectar o Instagram?"
                    description={<>O assistente para de responder as mensagens de <strong className="text-ink">@{instagram.username ?? instagram.ig_user_id}</strong>. As conversas antigas continuam no painel.</>}
                    confirmLabel="Desconectar"
                    className="self-start text-xs font-medium text-danger hover:underline"
                  >
                    Desconectar
                  </ConfirmAction>
                </div>
              ) : (
                <div className="card flex flex-col gap-4 p-5">
                  {instagram?.disconnected_at && (
                    <p className="rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink">@{instagram.username ?? instagram.ig_user_id} foi desconectado {relativeTime(instagram.disconnected_at)}{instagram.disconnect_reason ? `: ${instagram.disconnect_reason}` : ""}. Conecte de novo abaixo.</p>
                  )}
                  <div className="flex flex-col gap-1.5 text-sm text-ink-2">
                    <div className="font-semibold text-ink">Antes de conectar, a conta precisa:</div>
                    <ul className="ml-5 list-disc space-y-0.5">
                      <li>ser uma <strong>conta profissional</strong> (Empresa ou Criador);</li>
                      <li>ter ligado <strong>“Permitir acesso às mensagens”</strong> em Configurações → Mensagens e respostas a stories → Ferramentas conectadas.</li>
                    </ul>
                  </div>
                  <div className="flex flex-col gap-2 rounded-xl border border-[#cfe3d8] bg-brand-soft p-4">
                    <div className="text-sm font-semibold">Mande um link para o cliente conectar</div>
                    <p className="text-sm text-ink-2">Quem conecta é o dono da conta, com o login do Instagram dele. O link abre uma página com a sua marca e o passo a passo. Não precisa de conta nem de senha no painel.</p>
                    <ConnectLinkButton action={createWhatsAppConnectLink.bind(null, id, "instagram")} clientName={bot.client_name} channelName="Instagram" />
                  </div>
                  <p className="pt-1 text-xs font-semibold uppercase tracking-[0.06em] text-muted">Ou conecte agora, com o login da conta</p>
                  <ChannelAcceptGate botId={id} clientId={bot.client_id} clientName={bot.client_name} agencyName={agency.name} channel="instagram">
                    <a href={`/api/instagram/connect?bot=${id}`} className="btn-ghost self-start">Conectar Instagram</a>
                  </ChannelAcceptGate>
                </div>
              )}
              {!bot.is_demo && (
                <>
                  <IceBreakersCard questions={iceBreakersOf(bot)} syncedAt={bot.ig_ice_breakers_synced_at ?? null} error={bot.ig_ice_breakers_error ?? null} connected={Boolean(instagram && !instagram.disconnected_at)} save={saveIceBreakers.bind(null, id)} />
                  <RefLinksCard username={instagram?.username ?? null} links={refLinks} hasIceBreakers={iceBreakersOf(bot).length > 0} add={addRefLink.bind(null, id)} remove={removeRefLink.bind(null, id)} />
                  <KeywordsCard keywords={keywords} commentsOn={commentsOn} posts={postChoices} save={saveKeyword.bind(null, id)} remove={removeKeyword.bind(null, id)} />
                  <InstagramCommentsCard enabled={commentsOn} comments={comments} posts={postsById} ai={{ mode: bot.ig_comments_ai ?? "off", mediaIds: bot.ig_comments_ai_media_ids ?? null, posts: postChoices, withAi: botHasAi(bot), save: saveCommentsAi.bind(null, id) }} />
                </>
              )}
              {!bot.is_demo && <FailedSends botId={id} channel="instagram" />}
            </div>
          )}

          {tab === "roteiros" && (bot.template_id ? <InheritedList kind="roteiros" templateId={bot.template_id} configId={bot.config_bot_id ?? bot.template_id} templateName={templateName ?? "modelo"} /> : <BotRoutines botId={id} integrations={integrations} />)}

          {tab === "acoes" &&
            (bot.is_demo ? (
              <p className="card p-5 text-sm text-muted">Demonstrações não têm ações: converta a demo em chatbot de um cliente para ligar o sistema dele.</p>
            ) : (
              <>
                {/* o teto das chamadas de ação batido (itens menores da conferência de 20/10, parte 2) */}
                {actionCapNotice(bot) && <p className="mb-4 max-w-[860px] rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{actionCapNotice(bot)}</p>}
                {!integrations && (
                  <p className="mb-4 max-w-[860px] rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink">
                    Você pode cadastrar as ações e conferir cada uma pelo botão Testar. A IA só usa as ações na conversa com o pacote Integrações (<Link href="/painel/cobranca" className="underline">Cobrança → Assinatura</Link>).
                  </p>
                )}
                {bot.template_id ? (
                  <InheritedList kind="acoes" templateId={bot.template_id} configId={bot.config_bot_id ?? bot.template_id} templateName={templateName ?? "modelo"} />
                ) : (
                  <BotActions bot={{ id, action_secret_enc: bot.action_secret_enc ?? null, action_secret_prev_until: bot.action_secret_prev_until ?? null }} manage={manageActions} />
                )}
                {!isTemplate && <FixedContextCard value={bot.fixed_context} display={bot.fixed_display} manage={manageActions} save={saveFixedContext.bind(null, id)} />}
              </>
            ))}

          {tab === "instalacao" && (
            <div className="flex max-w-[860px] flex-col gap-5">
              <div>
                <h2 className="text-[22px] font-bold">Instalação</h2>
                <p className="text-sm text-muted">Escolha onde o site do cliente foi feito e siga o passo a passo. O código é o mesmo em todo lugar; o que muda é onde colar.</p>
              </div>
              {bot.status !== "live" && !bot.is_demo && <p className="rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink">O chatbot ainda não está publicado. Você pode instalar agora: o balão fica invisível no site do cliente até você clicar em “Publicar” no topo.</p>}
              <InstallGuide
                widgetSrc={`${base}/widget.js`}
                publicKey={bot.public_key}
                directLink={`${base}/w/${bot.public_key}`}
                brand={process.env.NEXT_PUBLIC_BRAND_NAME ?? "Boavoz"}
                isLive={bot.status === "live"}
                installed={bot.installed_at && bot.installed_host ? { host: bot.installed_host, at: bot.installed_at, lastSeen: bot.last_seen_at ?? null } : null}
              />
            </div>
          )}
        </section>

        {tab !== "evolucao" && <aside className="hidden border-l border-line bg-[#ecebe4] p-5 lg:block">
          {/* o fundo ocupa a coluna inteira; o chat de teste acompanha a rolagem */}
          <div className="sticky top-5 flex flex-col gap-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold uppercase tracking-[0.06em] text-muted">Teste ao vivo</span>
              <span className="text-muted">{freeLinked(owner) ? FREE_LINKED_SHORT : owner.billing_status === "none" ? `conta grátis: ${num(Math.max(0, TEST_ANSWERS_FREE - (owner.test_answers_used ?? 0)))} de ${TEST_ANSWERS_FREE} respostas` : "como o visitante vê"}</span>
            </div>
            {readySources ? (
              // com roteiro em andamento no teste, a faixa do passo atual fica em cima do chat
              <LiveTest botId={bot.id} hasRoutines={hasLiveRoutines} chatClassName="h-[560px] overflow-hidden rounded-2xl shadow-[0_12px_32px_rgba(27,31,29,0.12)]" bot={{ key: bot.public_key, name: bot.name, clientName: bot.client_name, color, avatarText: appearance.avatar_text ?? initials(bot.client_name), welcome: persona.welcome ?? `Olá! Sou ${bot.name}. Como posso ajudar?`, suggestedQuestions: appearance.suggested_questions ?? [], poweredBy: agency.name, privacyUrl: agency.privacy_url, handoffButton: Boolean(handoff.widget_button) }}
              />
            ) : (
              <div className="h-[560px] overflow-hidden rounded-2xl shadow-[0_12px_32px_rgba(27,31,29,0.12)]">
                <div className="flex h-full items-center justify-center bg-white p-6 text-center text-sm text-muted">Adicione uma fonte para testar o assistente.</div>
              </div>
            )}
          </div>
        </aside>}

        {/* abaixo de lg o teste ao vivo abre por um botão flutuante */}
        <ChatPreviewSheet disabledReason={!readySources ? "Adicione uma fonte para testar o assistente." : null}>
          <LiveTest botId={bot.id} hasRoutines={hasLiveRoutines} className="h-full gap-0" chatClassName="min-h-0 flex-1" bot={{ key: bot.public_key, name: bot.name, clientName: bot.client_name, color, avatarText: appearance.avatar_text ?? initials(bot.client_name), welcome: persona.welcome ?? `Olá! Sou ${bot.name}. Como posso ajudar?`, suggestedQuestions: appearance.suggested_questions ?? [], poweredBy: agency.name, privacyUrl: agency.privacy_url, handoffButton: Boolean(handoff.widget_button) }}
          />
        </ChatPreviewSheet>
      </div>
    </div>
  );
}
