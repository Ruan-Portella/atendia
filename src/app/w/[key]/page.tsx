import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { belongsToHost } from "@/lib/domain-server";
import { ChatWindow } from "@/components/chat-window";
import { WidgetFrame } from "@/components/widget-frame";
import { initials } from "@/lib/utils";
import { isBotSize } from "@/lib/plans";
import { parseProtocol, ticketFormOf } from "@/lib/tickets";

export const metadata = { title: { absolute: "Chat" }, robots: { index: false } };

/** O formulário de chamado para o widget (só o que a tela usa); whatsapp: o aceite do aviso pela resposta (parte 7d). */
function publicTicket(raw: unknown, whatsapp: boolean) {
  const f = ticketFormOf(raw);
  return f ? { mode: f.mode, phone: f.phone, subjects: f.subjects, whatsapp: whatsapp && f.phone !== "nao", attachment: Boolean(f.attachment) } : null;
}

/** Conteúdo do iframe do widget e link direto para Instagram/WhatsApp. */
export default async function WidgetPage({ params, searchParams }: PageProps<"/w/[key]">) {
  const { key } = await params;
  // ?id=1: o site identifica a pessoa (getToken no widget.js, P2); ?chamado=: o link do e-mail do chamado (parte 7c)
  const sp = await searchParams;
  const identity = sp.id === "1";
  const initialProtocol = parseProtocol(sp.chamado);
  const db = createAdminClient();
  const { data: bot } = await db.from("bots").select("*").eq("public_key", key).maybeSingle();
  if (!bot || !(await belongsToHost(bot.agency_id))) notFound();
  const [{ data: agency }, { data: wa }] = await Promise.all([
    db.from("agencies").select("name, brand_color, privacy_url").eq("id", bot.agency_id).single(),
    bot.ticket_form ? db.from("whatsapp_channels").select("disconnected_at").eq("bot_id", bot.id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  // sem tamanho, o chat do site não liga (o Atendimento mostra o formulário de contato); a demo só
  // funciona na página dela (/demo/...)
  const offline = bot.is_demo || bot.status !== "live" || (!isBotSize(bot.size) && bot.quota_override === null);
  return (
    <WidgetFrame>
      {offline ? (
        <div className="flex h-full items-center justify-center bg-white p-6 text-center text-sm text-muted">Este assistente está temporariamente indisponível.</div>
      ) : (
        <ChatWindow
          channel="widget"
          embedded
          identity={identity}
          initialProtocol={initialProtocol}
          bot={{ key: bot.public_key, name: bot.name, clientName: bot.client_name, color: bot.appearance?.color ?? agency?.brand_color ?? "#1f4e3d", avatarText: bot.appearance?.avatar_text ?? initials(bot.client_name), welcome: bot.persona?.welcome ?? `Olá! Sou ${bot.name}. Como posso ajudar?`, suggestedQuestions: bot.appearance?.suggested_questions ?? [], poweredBy: agency?.name ?? null, privacyUrl: agency?.privacy_url ?? null, handoffButton: Boolean((bot.human_handoff as { widget_button?: boolean } | null)?.widget_button), ticket: publicTicket(bot.ticket_form, Boolean(wa && !wa.disconnected_at)) }}
        />
      )}
    </WidgetFrame>
  );
}
