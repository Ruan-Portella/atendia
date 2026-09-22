import Link from "next/link";
import { requireAgency } from "@/lib/agency";
import { createClient } from "@/lib/supabase/server";
import { DemoGenerator } from "@/components/demo-generator";
import { CopyButton } from "@/components/copy-button";
import { appUrl, relativeTime } from "@/lib/utils";

export const metadata = { title: "Demos" };

export default async function DemosPage() {
  const { agency } = await requireAgency();
  const supabase = await createClient();
  const { data: demos } = await supabase.from("bots").select("id, client_name, client_site, demo_slug, demo_views, status, created_at").eq("agency_id", agency.id).eq("is_demo", true).order("created_at", { ascending: false });

  return (
    <>
      <div>
        <h1 className="text-[28px] font-bold">Demos</h1>
        <p className="text-sm text-muted">Cole o site de um prospect. Em um minuto você tem um link para mandar no WhatsApp dele.</p>
      </div>
      <div className="card max-w-[640px] p-6"><DemoGenerator inPanel /></div>
      <div className="card overflow-hidden">
        {(demos ?? []).length === 0 && <p className="p-5 text-sm text-muted">Nenhuma demo ainda.</p>}
        {(demos ?? []).map((d) => {
          const url = appUrl(`/demo/${d.demo_slug}`);
          return (
            <div key={d.id} className="flex flex-wrap items-center gap-3 border-b border-line-2 px-4 py-3.5 text-sm last:border-0">
              <div className="min-w-0 flex-1 leading-tight">
                <Link href={`/painel/bots/${d.id}`} className="block truncate font-semibold">{d.client_name}</Link>
                <span className="block truncate text-xs text-muted">{d.client_site?.replace(/^https?:\/\//, "")} · gerada {relativeTime(d.created_at)} · aberta {d.demo_views} {d.demo_views === 1 ? "vez" : "vezes"}{d.status === "error" ? " · erro ao ler o site" : ""}</span>
              </div>
              {d.demo_views > 3 && <span className="rounded-full bg-amber-soft px-2 py-0.5 text-xs font-semibold text-amber-ink">quente</span>}
              <a href={url} target="_blank" rel="noopener" className="text-[13px] font-semibold text-brand">Abrir</a>
              <CopyButton text={url} label="Copiar link" />
              <a href={`https://wa.me/?text=${encodeURIComponent(`Olá! Montei um assistente de IA para o site de ${d.client_name}. Testa aqui: ${url}`)}`} target="_blank" rel="noopener" className="btn-dark py-1.5">Mandar no WhatsApp</a>
            </div>
          );
        })}
      </div>
    </>
  );
}
