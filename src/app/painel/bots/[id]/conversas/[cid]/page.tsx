import { contactDisplayName } from "@/lib/contacts";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { relativeTime } from "@/lib/utils";
import { ConversationThread, type ThreadMessage } from "@/components/conversation-thread";
import { HandoffReply, HandoffStatus } from "@/components/handoff-controls";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { ConversationStateBadge } from "@/components/conversation-state";
import { ConversationLive } from "@/components/conversation-live";
import { conversationState, whatsappWindowOpen, humanAgentEnabled, humanAgentUntil, timeLeft } from "@/lib/presence";
import { requireAgency } from "@/lib/agency";
import { can } from "@/lib/team";
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
import { deleteConversation, forceTakeOverConversation, releaseConversation, requestGateReview, resetConversationAge, sendAgentMessage, sendConversationTemplate, takeOverConversation } from "@/app/painel/actions";
import { botGateExemptions, conversationGateCategories } from "@/lib/gate/exceptions";
import { CATEGORIES } from "@/lib/gate/rules";
import { GateReviewButton } from "@/components/gate-review-button";
import { ageRecord } from "@/lib/gate/age";
import { CONSENT_LABEL, SOURCE_LABEL, consentHistory, consentStateOf } from "@/lib/marketing-consent";
import { suppressionScope } from "@/lib/suppression";

export const metadata = { title: "Conversa" };

export default async function ConversationPage({ params }: PageProps<"/painel/bots/[id]/conversas/[cid]">) {
  const { id, cid } = await params;
  const supabase = await createClient();
  const { data: conv } = await supabase
    .from("conversations")
    .select("id, started_at, last_message_at, visitor_seen_at, channel, wa_id, ig_id, contact_id, needs_human, handoff_requested_at, takeover_at, handled_at, assigned_to_id, assigned_to_name, regulated_at, identity_hash, context_display, context_since, bots(name, client_id, client_name, sensitive_mode)")
    .eq("id", cid)
    .eq("bot_id", id)
    .maybeSingle();
  if (!conv) notFound();
  // chatbot em modo dados sensíveis: a conversa pede o segundo fator (cadastro na hora, na primeira vez)
  const sensitive = Boolean((Array.isArray(conv.bots) ? conv.bots[0] : conv.bots)?.sensitive_mode);
  if (sensitive) await requireAgencyMfa(`/painel/bots/${id}/conversas/${cid}`);
  const isWhatsApp = conv.channel === "whatsapp" && Boolean(conv.wa_id);
  const [messages, leads, { agency, role, member }] = await Promise.all([
    loadMessages(supabase, { conversationId: cid }, ["id", "role", "content", "sources", "author", "author_type", "author_id", "author_display_name", "announce_chars", "components_enc", "created_at", "blocked_reason", "failed_at", "error_code", "edited_at", "deleted_at", "channel_ref"] as const),
    leadsOfConversation(supabase, cid),
    requireAgency(),
  ]);
  const bot = (Array.isArray(conv.bots) ? conv.bots[0] : conv.bots) as { name: string; client_id: string | null; client_name: string } | null;
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
  if (isWhatsApp && !(await channelBlock(createAdminClient(), agency.id, "whatsapp", undefined, { botId: id }))) {
    const ch = await loadTemplateChannel(createAdminClient(), id);
    // o modelo de retomada vem primeiro; conta antiga sem ele: o BoaVoz cria agora (análise da Meta)
    const loaded = ch ? await conversationTemplates(ch).catch(() => ({ templates: [] as SendableTemplate[], resume: null })) : null;
    templates = loaded?.templates ?? null;
    resume = loaded?.resume ?? null;
    // (uma tentativa por dia por chatbot: se a Meta recusar a criação, não insiste a cada página)
    if (ch && resume === "ausente" && bot && !(await firstExceeded(createAdminClient(), [{ key: `modelo-retomada:${id}`, max: 1, windowSeconds: 86_400, message: "" }]))) resume = await ensureResumeTemplate(ch, bot.client_name);
  }
  const contactName = leads[0]?.name ?? "";
  // pessoa identificada pela empresa (token do site ou pareamento, P2) e o contexto da conversa
  const identifiedName = conv.identity_hash && conv.contact_id ? await contactDisplayName(supabase, conv.contact_id) : null;
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
  const allMessages = (messages ?? []).map((m) => ({ ...m, attachments: files.get(m.id) })) as ThreadMessage[];
  // conversa com bebida ou remédio (portão): faixa de aviso e pergunta antes de instrução de pagamento
  const regulated = (isWhatsApp || isInstagram) && regulatedConversation(conv.regulated_at as string | null);
  // itens que o portão acusou nesta conversa: a agência pode pedir "isto não é {categoria}"
  const gateCats = isWhatsApp || isInstagram ? await conversationGateCategories(createAdminClient(), cid, await botGateExemptions(createAdminClient(), id)) : [];
  const { data: openReviews } = gateCats.length ? await createAdminClient().from("gate_review_requests").select("category").eq("bot_id", id).eq("status", "pendente") : { data: [] as Array<{ category: string }> };
  const reviewing = new Set((openReviews ?? []).map((r) => r.category as string));
  const coexistence = regulated && isWhatsApp ? Boolean((await createAdminClient().from("whatsapp_channels").select("coexistence").eq("bot_id", id).maybeSingle()).data?.coexistence) : false;
  const templateAction = sendConversationTemplate.bind(null, cid);

  // Tela de chat: ocupa a tela toda (a barra do celular tem 60 px; a faixa de avisos do painel,
  // quando há, mede --panel-notices-h), cabeçalho e resposta fixos, e só as mensagens rolam.
  return (
    <div className="-mx-4 -my-5 flex h-[calc(100dvh-60px-var(--panel-notices-h,0px))] min-h-0 flex-col sm:-mx-6 sm:-my-7 lg:-mx-9 lg:h-[calc(100dvh-var(--panel-notices-h,0px))]">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-panel px-4 py-3 sm:px-5 md:px-7">
        <div className="min-w-0 flex-1">
          <Link href={`/painel/bots/${id}?tab=conversas`} className="text-xs font-semibold text-muted">← Conversas{bot ? ` de ${bot.name}` : ""}</Link>
          <h1 className="flex flex-wrap items-center gap-2.5 text-lg font-bold sm:text-xl">Conversa {relativeTime(conv.started_at)} <ConversationStateBadge conv={conv} withTime />{sensitive && <span className="rounded-full bg-amber-soft px-2 py-0.5 text-xs font-semibold text-amber-ink">dados sensíveis</span>}</h1>
          <p className="text-xs text-muted">canal: {conv.channel}{conv.identity_hash ? ` · identificado pela empresa${identifiedName ? `: ${identifiedName}` : ""}` : ""}{conv.context_display ? ` · contexto: ${conv.context_display}` : ""}{conv.needs_human ? " · pediu atendente" : ""}{bot?.client_id ? <> · <Link href={`/painel/clientes/${bot.client_id}`} className="hover:underline">{bot.client_name}</Link></> : null}</p>
          {gateCats.length > 0 && (
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
              <span>O portão acusou:</span>
              {gateCats.map((c) => (
                <span key={c} className="inline-flex items-center gap-1.5 rounded-full bg-ground px-2 py-0.5">
                  {CATEGORIES[c].label} ·{" "}
                  {reviewing.has(c) ? <span className="font-semibold">revisão pedida</span> : <GateReviewButton label={CATEGORIES[c].label} action={requestGateReview.bind(null, cid, c)} />}
                </span>
              ))}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {templates && <TemplateModalButton templates={templates} action={templateAction} defaults={[contactName]} highlight={!windowOpen} />}
          {consent && (
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${consent.state === "granted" ? "bg-brand-soft text-brand" : "bg-ground text-muted"}`}
              title={`${SOURCE_LABEL[consent.row.source]}, ${new Date(consent.row.revoked_at ?? consent.row.collected_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}: ${consent.row.text}`}
            >
              Novidades: {CONSENT_LABEL[consent.state]}
            </span>
          )}
          {age && (
            <ConfirmAction
              action={resetConversationAge.bind(null, cid)}
              title="Zerar a confirmação de 18+?"
              description={`${age.source === "empresa" ? `A empresa informou pela API que o contato ${age.status === "sim" ? "tem 18 anos ou mais" : "não tem 18 anos"}${age.origin ? ` (${age.origin})` : ""}` : `O contato ${age.status === "sim" ? "confirmou ter 18 anos ou mais" : "disse que não tem 18 anos"}`} (${relativeTime(age.decidedAt)}). Zerando, na próxima vez que pedir bebida ou remédio o assistente pergunta de novo.`}
              confirmLabel="Zerar 18+"
              danger={false}
              className="btn-ghost"
            >
              18+: {age.status === "sim" ? "sim" : "não"} · zerar
            </ConfirmAction>
          )}
          {can(role, "config") && <ConfirmAction
            action={deleteConversation.bind(null, cid)}
            title="Excluir esta conversa?"
            description="As mensagens e os contatos capturados nela são apagados de vez (ex.: a pessoa pediu para apagar os dados dela). Não tem desfazer."
            confirmLabel="Excluir conversa"
            className="btn-ghost text-danger"
          >
            <Trash2 size={15} />
            Excluir
          </ConfirmAction>}
        </div>
      </header>

      <ConversationLive live={conversationState(conv) !== "closed"} handoffOpen={!conv.handled_at && Boolean(conv.takeover_at || conv.handoff_requested_at)} visitorMessages={visitorMsgs.length} lastVisitorText={visitorMsgs.at(-1)?.content ?? ""} />

      <MessageScroller count={allMessages.length} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[860px] flex-col gap-4 px-4 py-5 sm:px-5 md:px-7">
          <ConversationThread
            messages={allMessages}
            leads={leads}
            showSources
            contextChange={conv.context_since ? { at: conv.context_since as string, label: conv.context_display ? `contexto: ${conv.context_display as string}` : "sem conta conectada" } : null}
            agentLabel={(m) => authorLabel(m, { view: "agency", meId: member.id })}
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
          <HandoffStatus conv={handoffConv} onTakeOver={takeOver} meId={member.id} />
          <HandoffReply conv={handoffConv} meId={member.id} onTakeOver={takeOver} onForceTakeOver={forceTakeOverConversation.bind(null, cid)} onSend={sendAgentMessage.bind(null, cid)} onRelease={releaseConversation.bind(null, cid)} docked paymentCheck={regulated} />
        </div>
      </footer>
    </div>
  );
}
