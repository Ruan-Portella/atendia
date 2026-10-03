import { Kpi } from "@/components/kpi";
import { requireAdmin } from "@/lib/platform-admin";
import { getCompliance } from "@/lib/backoffice-ops";
import { getBotAnalyses, getBusinessReviews, getGateReviews, getIncidents, getMeasures, getRecentAcceptances, rangeFor } from "@/lib/backoffice";
import { BotAnalyses } from "@/components/admin/bot-analyses";
import { GateReviews } from "@/components/admin/gate-reviews";
import { IncidentRegister } from "@/components/admin/incidents";
import { AcceptanceList, BusinessReviews } from "@/components/admin/business-reviews";
import { MeasureList } from "@/components/admin/pause-controls";
import { num } from "@/lib/plans";
import { relativeTime } from "@/lib/utils";

export const metadata = { title: "Conformidade" };
// "Rodar as agendadas" faz várias chamadas de IA
export const maxDuration = 60;

const REASON_LABEL: Record<string, string> = { opt_out: "SAIR/PARAR no chat", user_preferences: "preferências do WhatsApp", meta_131050: "Meta (contato bloqueou)", erasure: "exclusão de dados" };
const KIND_LABEL: Record<string, string> = { marketing: "promoções", utility: "lembretes", all: "tudo" };
const SOURCE_LABEL: Record<string, string> = { meta_instagram: "Instagram (Meta)", meta_facebook: "Facebook (Meta)" };

export default async function AdminCompliance({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin("/admin/conformidade");
  const sp = await searchParams;
  const email = typeof sp.email === "string" ? sp.email.trim().slice(0, 120) : "";
  const range = rangeFor("30d");
  const [c, measures, reviews, acceptances, incidents, gate, analyses] = await Promise.all([getCompliance(range.since, email || null), getMeasures({ limit: 50 }), getBusinessReviews(), getRecentAcceptances(), getIncidents(), getGateReviews(), getBotAnalyses()]);
  const active = c.suppressions.reduce((t, s) => t + s.active, 0);
  const created = c.suppressions.reduce((t, s) => t + s.created_since, 0);
  const revoked = c.suppressions.reduce((t, s) => t + s.revoked_since, 0);
  const pending = c.deletions.filter((d) => d.status !== "completed").length;

  return (
    <>
      <div>
        <h1 className="text-[26px] font-bold">Conformidade</h1>
        <p className="text-sm text-muted">Medidas (suspensões e avisos da Meta), pedidos de exclusão de dados vindos da Meta, descadastros de mensagens e o registro de quem acessou o backoffice (Marco Civil). Contatos aparecem só como contagem.</p>
      </div>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Pedidos de exclusão" value={num(c.deletions.length)} sub={pending ? `${pending} sem concluir` : "todos concluídos"} />
        <Kpi label="Registros apagados (30 dias)" value={num(c.deletedRowsSince)} sub="por exclusão de dados (deletion_log)" />
        <Kpi label="Descadastros ativos" value={num(active)} sub={`${num(created)} novos e ${num(revoked)} desfeitos em 30 dias`} />
        <Kpi label="Acessos ao backoffice" value={num(c.access.length)} sub={email ? `de "${email}" (últimos 100)` : "últimos 100"} />
      </section>

      <IncidentRegister incidents={incidents} />

      <BusinessReviews open={reviews.open} recent={reviews.recent} />

      <GateReviews open={gate.open} recent={gate.recent} exceptions={gate.exceptions} />

      <BotAnalyses pending={analyses.pending} recent={analyses.recent} due={analyses.due} />

      <section className="card flex flex-col gap-2 p-5">
        <h2 className="text-base font-bold">Medidas: suspensões da BoaVoz e avisos da Meta</h2>
        <p className="text-xs text-muted">Ordem da Meta bloqueia o número (nada entra nem sai) e é levantada sozinha quando a Meta reativa a conta. Infrações e restrições ficam só registradas por enquanto. Suspensões da BoaVoz são criadas na página de cada agência.</p>
        <MeasureList measures={measures} showAgency empty="Nenhuma medida registrada." />
      </section>

      <AcceptanceList rows={acceptances} />

      <section className="card flex flex-col gap-2 p-5">
        <h2 className="text-base font-bold">Pedidos de exclusão de dados (Meta)</h2>
        {c.deletions.length ? (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="py-1.5 font-semibold">Código</th><th className="py-1.5 font-semibold">Origem</th><th className="py-1.5 font-semibold">Recebido</th><th className="py-1.5 font-semibold">Situação</th></tr></thead>
            <tbody>
              {c.deletions.map((d) => (
                <tr key={d.code as string} className="border-t border-line-2">
                  <td className="py-2 font-mono text-xs">{d.code as string}</td>
                  <td className="py-2">{SOURCE_LABEL[d.source as string] ?? (d.source as string)}</td>
                  <td className="py-2 text-muted">{relativeTime(d.created_at as string)}</td>
                  <td className="py-2">{d.status === "completed" ? `concluído ${d.completed_at ? relativeTime(d.completed_at as string) : ""}` : <strong className="text-danger">pendente</strong>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-muted">Nenhum pedido.</p>
        )}
      </section>

      <section className="card flex flex-col gap-2 p-5">
        <h2 className="text-base font-bold">Descadastros de mensagens</h2>
        {c.suppressions.length ? (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="py-1.5 font-semibold">Canal</th><th className="py-1.5 font-semibold">De quê</th><th className="py-1.5 font-semibold">Motivo</th><th className="py-1.5 text-right font-semibold">Ativos</th><th className="py-1.5 text-right font-semibold">Novos (30 d)</th><th className="py-1.5 text-right font-semibold">Desfeitos (30 d)</th></tr></thead>
            <tbody>
              {c.suppressions.map((s) => (
                <tr key={`${s.channel}${s.kind}${s.reason}`} className="border-t border-line-2">
                  <td className="py-2">{s.channel === "whatsapp" ? "WhatsApp" : s.channel === "instagram" ? "Instagram" : s.channel}</td>
                  <td className="py-2">{KIND_LABEL[s.kind] ?? s.kind}</td>
                  <td className="py-2">{REASON_LABEL[s.reason] ?? s.reason}</td>
                  <td className="py-2 text-right tabular">{num(s.active)}</td>
                  <td className="py-2 text-right tabular">{num(s.created_since)}</td>
                  <td className="py-2 text-right tabular">{num(s.revoked_since)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-muted">Nenhum descadastro.</p>
        )}
      </section>

      <section className="card flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold">Registro de acessos ao backoffice</h2>
          <form className="flex gap-2">
            <input name="email" defaultValue={email} placeholder="filtrar por e-mail" className="input w-56 py-1.5" />
            <button type="submit" className="btn-ghost py-1.5">Filtrar</button>
          </form>
        </div>
        <ul className="flex flex-col divide-y divide-line-2 text-sm">
          {c.access.map((a) => (
            <li key={a.id as number} className="flex flex-wrap justify-between gap-2 py-1.5">
              <span className="min-w-0 break-words font-mono text-xs">{a.path as string}</span>
              <span className="text-xs text-muted">{a.email as string} · {new Date(a.created_at as string).toLocaleString("pt-BR")}</span>
            </li>
          ))}
          {!c.access.length && <li className="py-2 text-muted">Nenhum acesso.</li>}
        </ul>
      </section>
    </>
  );
}
