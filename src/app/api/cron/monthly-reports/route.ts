import { createAdminClient } from "@/lib/supabase/admin";
import { isCronAuthorized, deadline } from "@/lib/cron";
import { agencyBaseUrl } from "@/lib/domain";
import { currentPeriodBR, getClientReport, newPortalToken, portalUrl, sendReportEmail, shiftPeriod } from "@/lib/report";

export const maxDuration = 60;

/**
 * Todo dia 1º (vercel.json): manda o relatório do mês anterior para cada cliente com
 * e-mail cadastrado. Guarda o mês enviado em report_last_period, então rodar de novo no
 * mesmo mês (ou retomar depois de um timeout) não duplica e-mails.
 */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return new Response("unauthorized", { status: 401 });
  if (!process.env.RESEND_API_KEY) return Response.json({ skipped: "RESEND_API_KEY ausente" });

  const db = createAdminClient();
  const period = shiftPeriod(currentPeriodBR(), -1);
  const { data: clients } = await db
    .from("clients")
    .select("id, report_email, portal_token, agencies!inner(plan)")
    .not("report_email", "is", null)
    .or(`report_last_period.is.null,report_last_period.lt.${period}`)
    .neq("agencies.plan", "cancelado")
    .limit(500);

  const hasTime = deadline(50_000);
  let sent = 0;
  const failed: string[] = [];
  for (const c of clients ?? []) {
    if (!hasTime()) break;
    try {
      let token = c.portal_token as string | null;
      if (!token) {
        token = newPortalToken();
        await db.from("clients").update({ portal_token: token }).eq("id", c.id);
      }
      const report = await getClientReport(db, c.id, period);
      if (!report || !report.bots.length) {
        await db.from("clients").update({ report_last_period: period }).eq("id", c.id); // sem chatbots: nada a relatar
        continue;
      }
      await sendReportEmail(report, c.report_email as string, `${portalUrl(token, agencyBaseUrl(report.agency))}?mes=${period}`);
      await db.from("clients").update({ report_last_period: period }).eq("id", c.id);
      sent++;
    } catch (e) {
      failed.push(`${c.id}: ${(e as Error).message}`);
    }
  }
  if (failed.length) console.error("relatórios com erro:", failed);
  return Response.json({ period, sent, failed: failed.length, pending: (clients?.length ?? 0) - sent - failed.length });
}
