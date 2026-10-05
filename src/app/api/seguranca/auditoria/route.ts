import { requireAgency } from "@/lib/agency";
import { can } from "@/lib/team";
import { createAdminClient } from "@/lib/supabase/admin";
import { mfaRedirect } from "@/lib/agency-mfa";
import { createClient } from "@/lib/supabase/server";
import { auditCsv, auditFilters, auditPeople, clientTargetIds, listAudit, targetNamer } from "@/lib/audit-view";

/** Auditoria da agência em CSV, com os mesmos filtros da tela (até 5.000 eventos). */
export async function GET(req: Request) {
  const { agency, role, userId } = await requireAgency();
  if (!can(role, "security")) return new Response("só o dono ou um administrador da agência vê a auditoria", { status: 403 });
  const verify = await mfaRedirect(req);
  if (verify) return verify;
  const supabase = await createClient();
  const f = auditFilters(Object.fromEntries(new URL(req.url).searchParams));
  const [{ data: clients }, { data: bots }, targetIds] = await Promise.all([
    supabase.from("clients").select("id, name"),
    supabase.from("bots").select("id, name"),
    clientTargetIds(supabase, f.clientId),
  ]);
  const rows = await listAudit(supabase, agency.id, f, { limit: 5000, targetIds });
  const nameOf = targetNamer(new Map((clients ?? []).map((c) => [c.id as string, c.name as string])), new Map((bots ?? []).map((b) => [b.id as string, b.name as string])));
  return new Response(auditCsv(rows, await auditPeople(createAdminClient(), agency.id, userId), nameOf), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="auditoria-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
