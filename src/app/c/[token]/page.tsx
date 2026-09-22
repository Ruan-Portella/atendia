import { notFound } from "next/navigation";
import { getPortalClient } from "@/lib/portal";
import { belongsToHost } from "@/lib/domain-server";
import { currentPeriodBR, getClientReport, isPeriod } from "@/lib/report";
import { AgencyHeader, ReportView } from "@/components/report-view";

export const metadata = { title: { absolute: "Relatório do assistente" }, robots: { index: false, follow: false } };

/**
 * Portal do cliente final: link somente leitura que a agência compartilha. Mostra o
 * relatório do mês, os contatos capturados e as conversas, com a marca da agência.
 */
export default async function ClientPortalPage({ params, searchParams }: PageProps<"/c/[token]">) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const portal = await getPortalClient(token);
  if (!portal || !(await belongsToHost(portal.client.agency_id))) notFound();
  const { db, client } = portal;

  const today = currentPeriodBR();
  const period = isPeriod(sp.mes) && sp.mes <= today ? sp.mes : today;
  const report = await getClientReport(db, client.id, period);
  if (!report) notFound();

  return (
    <div className="min-h-full bg-ground">
      <AgencyHeader agency={report.agency} />
      <main className="mx-auto flex max-w-[980px] flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
        <ReportView db={db} report={report} basePath={`/c/${token}`} today={today} />
      </main>
    </div>
  );
}
