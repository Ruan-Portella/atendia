import { contactDisplayName, contactName as contactNameOf } from "@/lib/contacts";
import { agentReactionsFor, quotesOf } from "@/lib/message-links";
import { needsPhone } from "@/lib/handoff";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { initials, relativeTime } from "@/lib/utils";
import { ConversationThread, withNotes, type ThreadMessage } from "@/components/conversation-thread";
import { ConversationTools } from "@/components/conversation-tools";
import { listNotes } from "@/lib/conversation-notes";
import { transferOptions } from "@/lib/transfer";
import { listQuickReplies } from "@/lib/quick-replies";
import { isSnoozed } from "@/lib/snooze";
import { TicketStatusControl } from "@/components/ticket-status-control";
import { HandoffReply, HandoffStatus, holderView } from "@/components/handoff-controls";
import { leadWaiting } from "@/lib/handoff-status";
import { ConversationMenu } from "@/components/conversation-menu";
import { EarlierConversations } from "@/components/earlier-conversations";
import { ContactToggle } from "@/components/contact-pane";
import { ArrowLeft } from "lucide-react";
import { ConversationStateBadge } from "@/components/conversation-state";
import { ConversationLive } from "@/components/conversation-live";
import { conversationState, whatsappWindowOpen, humanAgentEnabled, humanAgentUntil, timeLeft } from "@/lib/presence";
import { requireAgency } from "@/lib/agency";
import { attendantOf, can } from "@/lib/team";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadMessages } from "@/lib/messages";
import { leadsOfConversation } from "@/lib/leads";
import { requireAgencyMfa } from "@/lib/agency-mfa";
import { attachmentsOfMessages } from "@/lib/attachments";
import { regulatedConversation } from "@/lib/gate/payment";
import { RegulatedNotice } from "@/components/regulated-notice";
import { channelBlock } from "@/lib/features";
import { lastContactMessageAt } from "@/lib/whatsapp-inbound";
import { authorLabel } from "@/lib/authors";
import { firstExceeded } from "@/lib/rate-limit";
import { loadTemplateChannel, type SendableTemplate, conversationTemplates, ensureResumeTemplate, type ResumeStatus } from "@/lib/whatsapp-templates";
import { TemplateModalButton } from "@/components/template-modal-button";
import { MessageScroller } from "@/components/message-scroller";
import { addConversationNote, deleteConversation, forceTakeOverConversation, reactToMessage, releaseConversation, requestContactPhone, requestGateReview, resetConversationAge, resumeConversationAiFromPanel, sendAgentMessage, sendConversationTemplate, setTicketStatusAction, snoozeConversationAction, takeOverConversation, transferConversationAction, unsnoozeConversationAction } from "@/app/painel/actions";
import { botGateExemptions, conversationGateCategories } from "@/lib/gate/exceptions";
import { CATEGORIES } from "@/lib/gate/rules";
import { GateReviewButton } from "@/components/gate-review-button";
import { ageRecord } from "@/lib/gate/age";
import { CONSENT_LABEL, SOURCE_LABEL, consentHistory, consentStateOf } from "@/lib/marketing-consent";
import { suppressionScope } from "@/lib/suppression";
import { accountLabel, loadConversationIdentity } from "@/lib/routine-identity";
import { runBandText, type RunSummary } from "@/lib/routine-run";

/**
 * Os roteiros da conversa numa etiqueta só (redesenho): o que está em andamento (ou o último) e,
 * no "+N", os anteriores.
 */
function RoutineChips({ runs }: { runs: RunSummary[] }) {
  const main = runs.find((r) => r.status === "active") ?? runs[0];
  const rest = runs.filter((r) => r !== main);
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <span title={runBandText(main)} className={`max-w-[min(260px,62vw)] truncate rounded-full px-2 py-0.5 sm:max-w-none ${main.status === "active" ? "bg-brand-soft font-medium text-brand" : "bg-raised text-ink-2"}`}>Roteiro · {runBandText(main)}</span>
      {rest.length > 0 && (
        <details className="relative">
          <summary className="cursor-pointer list-none rounded-full bg-raised px-2 py-0.5 font-mono text-[11px] text-muted hover:text-ink [&::-webkit-details-marker]:hidden" title="Os roteiros anteriores desta conversa">+{rest.length}</summary>
          <div className="menu-in absolute left-0 top-full z-30 mt-1.5 flex w-[min(320px,80vw)] flex-col gap-1 rounded-[14px] border border-line bg-panel p-2 shadow-[inset_0_1px_0_var(--highlight),var(--shadow-pop)]">
            <span className="px-1.5 pb-0.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted">Roteiros anteriores</span>
            {rest.map((r, k) => <span key={k} className="rounded-[9px] px-1.5 py-1 text-[12.5px] text-ink-2">{runBandText(r)}</span>)}
          </div>
        </details>
      )}
    </span>
  );
}

const CHANNEL_LABEL: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram", widget: "Site", painel: "Teste", demo: "Demo" };

/**
 * A conversa no painel da agência: a página da conversa e o lado direito da Caixa de entrada
 * (embedded: preenche a coluna, com o link para abrir em tela cheia; `back` é para onde o segundo
 * fator volta).
 */
export async function AgencyConversation({ botId: id, convId: cid, embedded = false, back, earlier = 0, earlierHref, mobileBack, contactToggle = false }: { botId: string; convId: string; embedded?: boolean; back?: string; /** a volta para a fila no celular (seta no topo) */ mobileBack?: string; /** o botão "Contato" (o painel do contato da Caixa) */ contactToggle?: boolean; /** quantas conversas anteriores da pessoa mostrar em cima (?ant=) */ earlier?: number; earlierHref?: (n: number) => string }) {
  const supabase = await createClient();
  const { data: conv } = await supabase
    .from("conversations")
    .select("id, started_at, last_message_at, visitor_seen_at, channel, wa_id, ig_id, contact_id, needs_human, handoff_requested_at, lead_waiting_at, takeover_at, handled_at, assigned_to_id, assigned_to_name, ai_paused_until, regulated_at, identity_hash, context_display, context_since, origin_label, last_contact_at, snoozed_until, snoozed_at, ticket_protocol, ticket_status, ticket_subject, bots(name, client_id, client_name, sensitive_mode, appearance, face)")
    .eq("id", cid)
    .eq("bot_id", id)
    .maybeSingle();
  if (!conv) {
    if (embedded) return <p className="p-6 text-sm text-muted">Conversa não encontrada.</p>;
    notFound();
  }
  // chatbot em modo dados sensíveis: a conversa pede o segundo fator (cadastro na hora, na primeira vez)
  const sensitive = Boolean((Array.isArray(conv.bots) ? conv.bots[0] : conv.bots)?.sensitive_mode);
  if (sensitive) await requireAgencyMfa(back ?? `/painel/bots/${id}/conversas/${cid}`);
  const isWhatsApp = conv.channel === "whatsapp" && Boolean(conv.wa_id);
  const [messages, leads, { agency, role, member }] = await Promise.all([
    loadMessages(supabase, { conversationId: cid }, ["id", "role", "content", "sources", "tool_results", "author", "author_type", "author_id", "author_display_name", "announce_chars", "components_enc", "photo_reading_enc", "created_at", "blocked_reason", "failed_at", "error_code", "edited_at", "deleted_at", "channel_ref", "reply_to_id", "channel_msg_ref_enc", "contact_reaction", "agent_reaction"] as const),
    leadsOfConversation(supabase, cid),
    requireAgency(),
  ]);
  const bot = (Array.isArray(conv.bots) ? conv.bots[0] : conv.bots) as { name: string; client_id: string | null; client_name: string; appearance: { color?: string | null } | null; face: unknown } | null;
  const takeOver = takeOverConversation.bind(null, cid);
  const visitorMsgs = (messages ?? []).filter((m) => m.role === "user");
  // no WhatsApp a janela de 24 h conta da última mensagem do contato, em qualquer conversa com
  // ele (é por número); aberta por nós com modelo e sem resposta, ela nem abriu
  const isInstagram = conv.channel === "instagram" && Boolean(conv.ig_id);
  const lastUserAt = isWhatsApp ? await lastContactMessageAt(supabase, id, { waId: conv.wa_id! }, conv.contact_id) : isInstagram ? await lastContactMessageAt(supabase, id, { igsid: conv.ig_id! }, conv.contact_id) : undefined;
  const handoffConv = isWhatsApp || isInstagram ? { ...conv, last_user_at: lastUserAt } : conv;
  const windowOpen = isWhatsApp && whatsappWindowOpen(handoffConv);
  // Instagram depois das 24 h: quanto falta para a equipe ainda responder (tag human_agent, até 7 dias)
  const humanAgentDate = isInstagram ? humanAgentUntil(handoffConv) : null;
  const humanAgentLeft = humanAgentDate ? timeLeft(humanAgentDate) : null;
  const humanAgentAt = humanAgentDate ? humanAgentDate.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : null;

  // modelos aprovados, para retomar a conversa (só com o WhatsApp liberado para a agência)
  let templates: SendableTemplate[] | null = null;
  let resume: ResumeStatus | null = null;
  if (isWhatsApp && !(await channelBlock(createAdminClient(), agency.id, "whatsapp"))) {
    const ch = await loadTemplateChannel(createAdminClient(), id);
    // o modelo de retomada vem primeiro; conta antiga sem ele: o BoaVoz cria agora (análise da Meta)
    const loaded = ch ? await conversationTemplates(ch, { marketing: true }).catch(() => ({ templates: [] as SendableTemplate[], resume: null })) : null;
    templates = loaded?.templates ?? null;
    resume = loaded?.resume ?? null;
    // (uma tentativa por dia por chatbot: se a Meta recusar a criação, não insiste a cada página)
    if (ch && resume === "ausente" && bot && !(await firstExceeded(createAdminClient(), [{ key: `modelo-retomada:${id}`, max: 1, windowSeconds: 86_400, message: "" }]))) resume = await ensureResumeTemplate(ch, bot.client_name);
  }
  const contactName = leads[0]?.name ?? "";
  // pessoa identificada pela empresa (token do site ou pareamento, P2) e o contexto da conversa
  const identifiedName = conv.identity_hash && conv.contact_id ? await contactDisplayName(supabase, conv.contact_id) : null;
  // pessoa identificada pelo roteiro (B2', parte 2c; tabela interna: service role), com a conta escolhida
  const routineId = conv.identity_hash ? null : (await loadConversationIdentity(createAdminClient(), cid)).state;
  const routineAccount = routineId && routineId.active !== null ? accountLabel(routineId.accounts[routineId.active], routineId.active) : null;
  // roteiros desta conversa (tabela interna: service role): o aberto e os últimos que acabaram
  const { data: runRows } = await createAdminClient().from("routine_runs").select("routine_name, status, end_reason, step_index, steps_total").eq("conversation_id", cid).order("started_at", { ascending: false }).limit(5);
  const runs = (runRows ?? []) as RunSummary[];
  const routineIdentity = routineId ? ` · identificado pelo roteiro${routineId.name ? `: ${routineId.name}` : ""}${routineAccount ? ` · conta: ${routineAccount}` : routineId.accounts.length > 1 ? " · escolhendo a conta" : ""}${routineId.remembered ? " · número lembrado" : ""}` : "";
  // resposta de 18+ do contato neste bot (tabela interna: lida com a service role)
  const age = isWhatsApp || isInstagram ? await ageRecord(createAdminClient(), { botId: id, channel: isWhatsApp ? "whatsapp" : "instagram", contact: (isWhatsApp ? conv.wa_id : conv.ig_id)! }) : null;
  // novidades (leva B3): o último sim ou não do contato, com a prova (tabela interna: service role)
  const consent = isWhatsApp ? await (async () => {
    const { data: wa } = await createAdminClient().from("whatsapp_channels").select("waba_id").eq("bot_id", id).maybeSingle();
    const rows = await consentHistory(createAdminClient(), { scope: suppressionScope({ wabaId: (wa?.waba_id as string | null) ?? null, botId: id }), contact: conv.wa_id! }, 1).catch(() => []);
    return rows[0] ? { state: consentStateOf(rows), row: rows[0] } : null;
  })() : null;

  // arquivos que o contato mandou (abertos pela rota /api/files)
  const files = await attachmentsOfMessages(createAdminClient(), (messages ?? []).map((m) => m.id));
  // a mensagem citada (Conversa mais natural): o trecho em cima da resposta
  const quotes = await quotesOf(supabase, (messages ?? []).map((m) => m.reply_to_id));
  // notas internas e transferências (Caixa de entrada, parte 4; tabela interna: service role), no meio das mensagens
  const notes = await listNotes(createAdminClient(), cid).catch(() => []);
  const allMessages = withNotes((messages ?? []).map(({ channel_msg_ref_enc, ...m }) => ({ ...m, attachments: files.get(m.id), quote: m.reply_to_id ? (quotes.get(m.reply_to_id) ?? null) : null, linkable: Boolean(channel_msg_ref_enc) })) as ThreadMessage[], notes);
  // transferir, adiar e respostas prontas (Caixa de entrada, parte 4)
  const handoffOpen = !conv.handled_at && Boolean(conv.takeover_at || conv.handoff_requested_at);
  const [options, quickReplies, nameForReplies] = await Promise.all([
    handoffOpen ? transferOptions(createAdminClient(), { agencyId: agency.id, clientId: bot?.client_id ?? null, meId: member.id }) : Promise.resolve({ sectors: [], people: [] }),
    listQuickReplies(createAdminClient(), bot?.client_id),
    contactNameOf(createAdminClient(), conv.contact_id).then((n) => n ?? (contactName || null)),
  ]);
  const heldByAnother = !conv.handled_at && Boolean(conv.takeover_at) && Boolean(conv.assigned_to_id) && conv.assigned_to_id !== member.id;
  // quem conversa pelo nome de usuário (o número não aparece): "Pedir o telefone", dentro das 24 h
  const askPhone = isWhatsApp && whatsappWindowOpen(handoffConv) && (await needsPhone(createAdminClient(), conv));
  // citar e reagir (Conversa mais natural, parte 2): quem está com a conversa; reagir, dentro das 24 h
  const threadActions = (isWhatsApp || isInstagram) && holderView(handoffConv, member.id) === "mine" ? { onReact: whatsappWindowOpen(handoffConv) ? reactToMessage.bind(null, cid) : null, reactions: agentReactionsFor(conv.channel as string) } : null;
  const snoozedUntil = isSnoozed(conv) ? (conv.snoozed_until as string) : null;
  // conversa com bebida ou remédio (portão): faixa de aviso e pergunta antes de instrução de pagamento
  const regulated = (isWhatsApp || isInstagram) && regulatedConversation(conv.regulated_at as string | null);
  // itens que o portão acusou nesta conversa: a agência pode pedir "isto não é {categoria}"
  const gateCats = isWhatsApp || isInstagram ? await conversationGateCategories(createAdminClient(), cid, await botGateExemptions(createAdminClient(), id)) : [];
  const { data: openReviews } = gateCats.length ? await createAdminClient().from("gate_review_requests").select("category").eq("bot_id", id).eq("status", "pendente") : { data: [] as Array<{ category: string }> };
  const reviewing = new Set((openReviews ?? []).map((r) => r.category as string));
  const coexistence = regulated && isWhatsApp ? Boolean((await createAdminClient().from("whatsapp_channels").select("coexistence").eq("bot_id", id).maybeSingle()).data?.coexistence) : false;
  const templateAction = sendConversationTemplate.bind(null, cid);
  // quem é (redesenho, etapa 2): o nome no cabeçalho e em cima das mensagens do contato
  const who = nameForReplies || identifiedName || (conv.channel === "widget" ? "Visitante do site" : "Contato");

  // Tela de chat: ocupa a tela toda (a barra do celular tem 60 px; a faixa de avisos do painel,
  // quando há, mede --panel-notices-h), cabeçalho e resposta fixos, e só as mensagens rolam.
  return (
    <div className={embedded ? "flex h-full min-h-0 flex-col" : "-mx-4 -my-5 flex h-[calc(100dvh-60px-var(--panel-notices-h,0px))] min-h-0 flex-col sm:-mx-6 sm:-my-7 lg:-mx-9 lg:h-[calc(100dvh-var(--panel-notices-h,0px))]"}>
      <header className="flex flex-col gap-2 border-b border-line bg-panel px-3 py-2.5 sm:px-5 sm:py-3 md:px-6">
        <div className="flex items-start gap-2 sm:gap-3">
          {mobileBack && (
            <Link href={mobileBack} aria-label="Voltar para a fila" title="Voltar para a fila" className="btn-icon -ml-1 h-9 w-9 shrink-0 lg:hidden">
              <ArrowLeft size={18} />
            </Link>
          )}
          <span className="mt-0.5 hidden h-10 w-10 shrink-0 items-center justify-center rounded-full bg-raised text-[13px] font-semibold text-ink shadow-[inset_0_0_0_1px_var(--color-line)] sm:flex">{initials(who) || "?"}</span>
          <div className="min-w-0 flex-1">
            {!embedded && <Link href={`/painel/bots/${id}?tab=conversas`} className="text-xs font-medium text-muted hover:text-ink">← Conversas{bot ? ` de ${bot.name}` : ""}</Link>}
            <h1 className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[17px] font-normal leading-tight sm:text-lg">
              <span className="min-w-0 max-w-full truncate">{who}</span>
              <span className="rounded-md px-1.5 py-0.5 text-[11.5px] font-medium text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line-strong)]">{CHANNEL_LABEL[conv.channel as string] ?? conv.channel}</span>
              <ConversationStateBadge conv={conv} withTime />
              {sensitive && <span className="rounded-full bg-amber-soft px-2 py-0.5 text-xs font-medium text-amber-ink">dados sensíveis</span>}
            </h1>
            <p className="mt-0.5 hidden text-[12.5px] text-muted line-clamp-2 sm:block">{bot ? bot.name : "Conversa"}{bot?.client_id ? <> · <Link href={`/painel/clientes/${bot.client_id}`} className="hover:text-ink">{bot.client_name}</Link></> : null} · começou {relativeTime(conv.started_at)}{conv.origin_label ? ` · veio pelo link “${conv.origin_label}”` : ""}{conv.identity_hash ? ` · identificado pela empresa${identifiedName ? `: ${identifiedName}` : ""}` : ""}{routineIdentity}{conv.context_display ? ` · contexto: ${conv.context_display}` : ""}{leadWaiting(conv) && !conv.handled_at ? " · deixou pedido para a equipe" : conv.needs_human ? " · pediu atendente" : ""}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {templates && <TemplateModalButton templates={templates} action={templateAction} defaults={[contactName]} highlight={!windowOpen} />}
            {contactToggle && <ContactToggle />}
            <ConversationMenu
              fullHref={embedded ? `/painel/bots/${id}/conversas/${cid}` : null}
              resetAge={age ? { action: resetConversationAge.bind(null, cid), description: `${age.source === "empresa" ? `A empresa informou pela API que o contato ${age.status === "sim" ? "tem 18 anos ou mais" : "não tem 18 anos"}${age.origin ? ` (${age.origin})` : ""}` : `O contato ${age.status === "sim" ? "confirmou ter 18 anos ou mais" : "disse que não tem 18 anos"}`} (${relativeTime(age.decidedAt)}). Zerando, na próxima vez que pedir bebida ou remédio o assistente pergunta de novo.` } : null}
              remove={can(role, "config") ? deleteConversation.bind(null, cid) : null}
            />
          </div>
        </div>
        {/* o resto fica numa linha de etiquetas pequenas (redesenho): novidades, 18+, roteiros, chamado e portão */}
        {(consent || age || runs.length > 0 || conv.ticket_protocol || gateCats.length > 0) && (
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[12px] sm:pl-[52px]">
            {consent && (
              <span
                className={`rounded-full px-2 py-0.5 font-medium ${consent.state === "granted" ? "bg-brand-soft text-brand" : "bg-raised text-muted"}`}
                title={`${SOURCE_LABEL[consent.row.source]}, ${new Date(consent.row.revoked_at ?? consent.row.collected_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}: ${consent.row.text}`}
              >
                Novidades: {CONSENT_LABEL[consent.state]}
              </span>
            )}
            {age && <span className="rounded-full bg-raised px-2 py-0.5 text-ink-2" title="Para zerar, use o … no canto">18+: {age.status === "sim" ? "sim" : "não"}</span>}
            {runs.length > 0 && <RoutineChips runs={runs} />}
            {conv.ticket_protocol && <TicketStatusControl protocol={conv.ticket_protocol as string} subject={(conv.ticket_subject as string | null) ?? null} status={(conv.ticket_status as string | null) ?? "aberto"} action={setTicketStatusAction.bind(null, cid)} />}
            {gateCats.length > 0 && (
              <span className="inline-flex flex-wrap items-center gap-1.5 text-muted">
                Portão:
                {gateCats.map((c) => (
                  <span key={c} className="inline-flex items-center gap-1.5 rounded-full bg-raised px-2 py-0.5 text-ink-2">
                    {CATEGORIES[c].label} ·{" "}
                    {reviewing.has(c) ? <span className="font-medium">revisão pedida</span> : <GateReviewButton label={CATEGORIES[c].label} action={requestGateReview.bind(null, cid, c)} />}
                  </span>
                ))}
              </span>
            )}
          </div>
        )}
      </header>

      <ConversationLive live={conversationState(conv) !== "closed"} handoffOpen={!conv.handled_at && Boolean(conv.takeover_at || conv.handoff_requested_at)} visitorMessages={visitorMsgs.length} lastVisitorText={visitorMsgs.at(-1)?.content ?? ""} />

      <MessageScroller count={allMessages.length} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[860px] flex-col gap-4 px-4 py-5 sm:px-5 md:px-7">
          {/* as conversas anteriores da mesma pessoa, em cima (uma conversa só, como no WhatsApp) */}
          <EarlierConversations
            db={supabase}
            admin={createAdminClient()}
            contactId={(conv.contact_id as string | null) ?? null}
            current={{ id: cid, startedAt: conv.started_at as string }}
            show={earlier}
            moreHref={earlierHref ?? ((n) => `/painel/bots/${id}/conversas/${cid}?ant=${n}`)}
            agentLabel={(m) => authorLabel(m, { view: "agency", meId: member.id })}
            contactName={who}
            bot={bot ? { name: bot.name, color: bot.appearance?.color ?? null, face: bot.face } : null}
            showTrace
          />
          <ConversationThread
            messages={allMessages}
            leads={leads.map((l) => ({ ...l, requests: l.requests.filter((r) => r.conversation_id === cid) }))}
            showSources
            channel={conv.channel as string}
            actions={threadActions}
            contextChange={conv.context_since ? { at: conv.context_since as string, label: conv.context_display ? `contexto: ${conv.context_display as string}` : "sem conta conectada" } : null}
            agentLabel={(m) => authorLabel(m, { view: "agency", meId: member.id })}
            contactName={who}
            bot={bot ? { name: bot.name, color: bot.appearance?.color ?? null, face: bot.face } : null}
            showTrace
          />
        </div>
      </MessageScroller>

      <footer className="border-t border-line bg-ground">
        <div className="mx-auto flex max-w-[860px] flex-col gap-2 px-4 py-3 sm:px-5 md:px-7">
          {isInstagram && !whatsappWindowOpen(handoffConv) && (humanAgentLeft ? (
            <p className="rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink">
              <strong>Passaram 24 h desde a última mensagem do contato.</strong> O assistente não responde mais, mas a equipe ainda pode responder por {humanAgentLeft} (até {humanAgentAt}; atendimento humano no Instagram vale até 7 dias).
            </p>
          ) : (
            <p className="rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink">
              <strong>{lastUserAt === null ? "O contato ainda não mandou mensagem." : humanAgentEnabled() ? "Passaram 7 dias desde a última mensagem do contato." : "Passaram 24 h desde a última mensagem do contato."}</strong> O Instagram só deixa responder dentro desse prazo. Quando ele escrever de novo, a conversa continua aqui.
            </p>
          ))}
          {templates && !windowOpen && (
            <p className="rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink">
              {lastUserAt === null ? <strong>Aguardando a resposta do contato.</strong> : <strong>Passaram 24 h desde a última mensagem do contato.</strong>}{" "}
              {lastUserAt === null ? "Até ele responder, o WhatsApp só deixa enviar modelos aprovados" : "O WhatsApp só deixa retomar com um modelo aprovado"}: use “Enviar modelo” no topo{resume === "aprovado" ? " (o primeiro é o de retomada)" : ""}. Quando ele responder, a conversa continua aqui.
              {resume === "em_analise" && <span className="mt-1 block text-xs">O modelo padrão de retomada ainda está em análise na Meta; costuma sair em minutos.</span>}
              {(resume === "recusado" || resume === "reclassificado") && <span className="mt-1 block text-xs">A Meta {resume === "recusado" ? "recusou" : "mudou a categoria d"}o modelo padrão de retomada. Use outro modelo de utilidade aprovado (aba WhatsApp do chatbot).</span>}
            </p>
          )}
          {regulated && <RegulatedNotice channel={conv.channel as string} coexistence={coexistence} />}
          <HandoffStatus conv={handoffConv} onTakeOver={takeOver} onResumeAi={resumeConversationAiFromPanel.bind(null, cid)} meId={member.id} />
          <HandoffReply conv={handoffConv} meId={member.id} onTakeOver={takeOver} onForceTakeOver={forceTakeOverConversation.bind(null, cid)} onSend={sendAgentMessage.bind(null, cid)} onRelease={releaseConversation.bind(null, cid)} docked paymentCheck={regulated} quickReplies={quickReplies} contactName={nameForReplies} attendantName={attendantOf(member).name} onRequestPhone={askPhone ? requestContactPhone.bind(null, cid) : undefined} />
          <ConversationTools
            canTransfer={handoffOpen && !heldByAnother}
            canSnooze={handoffOpen && conv.assigned_to_id === member.id}
            snoozedUntil={handoffOpen ? snoozedUntil : null}
            options={options}
            onTransfer={transferConversationAction.bind(null, cid)}
            onNote={addConversationNote.bind(null, cid)}
            onSnooze={snoozeConversationAction.bind(null, cid)}
            onUnsnooze={unsnoozeConversationAction.bind(null, cid)}
          />
        </div>
      </footer>
    </div>
  );
}
