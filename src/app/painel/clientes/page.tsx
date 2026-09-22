import Link from "next/link";
import { requireAgency } from "@/lib/agency";
import { createClient } from "@/lib/supabase/server";
import { brl } from "@/lib/plans";

export const metadata = { title: "Clientes" };

export default async function ClientesPage() {
  const { agency } = await requireAgency();
  const supabase = await createClient();
  const { data: bots } = await supabase.from("bots").select("id, name, client_name, client_site, status, price_cents").eq("agency_id", agency.id).eq("is_demo", false).order("client_name");
  const total = (bots ?? []).reduce((s, b) => s + (b.price_cents ?? 0), 0) / 100;
  return (
    <>
      <div><h1 className="text-2xl font-bold sm:text-[28px]">Clientes</h1><p className="text-sm text-muted">{bots?.length ?? 0} clientes · {brl(total)}/mês em contratos (segundo o que você informou por chatbot).</p></div>
      <div className="card overflow-hidden">
        {(bots ?? []).map((b) => (
          <Link key={b.id} href={`/painel/bots/${b.id}`} className="flex flex-wrap items-center gap-3 border-b border-line-2 px-4 py-3.5 text-sm last:border-0 hover:bg-ground">
            <span className="font-semibold">{b.client_name}</span>
            <span className="text-muted">{b.client_site?.replace(/^https?:\/\//, "")}</span>
            <span className="ml-auto tabular">{b.price_cents ? `${brl(b.price_cents / 100)}/mês` : "—"}</span>
          </Link>
        ))}
        {(bots ?? []).length === 0 && <p className="p-5 text-sm text-muted">Quando você converter uma demo ou criar um chatbot, o cliente aparece aqui.</p>}
      </div>
    </>
  );
}
