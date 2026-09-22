import { notFound } from "next/navigation";
import { requireMember } from "@/lib/member";
import { currentPeriodBR, getClientReport, isPeriod } from "@/lib/report";
import { ReportView } from "@/components/report-view";

export const metadata = { title: { absolute: "Relatório do assistente" }, robots: { index: false, follow: false } };

export default async function MemberReportPage({ params, searchParams }: PageProps<"/cliente/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { admin } = await requireMember(id);
  const today = currentPeriodBR();
  const period = isPeriod(sp.mes) && sp.mes <= today ? sp.mes : today;
  const report = await getClientReport(admin, id, period);
  if (!report) notFound();
  return <ReportView db={admin} report={report} basePath={`/cliente/${id}`} today={today} />;
}
