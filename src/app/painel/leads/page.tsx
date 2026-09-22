import Link from "next/link";
import { requireAgency } from "@/lib/agency";
import { createClient } from "@/lib/supabase/server";
import { relativeTime } from "@/lib/utils";

export const metadata = { title: "Leads" };

export default async function LeadsPage() {
  const { agency } = await requireAgency();
  const supabase = await createClient();
  const { data: bots } = await supabase.from("bots").select("id, client_name").eq("agency_id", agency.id);
  const ids = (bots ?? []).map((b) => b.id);
  const { data: leads } = ids.length ? await supabase.from("leads").select("id, bot_id, conversation_id, name, phone, email, notes, created_at").in("bot_id", ids).order("created_at", { ascending: false }).limit(200) : { data: [] };
  const nameOf = (id: string) => bots?.find((b) => b.id === id)?.client_name ?? "";
  return (
    <>
      <div><h1 className="text-[28px] font-bold">Leads</h1><p className="text-sm text-muted">Contatos que os assistentes capturaram, em todos os clientes.</p></div>
      <div className="card overflow-hidden">
        <div className="hidden grid-cols-[1.2fr_1.4fr_1.4fr_2fr_1fr] gap-3 border-b border-line bg-ground px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.06em] text-muted md:grid"><span>Quando</span><span>Cliente</span><span>Nome</span><span>Contato · interesse</span><span /></div>
        {(leads ?? []).length === 0 && <p className="p-5 text-sm text-muted">Nenhum lead ainda. Eles aparecem aqui assim que um visitante deixar contato no chat.</p>}
        {(leads ?? []).map((l) => (
          <div key={l.id} className="grid grid-cols-1 gap-1 border-b border-line-2 px-4 py-3 text-sm last:border-0 md:grid-cols-[1.2fr_1.4fr_1.4fr_2fr_1fr] md:items-center md:gap-3">
            <span className="text-muted">{relativeTime(l.created_at)}</span>
            <span>{nameOf(l.bot_id)}</span>
            <span className="font-semibold">{l.name}</span>
            <span className="truncate">{[l.phone, l.email].filter(Boolean).join(" · ")}{l.notes ? ` · ${l.notes}` : ""}</span>
            <span className="flex gap-3 text-[13px] font-semibold md:justify-end">
              {l.phone && <a href={`https://wa.me/${l.phone.replace(/\D/g, "")}`} target="_blank" rel="noopener" className="text-brand">WhatsApp</a>}
              {l.conversation_id && <Link href={`/painel/bots/${l.bot_id}/conversas/${l.conversation_id}`} className="text-muted">Conversa</Link>}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
