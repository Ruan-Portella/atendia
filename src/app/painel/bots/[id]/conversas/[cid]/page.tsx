import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { relativeTime } from "@/lib/utils";
import { ConversationThread, type ThreadMessage } from "@/components/conversation-thread";
import { HandoffReply, HandoffStatus } from "@/components/handoff-controls";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { ConversationStateBadge } from "@/components/conversation-state";
import { ConversationLive } from "@/components/conversation-live";
import { conversationState, whatsappWindowOpen } from "@/lib/presence";
import { requireAgency } from "@/lib/agency";
import { createAdminClient } from "@/lib/supabase/admin";
import { whatsappAllowed } from "@/lib/whatsapp";
import { listSendable, loadTemplateChannel, type SendableTemplate } from "@/lib/whatsapp-templates";
import { TemplateSender } from "@/components/template-sender";
import { deleteConversation, releaseConversation, sendAgentMessage, sendConversationTemplate, takeOverConversation } from "@/app/painel/actions";

export const metadata = { title: "Conversa" };

/** "O contato nunca escreveu": a janela de 24 h do WhatsApp nem chegou a abrir. */
const NEVER = new Date(0).toISOString();

export default async function ConversationPage({ params }: PageProps<"/painel/bots/[id]/conversas/[cid]">) {
  const { id, cid } = await params;
  const supabase = await createClient();
  const { data: conv } = await supabase
    .from("conversations")
    .select("id, started_at, last_message_at, visitor_seen_at, channel, wa_id, needs_human, handoff_requested_at, takeover_at, handled_at, bots(name, client_id, client_name)")
    .eq("id", cid)
    .eq("bot_id", id)
    .maybeSingle();
  if (!conv) notFound();
  const isWhatsApp = conv.channel === "whatsapp" && Boolean(conv.wa_id);
  const [{ data: messages }, { data: leads }, { email }] = await Promise.all([
    supabase.from("messages").select("id, role, content, sources, author, created_at").eq("conversation_id", cid).order("id"),
    supabase.from("leads").select("name, phone, email, notes").eq("conversation_id", cid),
    requireAgency(),
  ]);
  const bot = (Array.isArray(conv.bots) ? conv.bots[0] : conv.bots) as { name: string; client_id: string | null; client_name: string } | null;
  const takeOver = takeOverConversation.bind(null, cid);
  const visitorMsgs = (messages ?? []).filter((m) => m.role === "user");
  // no WhatsApp a janela de 24 h conta da última mensagem do contato; conversa aberta por nós
  // com modelo (sem mensagem dele ainda) começa fechada
  const handoffConv = isWhatsApp ? { ...conv, last_user_at: visitorMsgs.at(-1)?.created_at ?? NEVER } : conv;
  const windowOpen = isWhatsApp && whatsappWindowOpen(handoffConv);

  // modelos aprovados, para retomar a conversa (só quem está no teste do WhatsApp)
  let templates: SendableTemplate[] | null = null;
  if (isWhatsApp && whatsappAllowed(email)) {
    const ch = await loadTemplateChannel(createAdminClient(), id);
    templates = ch ? await listSendable(ch).catch(() => []) : null;
  }
  const contactName = leads?.[0]?.name ?? "";

  return (
    <div className="flex max-w-[760px] flex-col gap-4">
      <Link href={`/painel/bots/${id}?tab=conversas`} className="text-sm font-semibold text-muted">← Conversas{bot ? ` de ${bot.name}` : ""}</Link>
      <div>
        <h1 className="flex flex-wrap items-center gap-3 text-2xl font-bold">Conversa {relativeTime(conv.started_at)} <ConversationStateBadge conv={conv} withTime /></h1>
        <p className="text-sm text-muted">canal: {conv.channel}{conv.needs_human ? " · pediu atendente" : ""}{bot?.client_id ? <> · <Link href={`/painel/clientes/${bot.client_id}`} className="hover:underline">{bot.client_name}</Link></> : null}</p>
      </div>
      <ConversationLive live={conversationState(conv) !== "closed"} handoffOpen={!conv.handled_at && Boolean(conv.takeover_at || conv.handoff_requested_at)} visitorMessages={visitorMsgs.length} lastVisitorText={visitorMsgs.at(-1)?.content ?? ""} />
      <HandoffStatus conv={handoffConv} onTakeOver={takeOver} />
      <ConversationThread
        messages={(messages ?? []) as ThreadMessage[]}
        leads={leads}
        showSources
        agentLabel={(author) => (!author || author === "agência" ? "Você (agência)" : `Cliente · ${author}`)}
      />
      <HandoffReply conv={handoffConv} onTakeOver={takeOver} onSend={sendAgentMessage.bind(null, cid)} onRelease={releaseConversation.bind(null, cid)} />
      {templates &&
        (windowOpen ? (
          <details className="card p-4 text-sm">
            <summary className="cursor-pointer font-semibold">Enviar modelo de mensagem</summary>
            <div className="mt-3"><TemplateSender templates={templates} action={sendConversationTemplate.bind(null, cid)} defaults={[contactName]} /></div>
          </details>
        ) : (
          <div className="flex flex-col gap-3 rounded-xl border border-[#efd9a9] bg-amber-soft p-4">
            <p className="text-sm text-amber-ink"><strong>Passaram 24 h desde a última mensagem do contato.</strong> O WhatsApp só deixa retomar com um modelo aprovado. Quando ele responder, a conversa continua aqui normalmente.</p>
            <TemplateSender templates={templates} action={sendConversationTemplate.bind(null, cid)} defaults={[contactName]} />
          </div>
        ))}
      <div className="border-t border-line-2 pt-3">
        <ConfirmAction
          action={deleteConversation.bind(null, cid)}
          title="Excluir esta conversa?"
          description="As mensagens e os contatos capturados nela são apagados de vez (ex.: a pessoa pediu para apagar os dados dela). Não tem desfazer."
          confirmLabel="Excluir conversa"
          className="text-xs font-medium text-danger hover:underline"
        >
          Excluir conversa (LGPD)
        </ConfirmAction>
      </div>
    </div>
  );
}
