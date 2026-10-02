import Link from "next/link";
import { requireAdmin } from "@/lib/platform-admin";
import { agencyStatus, getAgencies, usd, usdBrl, type AgencyRow } from "@/lib/backoffice";
import { brl, num } from "@/lib/plans";
import { cn, relativeTime } from "@/lib/utils";

export const metadata = { title: "Agências" };

const STATUS_LABEL = { pagante: "Pagante", teste: "Em teste", teste_vencido: "Teste vencido", cancelada: "Cancelada" } as const;
type Status = keyof typeof STATUS_LABEL;
const SORTS = { recentes: "Mais recentes", custo: "Maior custo de IA", uso: "Maior uso da cota", atividade: "Atividade recente" } as const;
type Sort = keyof typeof SORTS;

const quotaShare = (a: AgencyRow) => (a.quota ? a.atendimentosMonth / a.quota : 0);

function sortRows(rows: AgencyRow[], sort: Sort) {
  const by = {
    recentes: (a: AgencyRow, b: AgencyRow) => b.createdAt.localeCompare(a.createdAt),
    custo: (a: AgencyRow, b: AgencyRow) => b.aiCostMonthUsd - a.aiCostMonthUsd,
    uso: (a: AgencyRow, b: AgencyRow) => quotaShare(b) - quotaShare(a),
    atividade: (a: AgencyRow, b: AgencyRow) => (b.lastActivity ?? "").localeCompare(a.lastActivity ?? ""),
  }[sort];
  return [...rows].sort(by);
}

export default async function AdminClients({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin("/admin/clientes");
  const sp = await searchParams;
  const situacao = (typeof sp.situacao === "string" && sp.situacao in STATUS_LABEL ? sp.situacao : null) as Status | null;
  const ordem = (typeof sp.ordem === "string" && sp.ordem in SORTS ? sp.ordem : "recentes") as Sort;
  const all = await getAgencies();
  const rows = sortRows(situacao ? all.filter((a) => agencyStatus(a) === situacao) : all, ordem);
  const fx = usdBrl();
  const href = (s: Status | null, o: Sort) => `/admin/clientes?${new URLSearchParams({ ...(s ? { situacao: s } : {}), ...(o !== "recentes" ? { ordem: o } : {}) })}`;

  return (
    <>
      <div>
        <h1 className="text-[26px] font-bold">Agências</h1>
        <p className="text-sm text-muted">Quem assina a BoaVoz (cada agência tem os próprios clientes e chatbots). Uso e custo do mês corrente; margem = mensalidade − custo de IA (dólar a {brl(fx)}).</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href={href(null, ordem)} className={cn("rounded-full border px-3 py-1", !situacao ? "border-ink bg-ink text-ground" : "border-line bg-panel")}>Todas ({all.length})</Link>
        {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
          <Link key={s} href={href(s, ordem)} className={cn("rounded-full border px-3 py-1", situacao === s ? "border-ink bg-ink text-ground" : "border-line bg-panel")}>
            {STATUS_LABEL[s]} ({all.filter((a) => agencyStatus(a) === s).length})
          </Link>
        ))}
        <span className="ml-auto text-muted">Ordenar:</span>
        {(Object.keys(SORTS) as Sort[]).map((o) => (
          <Link key={o} href={href(situacao, o)} className={cn("text-sm", ordem === o ? "font-semibold text-ink" : "text-muted hover:text-ink")}>{SORTS[o]}</Link>
        ))}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="border-b border-line text-left text-xs text-muted">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Agência</th>
              <th className="px-3 py-2.5 font-semibold">Plano</th>
              <th className="px-3 py-2.5 font-semibold">Bots</th>
              <th className="px-3 py-2.5 font-semibold">Canais</th>
              <th className="px-3 py-2.5 text-right font-semibold">Atendimentos no mês</th>
              <th className="px-3 py-2.5 text-right font-semibold">IA no mês</th>
              <th className="px-3 py-2.5 text-right font-semibold">Margem</th>
              <th className="px-4 py-2.5 font-semibold">Última atividade</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const st = agencyStatus(a);
              const margin = a.priceBrl - a.aiCostMonthUsd * fx;
              return (
                <tr key={a.id} className="border-b border-line-2 last:border-0 hover:bg-ground">
                  <td className="px-4 py-2.5">
                    <Link href={`/admin/clientes/${a.id}`} className="font-semibold hover:underline">{a.name}</Link>
                    <div className="text-xs text-muted">{a.email ?? "sem e-mail"}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    {a.planName}
                    <div className={cn("text-xs", st === "teste_vencido" || st === "cancelada" ? "text-danger" : "text-muted")}>{STATUS_LABEL[st]}</div>
                    {a.aiPausedAt && <div className="text-xs font-semibold text-danger">IA pausada</div>}
                  </td>
                  <td className="px-3 py-2.5 tabular">{a.liveBots}/{a.bots}</td>
                  <td className="px-3 py-2.5 text-xs text-muted">{[a.whatsapp ? `WhatsApp ${a.whatsapp}` : "", a.instagram ? `Instagram ${a.instagram}` : ""].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="px-3 py-2.5 text-right tabular">
                    {num(a.atendimentosMonth)} / {num(a.quota)}
                    <div className={cn("text-xs", quotaShare(a) >= 0.9 ? "text-danger" : "text-muted")}>{Math.round(quotaShare(a) * 100)}% da cota</div>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular">{usd(a.aiCostMonthUsd)}</td>
                  <td className={cn("px-3 py-2.5 text-right tabular", a.priceBrl && margin < 0 ? "font-semibold text-danger" : "")}>{a.priceBrl ? brl(margin) : "—"}</td>
                  <td className="px-4 py-2.5 text-xs text-muted">{a.lastActivity ? relativeTime(a.lastActivity) : "nunca"}</td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr><td colSpan={8} className="px-4 py-6 text-center text-muted">Nenhuma agência aqui.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
