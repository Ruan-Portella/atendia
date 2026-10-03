import { requireAdminApi } from "@/lib/platform-admin";
import { getClientExport } from "@/lib/backoffice";
import { toCsv } from "@/lib/client-export";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit, requestMeta } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** Lista de clientes em CSV (uma linha por chatbot). Só a equipe, com a segunda etapa; fica na auditoria. */
export async function GET() {
  const s = await requireAdminApi("/admin/clientes/exportar");
  if (s instanceof Response) return s;
  const rows = await getClientExport();
  await audit(createAdminClient(), { agencyId: null, actorType: "support", actorId: s.email, action: "admin.exportar_clientes", targetType: "export", targetId: "clientes", after: { linhas: rows.length }, ...(await requestMeta()) });
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  return new Response(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="clientes-boavoz-${day}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
