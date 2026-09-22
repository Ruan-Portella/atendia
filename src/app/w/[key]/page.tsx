import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { ChatWindow } from "@/components/chat-window";
import { WidgetFrame } from "@/components/widget-frame";
import { initials } from "@/lib/utils";

export const metadata = { robots: { index: false } };

/** Conteúdo do iframe do widget e link direto para Instagram/WhatsApp. */
export default async function WidgetPage({ params }: PageProps<"/w/[key]">) {
  const { key } = await params;
  const db = createAdminClient();
  const { data: bot } = await db.from("bots").select("*").eq("public_key", key).maybeSingle();
  if (!bot) notFound();
  const { data: agency } = await db.from("agencies").select("name, brand_color").eq("id", bot.agency_id).single();
  const offline = bot.status !== "live" && !bot.is_demo;
  return (
    <WidgetFrame>
      {offline ? (
        <div className="flex h-full items-center justify-center bg-white p-6 text-center text-sm text-muted">Este assistente está temporariamente indisponível.</div>
      ) : (
        <ChatWindow
          channel="widget"
          bot={{ key: bot.public_key, name: bot.name, clientName: bot.client_name, color: bot.appearance?.color ?? agency?.brand_color ?? "#1f4e3d", avatarText: bot.appearance?.avatar_text ?? initials(bot.client_name), welcome: bot.persona?.welcome ?? `Olá! Sou ${bot.name}. Como posso ajudar?`, suggestedQuestions: bot.appearance?.suggested_questions ?? [], poweredBy: agency?.name ?? null }}
        />
      )}
    </WidgetFrame>
  );
}
