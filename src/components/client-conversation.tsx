import Link from "next/link";
import { notFound } from "next/navigation";
import { memberAttendant, requireMember, requireMemberMfa } from "@/lib/member";
import { ConversationThread, withNotes, type ThreadMessage } from "@/components/conversation-thread";
import { EarlierConversations } from "@/components/earlier-conversations";
import { ConversationTools } from "@/components/conversation-tools";
import { listNotes } from "@/lib/conversation-notes";
import { transferOptions } from "@/lib/transfer";
import { listQuickReplies } from "@/lib/quick-replies";
import { isSnoozed } from "@/lib/snooze";
import { TICKET_STATUS_LABEL, type TicketStatus } from "@/lib/tickets";
import { TicketStatusControl } from "@/components/ticket-status-control";
import { contactName } from "@/lib/contacts";
import { HandoffReply, HandoffStatus, holderView } from "@/components/handoff-controls";
import { ConversationStateBadge } from "@/components/conversation-state";
import { ConversationLive } from "@/components/conversation-live";
import { MessageScroller } from "@/components/message-scroller";
import { conversationState, whatsappWindowOpen } from "@/lib/presence";
import { loadMessages } from "@/lib/messages";
import { leadsOfConversation } from "@/lib/leads";
import { attachmentsOfMessages } from "@/lib/attachments";
import { agentReactionsFor, quotesOf } from "@/lib/message-links";
import { needsPhone } from "@/lib/handoff";
import { regulatedConversation } from "@/lib/gate/payment";
import { RegulatedNotice } from "@/components/regulated-notice";
import { lastContactMessageAt } from "@/lib/whatsapp-inbound";
import { authorLabel } from "@/lib/authors";
import { memberAddNote, memberSetTicketStatus, memberForceTakeOver, memberReact, memberRelease, memberRequestPhone, memberResumeAi, memberSend, memberSnooze, memberTakeOver, memberTransfer, memberUnsnooze } from "@/app/cliente/actions";

/** O chatbot da conversa (redesenho): o nome e a cor nas respostas da IA. */
function botOf(rel: unknown): { name: string; color: string | null } | null {
  const b = (Array.isArray(rel) ? rel[0] : rel) as { name?: string; appearance?: { color?: string | null } | null } | null;
  return b?.name ? { name: b.name, color: b.appearance?.color ?? null } : null;
}

/**
 * A conversa na área do cliente: a página da conversa e o lado direito da Caixa de entrada do portal
 * (embedded: preenche a coluna; `back` é para onde o segundo fator volta).
 */
export async function ClientConversation({ clientId: id, convId: cid, embedded = false, back, earlier = 0, earlierHref }: { clientId: string; convId: string; embedded?: boolean; back?: string; /** quantas conversas anteriores da pessoa mostrar em cima (?ant=) */ earlier?: number; earlierHref?: (n: number) => string }) {
  const { email, member, admin, botIds } = await requireMember(id);
  const { data: conv } = await admin
    .from("conversations")
    .select("id, bot_id, started_at, last_message_at, visitor_seen_at, channel, wa_id, ig_id, contact_id, handoff_requested_at, lead_waiting_at, takeover_at, handled_at, assigned_to_id, assigned_to_name, ai_paused_until, regulated_at, last_contact_at, snoozed_until, snoozed_at, ticket_protocol, ticket_status, ticket_subject, bots(sensitive_mode, name, appearance)")
    .eq("id", cid)
    .in("bot_id", botIds.length ? botIds : ["00000000-0000-0000-0000-000000000000"])
    .maybeSingle();
  if (!conv) {
    if (embedded) return <p className="p-6 text-sm text-muted">Conversa não encontrada.</p>;
    notFound();
  }
  // chatbot em modo dados sensíveis: a conversa pede o segundo fator, como no painel (leva B1')
  const sensitive = Boolean((Array.isArray(conv.bots) ? conv.bots[0] : conv.bots)?.sensitive_mode);
  if (sensitive) await requireMemberMfa(id, back ?? `/cliente/${id}/conversas/${cid}`);
  const [messages, leads] = await Promise.all([
    loadMessages(admin, { conversationId: cid }, ["id", "role", "content", "author", "author_type", "author_id", "author_display_name", "announce_chars", "components_enc", "photo_reading_enc", "created_at", "blocked_reason", "failed_at", "error_code", "edited_at", "deleted_at", "channel_ref", "reply_to_id", "channel_msg_ref_enc", "contact_reaction", "agent_reaction"] as const),
    leadsOfConversation(admin, cid),
  ]);
  const agencyName = member.agency.name;
  const takeOver = memberTakeOver.bind(null, id, cid);
  // arquivos que o contato mandou (abertos pela rota /api/files)
  const files = await attachmentsOfMessages(admin, (messages ?? []).map((m) => m.id));
  // a mensagem citada (Conversa mais natural): o trecho em cima da resposta
  const quotes = await quotesOf(admin, (messages ?? []).map((m) => m.reply_to_id));
  // notas internas e transferências (Caixa de entrada, parte 4): só para quem atende
  const notes = member.allowHandoff ? await listNotes(admin, cid).catch(() => []) : [];
  const allMessages = withNotes((messages ?? []).map(({ channel_msg_ref_enc, ...m }) => ({ ...m, attachments: files.get(m.id), quote: m.reply_to_id ? (quotes.get(m.reply_to_id) ?? null) : null, linkable: Boolean(channel_msg_ref_enc) })) as ThreadMessage[], notes);
  const visitorMsgs = (messages ?? []).filter((m) => m.role === "user");
  const handoffOpen = member.allowHandoff && !conv.handled_at && Boolean(conv.takeover_at || conv.handoff_requested_at);
  // no WhatsApp a janela de 24 h conta da última mensagem do contato, em qualquer conversa com ele
  const contact = conv.channel === "whatsapp" && conv.wa_id ? { waId: conv.wa_id } : conv.channel === "instagram" && conv.ig_id ? { igsid: conv.ig_id } : null;
  const handoffConv = contact ? { ...conv, last_user_at: await lastContactMessageAt(admin, conv.bot_id, contact, conv.contact_id) } : conv;
  // conversa com bebida ou remédio (portão): faixa de aviso e pergunta antes de instrução de pagamento
  const regulated = Boolean(contact) && regulatedConversation(conv.regulated_at as string | null);
  // transferir, adiar e respostas prontas (Caixa de entrada, parte 4)
  const me = memberAttendant(member, email);
  const [options, quickReplies, nameForReplies] = member.allowHandoff
    ? await Promise.all([
        handoffOpen ? transferOptions(admin, { agencyId: member.agencyId, clientId: id, meId: member.memberId }) : Promise.resolve({ sectors: [], people: [] }),
        listQuickReplies(admin, id),
        contactName(admin, conv.contact_id).then((n) => n ?? leads[0]?.name ?? null),
      ])
    : [{ sectors: [], people: [] }, [], null];
  const heldByAnother = !conv.handled_at && Boolean(conv.takeover_at) && Boolean(conv.assigned_to_id) && conv.assigned_to_id !== member.memberId;
  // quem conversa pelo nome de usuário (o número não aparece): "Pedir o telefone", dentro das 24 h
  const askPhone = member.allowHandoff && conv.channel === "whatsapp" && whatsappWindowOpen(handoffConv) && (await needsPhone(admin, conv));
  // citar e reagir (Conversa mais natural, parte 2): quem está com a conversa; reagir, dentro das 24 h
  const threadActions = contact && member.allowHandoff && holderView(handoffConv, member.memberId) === "mine" ? { onReact: whatsappWindowOpen(handoffConv) ? memberReact.bind(null, id, cid) : null, reactions: agentReactionsFor(conv.channel as string) } : null;
  const snoozedUntil = isSnoozed(conv) ? (conv.snoozed_until as string) : null;
  const coexistence = regulated && conv.channel === "whatsapp" ? Boolean((await admin.from("whatsapp_channels").select("coexistence").eq("bot_id", conv.bot_id).maybeSingle()).data?.coexistence) : false;

  // Tela de chat: preenche o espaço abaixo das abas (a casca do portal rola só o conteúdo);
  // cabeçalho e resposta fixos, e só as mensagens rolam.
  return (
    <div className={embedded ? "flex h-full min-h-0 flex-col px-4 sm:px-6" : "-my-6 flex min-h-0 flex-1 flex-col sm:-my-8"}>
      <header className="border-b border-line py-3">
        {embedded ? (
          <Link href={`/cliente/${id}/conversas/${cid}`} className="text-xs font-semibold text-muted hover:underline">Abrir em tela cheia</Link>
        ) : (
          <Link href={`/cliente/${id}/conversas`} className="text-xs font-semibold text-muted">← Conversas</Link>
        )}
        <h1 className="flex flex-wrap items-center gap-2.5 text-lg font-normal sm:text-xl">Conversa <ConversationStateBadge conv={conv} withTime /></h1>
        <p className="text-xs text-muted">{new Date(conv.started_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "long", timeStyle: "short" })}{conv.channel === "whatsapp" ? " · WhatsApp" : conv.channel === "instagram" ? " · Instagram" : ""}</p>
        {conv.ticket_protocol && (member.allowHandoff ? (
          <TicketStatusControl protocol={conv.ticket_protocol as string} subject={(conv.ticket_subject as string | null) ?? null} status={(conv.ticket_status as string | null) ?? "aberto"} action={memberSetTicketStatus.bind(null, id, cid)} />
        ) : (
          <p className="text-xs font-semibold text-brand">Chamado <span className="font-mono">{conv.ticket_protocol as string}</span>{conv.ticket_subject ? ` · ${conv.ticket_subject as string}` : ""} · {TICKET_STATUS_LABEL[(conv.ticket_status as TicketStatus) ?? "aberto"]}</p>
        ))}
      </header>

      <ConversationLive live={conversationState(conv) !== "closed"} handoffOpen={handoffOpen} visitorMessages={visitorMsgs.length} lastVisitorText={visitorMsgs.at(-1)?.content ?? ""} />

      <MessageScroller count={allMessages.length} className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 sm:-mx-6 sm:px-6">
        <div className="flex flex-col gap-4 py-5">
          {/* as conversas anteriores da mesma pessoa, em cima (uma conversa só, como no WhatsApp) */}
          <EarlierConversations
            db={admin}
            admin={admin}
            contactId={(conv.contact_id as string | null) ?? null}
            botIds={botIds}
            current={{ id: cid, startedAt: conv.started_at as string }}
            show={earlier}
            moreHref={earlierHref ?? ((n) => `/cliente/${id}/conversas/${cid}?ant=${n}`)}
            agentLabel={(m) => authorLabel(m, { view: "client", meId: member.memberId, meLegacy: email, agencyName })}
            contactName={nameForReplies}
            bot={botOf(conv.bots)}
            withNotes={member.allowHandoff}
          />
          <ConversationThread
            messages={allMessages}
            leads={leads.map((l) => ({ ...l, requests: l.requests.filter((r) => r.conversation_id === cid) }))}
            agentLabel={(m) => authorLabel(m, { view: "client", meId: member.memberId, meLegacy: email, agencyName })}
            channel={conv.channel as string}
            actions={threadActions}
            contactName={nameForReplies}
            bot={botOf(conv.bots)}
          />
        </div>
      </MessageScroller>

      {member.allowHandoff && (
        <footer className="flex flex-col gap-2 border-t border-line py-3">
          {regulated && <RegulatedNotice channel={conv.channel as string} coexistence={coexistence} />}
          <HandoffStatus conv={handoffConv} onTakeOver={takeOver} onResumeAi={memberResumeAi.bind(null, id, cid)} meId={member.memberId} />
          <HandoffReply conv={handoffConv} meId={member.memberId} onTakeOver={takeOver} onForceTakeOver={memberForceTakeOver.bind(null, id, cid)} onSend={memberSend.bind(null, id, cid)} onRelease={memberRelease.bind(null, id, cid)} docked paymentCheck={regulated} quickReplies={quickReplies} contactName={nameForReplies} attendantName={me.name} onRequestPhone={askPhone ? memberRequestPhone.bind(null, id, cid) : undefined} />
          <ConversationTools
            canTransfer={handoffOpen && !heldByAnother}
            canSnooze={handoffOpen && conv.assigned_to_id === member.memberId}
            snoozedUntil={handoffOpen ? snoozedUntil : null}
            options={options}
            onTransfer={memberTransfer.bind(null, id, cid)}
            onNote={memberAddNote.bind(null, id, cid)}
            onSnooze={memberSnooze.bind(null, id, cid)}
            onUnsnooze={memberUnsnooze.bind(null, id, cid)}
          />
        </footer>
      )}
    </div>
  );
}
