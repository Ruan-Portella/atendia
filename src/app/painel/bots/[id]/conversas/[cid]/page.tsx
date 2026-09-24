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
import { conversationState, whatsappWindowOpen } from "@/lib/presence";
import { requireAgency } from "@/lib/agency";
import { createAdminClient } from "@/lib/supabase/admin";
import { whatsappAllowed } from "@/lib/whatsapp";
import { PHONE_AUTHOR, lastContactMessageAt } from "@/lib/whatsapp-inbound";
import { IG_APP_AUTHOR } from "@/lib/instagram-inbound";
import { listSendable, loadTemplateChannel, type SendableTemplate } from "@/lib/whatsapp-templates";
import { TemplateModalButton } from "@/components/template-modal-button";
import { MessageScroller } from "@/components/message-scroller";
import { deleteConversation, releaseConversation, sendAgentMessage, sendConversationTemplate, syncInstagramNow, takeOverConversation } from "@/app/painel/actions";
import { InstagramPoller } from "@/components/instagram-poller";

export const metadata = { title: "Conversa" };

export default async function ConversationPage({ params }: PageProps<"/painel/bots/[id]/conversas/[cid]">) {
  const { id, cid } = await params;
  const supabase = await createClient();
  const { data: conv } = await supabase
    .from("conversations")
    .select("id, started_at, last_message_at, visitor_seen_at, channel, wa_id, ig_id, needs_human, handoff_requested_at, takeover_at, handled_at, bots(name, client_id, client_name)")
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
  // no WhatsApp a janela de 24 h conta da última mensagem do contato, em qualquer conversa com
  // ele (é por número); aberta por nós com modelo e sem resposta, ela nem abriu
  const isInstagram = conv.channel === "instagram" && Boolean(conv.ig_id);
  const lastUserAt = isWhatsApp ? await lastContactMessageAt(supabase, id, { waId: conv.wa_id! }) : isInstagram ? await lastContactMessageAt(supabase, id, { igsid: conv.ig_id! }) : undefined;
  const handoffConv = isWhatsApp || isInstagram ? { ...conv, last_user_at: lastUserAt } : conv;
  const windowOpen = isWhatsApp && whatsappWindowOpen(handoffConv);

  // modelos aprovados, para retomar a conversa (só quem está no teste do WhatsApp)
  let templates: SendableTemplate[] | null = null;
  if (isWhatsApp && whatsappAllowed(email)) {
    const ch = await loadTemplateChannel(createAdminClient(), id);
    templates = ch ? await listSendable(ch).catch(() => []) : null;
  }
  const contactName = leads?.[0]?.name ?? "";

  const allMessages = (messages ?? []) as ThreadMessage[];
  const templateAction = sendConversationTemplate.bind(null, cid);

  // Tela de chat: ocupa a tela toda (a barra do celular tem 60 px), cabeçalho e resposta
  // fixos, e só as mensagens rolam.
  return (
    <div className="-mx-4 -my-5 flex h-[calc(100dvh-60px)] min-h-0 flex-col sm:-mx-6 sm:-my-7 lg:-mx-9 lg:h-dvh">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-panel px-4 py-3 sm:px-5 md:px-7">
        <div className="min-w-0 flex-1">
          <Link href={`/painel/bots/${id}?tab=conversas`} className="text-xs font-semibold text-muted">← Conversas{bot ? ` de ${bot.name}` : ""}</Link>
          <h1 className="flex flex-wrap items-center gap-2.5 text-lg font-bold sm:text-xl">Conversa {relativeTime(conv.started_at)} <ConversationStateBadge conv={conv} withTime /></h1>
          <p className="text-xs text-muted">canal: {conv.channel}{conv.needs_human ? " · pediu atendente" : ""}{bot?.client_id ? <> · <Link href={`/painel/clientes/${bot.client_id}`} className="hover:underline">{bot.client_name}</Link></> : null}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {templates && <TemplateModalButton templates={templates} action={templateAction} defaults={[contactName]} highlight={!windowOpen} />}
          <ConfirmAction
            action={deleteConversation.bind(null, cid)}
            title="Excluir esta conversa?"
            description="As mensagens e os contatos capturados nela são apagados de vez (ex.: a pessoa pediu para apagar os dados dela). Não tem desfazer."
            confirmLabel="Excluir conversa"
            className="btn-ghost text-danger"
          >
            <Trash2 size={15} />
            Excluir
          </ConfirmAction>
        </div>
      </header>

      {isInstagram && <InstagramPoller action={syncInstagramNow.bind(null, id)} />}
      <ConversationLive live={conversationState(conv) !== "closed"} handoffOpen={!conv.handled_at && Boolean(conv.takeover_at || conv.handoff_requested_at)} visitorMessages={visitorMsgs.length} lastVisitorText={visitorMsgs.at(-1)?.content ?? ""} />

      <MessageScroller count={allMessages.length} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[860px] flex-col gap-4 px-4 py-5 sm:px-5 md:px-7">
          <HandoffStatus conv={handoffConv} onTakeOver={takeOver} />
          <ConversationThread
            messages={allMessages}
            leads={leads}
            showSources
            agentLabel={(author) => (!author || author === "agência" ? "Você (agência)" : author === PHONE_AUTHOR ? "Pelo celular (WhatsApp Business)" : author === IG_APP_AUTHOR ? "Pelo app do Instagram" : `Cliente · ${author}`)}
          />
        </div>
      </MessageScroller>

      <footer className="border-t border-line bg-ground">
        <div className="mx-auto flex max-w-[860px] flex-col gap-2 px-4 py-3 sm:px-5 md:px-7">
          {isInstagram && !whatsappWindowOpen(handoffConv) && (
            <p className="rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink">
              <strong>{lastUserAt === null ? "O contato ainda não mandou mensagem." : "Passaram 24 h desde a última mensagem do contato."}</strong> O Instagram só deixa responder dentro desse prazo. Quando ele escrever de novo, a conversa continua aqui.
            </p>
          )}
          {templates && !windowOpen && (
            <p className="rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink">
              {lastUserAt === null ? <strong>Aguardando a resposta do contato.</strong> : <strong>Passaram 24 h desde a última mensagem do contato.</strong>}{" "}
              {lastUserAt === null ? "Até ele responder, o WhatsApp só deixa enviar modelos aprovados" : "O WhatsApp só deixa retomar com um modelo aprovado"}: use “Enviar modelo” no topo. Quando ele responder, a conversa continua aqui.
            </p>
          )}
          <HandoffReply conv={handoffConv} onTakeOver={takeOver} onSend={sendAgentMessage.bind(null, cid)} onRelease={releaseConversation.bind(null, cid)} docked />
        </div>
      </footer>
    </div>
  );
}
