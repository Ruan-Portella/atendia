import Link from "next/link";
import { Suspense } from "react";
import { Download, MessageCircle, Trash2 } from "lucide-react";
import { requireAgency } from "@/lib/agency";
import { createClient } from "@/lib/supabase/server";
import { relativeTime } from "@/lib/utils";
import { LeadFilter } from "@/components/lead-filter";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { deleteLead } from "../actions";

export const metadata = { title: "Leads" };

export default async function LeadsPage({ searchParams }: PageProps<"/painel/leads">) {
  const sp = await searchParams;
  const botFilter = typeof sp.bot === "string" ? sp.bot : null;
  const { agency } = await requireAgency();
  const supabase = await createClient();

  const { data: bots } = await supabase.from("bots").select("id, client_name").eq("agency_id", agency.id).order("is_demo").order("client_name");
  const ids = (bots ?? []).map((b) => b.id).filter((id) => !botFilter || id === botFilter);
  const { data: leads } = ids.length
    ? await supabase.from("leads").select("id, bot_id, conversation_id, name, phone, email, notes, created_at").in("bot_id", ids).order("created_at", { ascending: false }).limit(200)
    : { data: [] };
  const nameOf = (id: string) => bots?.find((b) => b.id === id)?.client_name ?? "";
  const rows = leads ?? [];

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold sm:text-[28px]">Leads</h1>
          <p className="text-sm text-muted">Contatos que os assistentes capturaram, em todos os clientes. {rows.length ? `${rows.length} ${botFilter ? "deste cliente" : "no total"}.` : ""}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {(bots ?? []).length > 1 && (
            <Suspense>
              <LeadFilter bots={bots ?? []} />
            </Suspense>
          )}
          {rows.length > 0 && (
            <a href={`/api/leads/export${botFilter ? `?bot=${botFilter}` : ""}`} className="btn-ghost"><Download size={15} />Exportar CSV</a>
          )}
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="hidden grid-cols-[1.1fr_1.3fr_1.3fr_2.2fr_auto] gap-3 border-b border-line bg-ground px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.06em] text-muted lg:grid">
          <span>Quando</span><span>Cliente</span><span>Nome</span><span>Contato · interesse</span><span className="w-[150px]" />
        </div>
        {rows.length === 0 && (
          <p className="p-5 text-sm text-muted">
            {botFilter ? "Nenhum lead deste cliente ainda." : "Nenhum lead ainda. Eles aparecem aqui assim que um visitante deixar contato no chat."}
          </p>
        )}
        {rows.map((l) => (
          <div key={l.id} className="flex flex-col gap-1.5 border-b border-line-2 px-4 py-3 text-sm last:border-0 lg:grid lg:grid-cols-[1.1fr_1.3fr_1.3fr_2.2fr_auto] lg:items-center lg:gap-3">
            <span className="order-2 text-xs text-muted lg:order-none lg:text-sm" title={new Date(l.created_at).toLocaleString("pt-BR")}>{relativeTime(l.created_at)}<span className="lg:hidden"> · {nameOf(l.bot_id)}</span></span>
            <span className="hidden truncate lg:inline">{nameOf(l.bot_id)}</span>
            <span className="order-1 truncate font-semibold lg:order-none">{l.name ?? <span className="font-normal text-muted">sem nome</span>}</span>
            <span className="order-3 min-w-0 leading-tight lg:order-none">
              <span className="block truncate">{[l.phone, l.email].filter(Boolean).join(" · ") || <span className="text-muted">sem contato</span>}</span>
              {l.notes && <span className="block truncate text-xs text-muted">{l.notes}</span>}
            </span>
            <span className="order-4 flex items-center gap-3 pt-1 text-[13px] font-semibold lg:order-none lg:w-[150px] lg:justify-end lg:pt-0">
              {l.phone && <a href={`https://wa.me/${l.phone.replace(/\D/g, "")}`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-brand hover:underline"><MessageCircle size={14} />WhatsApp</a>}
              {l.conversation_id && <Link href={`/painel/bots/${l.bot_id}/conversas/${l.conversation_id}`} className="text-muted hover:underline">Conversa</Link>}
              <ConfirmAction
                action={deleteLead.bind(null, l.id)}
                title="Excluir este lead?"
                description={<>O contato de <strong className="text-ink">{l.name ?? "visitante"}</strong> sai da lista. A conversa continua salva.</>}
                confirmLabel="Excluir"
                className="btn-icon ml-auto lg:ml-0"
              >
                <Trash2 size={15} />
                <span className="sr-only">Excluir lead</span>
              </ConfirmAction>
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
