import Link from "next/link";
import { EvalRunner } from "@/components/admin/eval-runner";
import { requireAdmin } from "@/lib/platform-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { listCaseFiles } from "@/lib/eval-cases";
import { chatModelId } from "@/lib/ai";
import { usd } from "@/lib/backoffice";
import { cn, relativeTime } from "@/lib/utils";

export const metadata = { title: "Avaliação da IA" };

export default async function AdminEval() {
  await requireAdmin("/admin/avaliacao");
  const db = createAdminClient();
  const [{ data: bots }, { data: runs }] = await Promise.all([
    db.from("bots").select("id, name, client_name, agencies(name)").eq("is_demo", false).order("name"),
    db.from("eval_runs").select("id, bot_name, case_file, categories, model, effort, classifier, runs, passed, total, must_ok, cost_usd_per_answer, total_cost_usd, cache_pct, skipped, created_by, created_at").order("created_at", { ascending: false }).limit(30),
  ]);
  const botOptions = (bots ?? []).map((b) => {
    const agency = (Array.isArray(b.agencies) ? b.agencies[0] : b.agencies) as { name?: string } | null;
    return { id: b.id as string, name: b.name as string, client: b.client_name as string, label: `${b.name as string} · ${b.client_name as string}${agency?.name ? ` (${agency.name})` : ""}` };
  });
  // o formulário abre com o bot da última rodada de cada arquivo de casos (casos → "1")
  const { data: recent } = await db.from("eval_runs").select("case_file, bot_id").not("bot_id", "is", null).order("created_at", { ascending: false }).limit(50);
  const lastBotByFile: Record<string, string> = {};
  for (const r of recent ?? []) {
    const key = r.case_file === "casos" ? "1" : (r.case_file as string);
    lastBotByFile[key] ??= r.bot_id as string;
  }

  return (
    <>
      <div>
        <h1 className="text-[26px] font-bold">Avaliação da IA</h1>
        <p className="text-sm text-muted">O conjunto fixo de casos (pasta evals/) roda pelo mesmo caminho do chat, sem gravar conversa. Toda mudança de prompt, modelo ou temperatura passa por aqui antes de produção.</p>
      </div>

      <EvalRunner bots={botOptions} files={listCaseFiles()} defaultModel={chatModelId()} lastBotByFile={lastBotByFile} />

      <section className="card overflow-x-auto">
        <h2 className="px-5 pt-4 text-lg font-bold">Histórico</h2>
        <table className="mt-2 w-full min-w-[760px] text-sm">
          <thead className="border-b border-line text-left text-xs text-muted">
            <tr>
              <th className="px-5 py-2 font-semibold">Quando</th>
              <th className="px-3 py-2 font-semibold">Bot · casos</th>
              <th className="px-3 py-2 font-semibold">Modelo</th>
              <th className="px-3 py-2 text-right font-semibold">Resultado</th>
              <th className="px-3 py-2 text-right font-semibold">Custo/resposta</th>
              <th className="px-5 py-2 font-semibold" />
            </tr>
          </thead>
          <tbody>
            {(runs ?? []).map((r) => (
              <tr key={r.id as number} className="border-b border-line-2 last:border-0">
                <td className="px-5 py-2.5 text-xs text-muted">{relativeTime(r.created_at as string)}</td>
                <td className="px-3 py-2.5">
                  {(r.bot_name as string | null) ?? "bot apagado"}
                  <div className="text-xs text-muted">{r.case_file as string}{(r.categories as string[]).length ? ` · ${(r.categories as string[]).join(", ")}` : ""} · {r.runs as number} rodadas</div>
                </td>
                <td className="px-3 py-2.5 text-xs">
                  {r.model as string}{r.effort ? ` (${r.effort as string})` : ""}
                  {r.classifier && <div className="text-muted">classificador {r.classifier as string}</div>}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <span className={cn("font-semibold tabular", r.must_ok ? "text-ink" : "text-danger")}>{r.passed as number}/{r.total as number}</span>
                  <div className={cn("text-xs", r.must_ok ? "text-muted" : "text-danger")}>{r.must_ok ? "obrigatórios ok" : "obrigatório falhou"}{(r.skipped as number) ? ` · ${r.skipped} fora por tempo` : ""}</div>
                </td>
                <td className="px-3 py-2.5 text-right text-xs tabular">{r.cost_usd_per_answer !== null ? usd(Number(r.cost_usd_per_answer), 5) : "—"}{r.cache_pct !== null ? <div className="text-muted">{r.cache_pct as number}% cache</div> : null}{r.total_cost_usd !== null && r.total_cost_usd !== undefined ? <div className="text-muted">rodada {usd(Number(r.total_cost_usd), 3)}</div> : null}</td>
                <td className="px-5 py-2.5 text-right"><Link href={`/admin/avaliacao/${r.id}`} className="text-xs font-semibold underline">relatório</Link></td>
              </tr>
            ))}
            {!runs?.length && <tr><td colSpan={6} className="px-5 py-5 text-center text-muted">Nenhuma rodada ainda.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}
