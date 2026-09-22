import Link from "next/link";
import { notFound } from "next/navigation";
import { Headset } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { minutesSince, relativeTime } from "@/lib/utils";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { AutoRefresh } from "@/components/auto-refresh";
import { releaseConversation, sendAgentMessage, takeOverConversation } from "@/app/painel/actions";

export const metadata = { title: "Conversa" };

export default async function ConversationPage({ params }: PageProps<"/painel/bots/[id]/conversas/[cid]">) {
  const { id, cid } = await params;
  const supabase = await createClient();
  const { data: conv } = await supabase
    .from("conversations")
    .select("id, started_at, last_message_at, channel, needs_human, handoff_requested_at, takeover_at, handled_at, bots(name, client_id, client_name)")
    .eq("id", cid)
    .eq("bot_id", id)
    .maybeSingle();
  if (!conv) notFound();
  const [{ data: messages }, { data: leads }] = await Promise.all([
    supabase.from("messages").select("id, role, content, sources, created_at").eq("conversation_id", cid).order("id"),
    supabase.from("leads").select("name, phone, email, notes").eq("conversation_id", cid),
  ]);
  const bot = (Array.isArray(conv.bots) ? conv.bots[0] : conv.bots) as { name: string; client_id: string | null; client_name: string } | null;
  const open = !conv.handled_at;
  const active = open && Boolean(conv.takeover_at);
  const waiting = open && !conv.takeover_at && Boolean(conv.handoff_requested_at);
  // conversa recente (últimos 30 min) ainda dá para assumir: o visitante provavelmente está lá
  const recent = minutesSince(conv.last_message_at) < 30;

  return (
    <div className="flex max-w-[760px] flex-col gap-4">
      {(active || waiting) && <AutoRefresh ms={active ? 3000 : 5000} />}
      <Link href={`/painel/bots/${id}?tab=conversas`} className="text-sm font-semibold text-muted">← Conversas{bot ? ` de ${bot.name}` : ""}</Link>
      <div>
        <h1 className="text-2xl font-bold">Conversa {relativeTime(conv.started_at)}</h1>
        <p className="text-sm text-muted">canal: {conv.channel}{conv.needs_human ? " · pediu atendente" : ""}{bot?.client_id ? <> · <Link href={`/painel/clientes/${bot.client_id}`} className="hover:underline">{bot.client_name}</Link></> : null}</p>
      </div>

      {waiting && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#efd9a9] bg-amber-soft px-4 py-3 text-sm">
          <Headset size={18} className="text-amber-ink" />
          <span className="flex-1 text-amber-ink"><strong>O visitante pediu para falar com alguém</strong> {relativeTime(conv.handoff_requested_at!)}. Assuma para responder por aqui.</span>
          <ActionForm action={takeOverConversation.bind(null, cid)}><SubmitButton pendingLabel="Assumindo…" className="btn-dark py-1.5">Assumir conversa</SubmitButton></ActionForm>
        </div>
      )}
      {active && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#cfe3d8] bg-brand-soft px-4 py-3 text-sm text-brand">
          <Headset size={18} />
          <span className="flex-1"><strong>Você está atendendo.</strong> O assistente pausou nesta conversa; o visitante vê suas respostas em segundos.</span>
        </div>
      )}

      {leads && leads.length > 0 && (
        <div className="rounded-xl bg-brand-soft p-4 text-sm">
          <div className="font-semibold text-brand">Lead capturado</div>
          {leads.map((l, i) => <div key={i}>{l.name} · {l.phone ?? l.email}{l.notes ? ` · ${l.notes}` : ""}</div>)}
        </div>
      )}
      <div className="flex flex-col gap-2.5">
        {(messages ?? []).map((m) => (
          <div
            key={m.id}
            className={
              m.role === "user"
                ? "max-w-[80%] self-end rounded-[14px_14px_4px_14px] bg-ink px-3.5 py-2.5 text-sm text-ground"
                : m.role === "agent"
                  ? "max-w-[86%] self-start rounded-[14px_14px_14px_4px] border border-[#cfe3d8] bg-brand-soft px-3.5 py-2.5 text-sm"
                  : "max-w-[86%] self-start rounded-[14px_14px_14px_4px] border border-line bg-panel px-3.5 py-2.5 text-sm"
            }
          >
            {m.role === "agent" && <div className="mb-0.5 text-[11px] font-semibold text-brand">Você (equipe)</div>}
            <div className="whitespace-pre-wrap">{m.content}</div>
            {Array.isArray(m.sources) && m.sources.length > 0 && (
              <div className="mt-1.5 text-[11px] text-muted">Fontes: {(m.sources as Array<{ title?: string; url?: string }>).map((s) => s.title ?? s.url).join(" · ")}</div>
            )}
          </div>
        ))}
      </div>

      {active ? (
        <div className="sticky bottom-0 flex flex-col gap-2 border-t border-line bg-ground py-3">
          <ActionForm action={sendAgentMessage.bind(null, cid)} className="flex items-end gap-2">
            <label htmlFor="agent-msg" className="sr-only">Sua resposta</label>
            <textarea id="agent-msg" name="content" required maxLength={2000} rows={2} className="input flex-1 resize-y" placeholder="Escreva sua resposta para o visitante…" />
            <SubmitButton pendingLabel="Enviando…" className="btn-primary">Enviar</SubmitButton>
          </ActionForm>
          <ActionForm action={releaseConversation.bind(null, cid)} className="self-end">
            <SubmitButton pendingLabel="Encerrando…" className="text-xs font-semibold text-muted hover:underline">Encerrar atendimento e devolver ao assistente</SubmitButton>
          </ActionForm>
        </div>
      ) : (
        !waiting && open && recent && (
          <ActionForm action={takeOverConversation.bind(null, cid)} className="self-start">
            <SubmitButton pendingLabel="Assumindo…" className="btn-ghost"><Headset size={15} />Assumir esta conversa</SubmitButton>
          </ActionForm>
        )
      )}
      {conv.handled_at && conv.handoff_requested_at && <p className="text-xs text-muted">Atendimento humano encerrado {relativeTime(conv.handled_at)}.</p>}
    </div>
  );
}
