import { Suspense } from "react";
import { Download } from "lucide-react";
import { requireAgency } from "@/lib/agency";
import { createClient } from "@/lib/supabase/server";
import { LeadFilter } from "@/components/lead-filter";
import { LeadList, type LeadRow } from "@/components/lead-list";

export const metadata = { title: "Leads" };

export default async function LeadsPage({ searchParams }: PageProps<"/painel/leads">) {
  const sp = await searchParams;
  const clientFilter = typeof sp.cliente === "string" ? sp.cliente : null;
  const { agency } = await requireAgency();
  const supabase = await createClient();

  const [{ data: clients }, { data: bots }] = await Promise.all([
    supabase.from("clients").select("id, name").eq("agency_id", agency.id).order("name"),
    supabase.from("bots").select("id, client_id, client_name, is_demo").eq("agency_id", agency.id),
  ]);
  const ids = (bots ?? []).filter((b) => !clientFilter || b.client_id === clientFilter).map((b) => b.id);
  const { data: leads } = ids.length
    ? await supabase.from("leads").select("id, bot_id, conversation_id, name, phone, email, notes, created_at").in("bot_id", ids).order("created_at", { ascending: false }).limit(200)
    : { data: [] };
  const byId = new Map((bots ?? []).map((b) => [b.id, b.is_demo ? `Demo · ${b.client_name}` : b.client_name]));
  const rows = (leads ?? []) as LeadRow[];

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold sm:text-[28px]">Leads</h1>
          <p className="text-sm text-muted">Contatos capturados em todos os clientes. Para ver só os de um cliente, abra o painel dele em Clientes. {rows.length ? `${rows.length} ${clientFilter ? "deste cliente" : "no total"}.` : ""}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {(clients ?? []).length > 1 && (
            <Suspense>
              <LeadFilter clients={clients ?? []} />
            </Suspense>
          )}
          {rows.length > 0 && (
            <a href={`/api/leads/export${clientFilter ? `?cliente=${clientFilter}` : ""}`} className="btn-ghost"><Download size={15} />Exportar CSV</a>
          )}
        </div>
      </div>
      <LeadList
        leads={rows}
        originLabel="Cliente"
        originOf={(id) => byId.get(id) ?? ""}
        empty={clientFilter ? "Nenhum lead deste cliente ainda." : "Nenhum lead ainda. Eles aparecem aqui assim que um visitante deixar contato no chat."}
      />
    </>
  );
}
