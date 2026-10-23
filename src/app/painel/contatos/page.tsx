import Link from "next/link";
import { withFrom } from "@/lib/back-link";
import { Download } from "lucide-react";
import { requirePermission } from "@/lib/agency";
import { can } from "@/lib/team";
import { createClient } from "@/lib/supabase/server";
import { listLeads } from "@/lib/leads";
import { ContactsList, type ContactBot } from "@/components/contacts-list";
import { LeadList } from "@/components/lead-list";
import { cn } from "@/lib/utils";

export const metadata = { title: "Contatos e leads" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * Contatos e leads (redesenho, etapa 4): as pessoas de todos os clientes num lugar só, com o
 * filtro por cliente. Lead é o contato que deixou um pedido. A RLS limita ao escopo da pessoa.
 */
export default async function ContatosPage({ searchParams }: PageProps<"/painel/contatos">) {
  const [sp, { role }] = await Promise.all([searchParams, requirePermission("config")]);
  const supabase = await createClient();
  const [{ data: clientRows }, { data: botRows }] = await Promise.all([
    supabase.from("clients").select("id, name").order("name"),
    supabase.from("bots").select("id, name, client_id, client_name, appearance, face").eq("is_demo", false).eq("is_template", false),
  ]);
  const clients = (clientRows ?? []) as Array<{ id: string; name: string }>;
  const aba = one(sp.aba) === "leads" ? "leads" : "contatos";
  const cliente = clients.some((c) => c.id === one(sp.cliente)) ? one(sp.cliente) : "";
  const bots = ((botRows ?? []) as Array<{ id: string; name: string; client_id: string | null; client_name: string; appearance: { color?: string } | null; face: unknown }>).filter((b) => !cliente || b.client_id === cliente);
  const botIds = bots.map((b) => b.id);
  const botMap = new Map<string, ContactBot>(bots.map((b) => [b.id, { name: b.name, color: b.appearance?.color ?? null, face: b.face, client: b.client_name }]));
  const clientOf = new Map(bots.map((b) => [b.id, b.client_id]));
  const leads = aba === "leads" ? await listLeads(supabase, { botIds, limit: 300 }) : [];
  const tabHref = (a: string) => `/painel/contatos?${new URLSearchParams({ ...(a === "leads" ? { aba: "leads" } : {}), ...(cliente ? { cliente } : {}) })}`;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-light sm:text-[30px]">Contatos e leads</h1>
          <p className="text-sm text-muted">As pessoas que conversaram com os chatbots de todos os seus clientes. Lead é o contato que deixou um pedido para a equipe.</p>
        </div>
      </div>

      <nav aria-label="Contatos ou leads" className="flex gap-1 self-start rounded-[14px] bg-panel p-1 shadow-[inset_0_0_0_1px_var(--color-line)]">
        {[["contatos", "Contatos"], ["leads", "Leads"]].map(([k, l]) => (
          <Link key={k} href={tabHref(k)} aria-current={aba === k ? "page" : undefined} className={cn("rounded-[10px] px-4 py-2 text-sm transition-colors duration-[120ms]", aba === k ? "bg-raised font-medium text-ink shadow-[inset_0_1px_0_var(--highlight)]" : "text-ink-2 hover:text-ink")}>
            {l}
          </Link>
        ))}
      </nav>

      {aba === "contatos" ? (
        <ContactsList
          botIds={botIds}
          bots={botMap}
          contactHref={(c) => (clientOf.get(c.bot_id) ? withFrom(`/painel/clientes/${clientOf.get(c.bot_id)}/contatos/${c.id}`, `/painel/contatos${cliente ? `?cliente=${cliente}` : ""}`) : null)}
          searchParams={sp}
          basePath="/painel/contatos"
          clients={{ options: clients, value: cliente }}
          emptyText="Nenhum contato ainda. Cada pessoa que conversa com os seus chatbots pelo WhatsApp, pelo Instagram ou identificada no site aparece aqui."
        />
      ) : (
        <>
          <form action="/painel/contatos" className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="aba" value="leads" />
            <select name="cliente" defaultValue={cliente} aria-label="Cliente" className="input w-auto">
              <option value="">Todos os clientes</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button type="submit" className="btn-ghost">Filtrar</button>
            {leads.length > 0 && can(role, "export") && (
              <a href={`/api/leads/export${cliente ? `?cliente=${cliente}` : ""}`} className="btn-ghost ml-auto">
                <Download size={15} />
                Exportar CSV
              </a>
            )}
          </form>
          <LeadList leads={leads} from={`/painel/contatos?aba=leads${cliente ? `&cliente=${cliente}` : ""}`} originLabel="Cliente · chatbot" originOf={(bid) => { const b = botMap.get(bid); return b ? `${b.client} · ${b.name}` : ""; }} empty="Nenhum lead ainda. Eles aparecem aqui assim que alguém deixar o contato no chat." />
        </>
      )}
    </div>
  );
}
