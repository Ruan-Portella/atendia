import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/agency";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { campaignsInPlan } from "@/lib/plan-limits";
import { cn } from "@/lib/utils";
import { CampaignWizard } from "@/components/campaign-wizard";
import { ReminderWizard } from "@/components/reminder-wizard";

export const metadata = { title: "Nova campanha" };
// a prévia monta o público (até 10.000 contatos ou 2.000 linhas) e consulta a Meta
export const maxDuration = 60;

const KINDS = [
  { id: "marketing", title: "Marketing", hint: "Promoções e novidades, só para quem aceitou receber." },
  { id: "lembrete", title: "Lembrete de utilidade", hint: "Consulta, vencimento, revisão: uma planilha com a data e a hora de cada um." },
] as const;

/** Nova campanha (leva B3, partes 4a e 5): os chatbots do escopo com o WhatsApp conectado. */
export default async function NewCampaignPage({ searchParams }: PageProps<"/painel/campanhas/nova">) {
  const [{ plan }, sp] = await Promise.all([requirePermission("config"), searchParams]);
  if (!campaignsInPlan(plan.id)) notFound();
  const kind = sp.tipo === "lembrete" ? "lembrete" : "marketing";
  const supabase = await createClient();
  // vindo da aba Campanhas do cliente: só os chatbots dele, e a volta é para lá
  const clientId = typeof sp.cliente === "string" && /^[0-9a-f-]{36}$/i.test(sp.cliente) ? sp.cliente : null;
  const { data: client } = clientId ? await supabase.from("clients").select("id, name").eq("id", clientId).maybeSingle() : { data: null };
  let botQuery = supabase.from("bots").select("id, name, client_name").eq("is_demo", false).order("name");
  if (client) botQuery = botQuery.eq("client_id", client.id as string);
  const { data: bots } = await botQuery;
  const ids = (bots ?? []).map((b) => b.id as string);
  const { data: channels } = ids.length ? await createAdminClient().from("whatsapp_channels").select("bot_id").in("bot_id", ids).is("disconnected_at", null).not("waba_id", "is", null) : { data: [] };
  const connected = new Set((channels ?? []).map((c) => c.bot_id as string));
  const options = (bots ?? []).filter((b) => connected.has(b.id as string)).map((b) => ({ id: b.id as string, name: b.name as string, clientName: (b.client_name as string | null) ?? "" }));

  return (
    <div className="flex max-w-[860px] flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Link href={client ? `/painel/clientes/${client.id as string}?tab=campanhas` : "/painel/campanhas"} className="text-sm font-semibold text-muted">
          ← {client ? `Campanhas de ${client.name as string}` : "Campanhas"}
        </Link>
        <h1 className="text-2xl font-bold sm:text-[28px]">Nova campanha</h1>
        <p className="text-sm text-muted">
          Antes de enviar, você vê quantos recebem, quem fica de fora e por quê, e o custo estimado na Meta, que cobra direto da conta do cliente. O BoaVoz confere cada envio de novo (SAIR, aceite e 18+).
        </p>
      </div>

      <section className="card flex flex-col gap-3 p-5">
        <h2 className="flex items-center gap-2.5 font-semibold">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-brand">1</span>
          Tipo
        </h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {KINDS.map((k) => (
            <Link
              key={k.id}
              href={`/painel/campanhas/nova?${new URLSearchParams({ ...(client ? { cliente: client.id as string } : {}), ...(k.id === "lembrete" ? { tipo: "lembrete" } : {}) }).toString()}`}
              aria-current={kind === k.id ? "page" : undefined}
              className={cn("flex flex-col rounded-lg border p-3 text-sm", kind === k.id ? "border-brand bg-brand-soft/40" : "border-line hover:bg-ground")}
            >
              <span className="font-semibold">{k.title}</span>
              <span className="text-xs text-muted">{k.hint}</span>
            </Link>
          ))}
        </div>
      </section>

      {kind === "lembrete" ? <ReminderWizard key="lembrete" bots={options} /> : <CampaignWizard key="marketing" bots={options} />}
    </div>
  );
}
