import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/platform-admin";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Relatório da avaliação" };

export default async function AdminEvalRun({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  await requireAdmin(`/admin/avaliacao/${id}`);
  const { data: run } = await createAdminClient().from("eval_runs").select("*").eq("id", Number(id)).maybeSingle();
  if (!run) notFound();
  return (
    <>
      <div>
        <Link href="/admin/avaliacao" className="text-xs font-semibold text-muted">← Avaliação da IA</Link>
        <h1 className="text-[26px] font-bold">{run.passed}/{run.total} casos · {run.model}</h1>
        <p className="text-sm text-muted">
          {run.bot_name ?? "bot apagado"} · {run.case_file}{run.categories?.length ? ` · ${run.categories.join(", ")}` : ""} · {run.runs} rodadas · {new Date(run.created_at).toLocaleString("pt-BR")}{run.created_by ? ` · por ${run.created_by}` : ""}
        </p>
      </div>
      <pre className="card overflow-auto whitespace-pre-wrap p-5 text-xs leading-relaxed">{run.report}</pre>
    </>
  );
}
