import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { relativeTime } from "@/lib/utils";

export const metadata = { title: "Conversa" };

export default async function ConversationPage({ params }: PageProps<"/painel/bots/[id]/conversas/[cid]">) {
  const { id, cid } = await params;
  const supabase = await createClient();
  const { data: conv } = await supabase.from("conversations").select("id, started_at, channel, needs_human").eq("id", cid).eq("bot_id", id).maybeSingle();
  if (!conv) notFound();
  const [{ data: messages }, { data: leads }] = await Promise.all([
    supabase.from("messages").select("id, role, content, sources, created_at").eq("conversation_id", cid).order("id"),
    supabase.from("leads").select("name, phone, email, notes").eq("conversation_id", cid),
  ]);
  return (
    <div className="max-w-[760px]">
      <Link href={`/painel/bots/${id}?tab=conversas`} className="text-sm font-semibold text-muted">← Conversas</Link>
      <h1 className="mt-3 text-2xl font-bold">Conversa {relativeTime(conv.started_at)}</h1>
      <p className="text-sm text-muted">canal: {conv.channel}{conv.needs_human ? " · pediu atendente" : ""}</p>
      {leads && leads.length > 0 && (
        <div className="mt-4 rounded-xl bg-brand-soft p-4 text-sm">
          <div className="font-semibold text-brand">Lead capturado</div>
          {leads.map((l, i) => <div key={i}>{l.name} · {l.phone ?? l.email}{l.notes ? ` · ${l.notes}` : ""}</div>)}
        </div>
      )}
      <div className="mt-5 flex flex-col gap-2.5">
        {(messages ?? []).map((m) => (
          <div key={m.id} className={m.role === "user" ? "max-w-[80%] self-end rounded-[14px_14px_4px_14px] bg-ink px-3.5 py-2.5 text-sm text-ground" : "max-w-[86%] self-start rounded-[14px_14px_14px_4px] border border-line bg-panel px-3.5 py-2.5 text-sm"}>
            <div className="whitespace-pre-wrap">{m.content}</div>
            {Array.isArray(m.sources) && m.sources.length > 0 && (
              <div className="mt-1.5 text-[11px] text-muted">Fontes: {(m.sources as Array<{ title?: string; url?: string }>).map((s) => s.title ?? s.url).join(" · ")}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
