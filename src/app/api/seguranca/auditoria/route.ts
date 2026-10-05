import { requireAgency } from "@/lib/agency";
import { createClient } from "@/lib/supabase/server";
import { auditCsv, auditFilters, clientTargetIds, listAudit, targetNamer } from "@/lib/audit-view";

/** Auditoria da agência em CSV, com os mesmos filtros da tela (até 5.000 eventos). */
export async function GET(req: Request) {
  const { agency } = await requireAgency();
  const supabase = await createClient();
  const f = auditFilters(Object.fromEntries(new URL(req.url).searchParams));
  const [{ data: clients }, { data: bots }, targetIds] = await Promise.all([
    supabase.from("clients").select("id, name"),
    supabase.from("bots").select("id, name"),
    clientTargetIds(supabase, f.clientId),
  ]);
  const rows = await listAudit(supabase, agency.id, f, { limit: 5000, targetIds });
  const nameOf = targetNamer(new Map((clients ?? []).map((c) => [c.id as string, c.name as string])), new Map((bots ?? []).map((b) => [b.id as string, b.name as string])));
  return new Response(auditCsv(rows, agency.owner_id, nameOf), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="auditoria-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
