import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ACTION_GROUPS, ACTORS, PERIODS, actionLabel, actorText, auditFields, clientTargetIds, listAudit, targetNamer, type AuditFilters, type AuditPeople } from "@/lib/audit-view";
import { isSecurityAlert } from "@/lib/security-alerts";
import { AuditFilterBar } from "@/components/audit-filter-bar";
import { StatusPill } from "@/components/ui/form-section";
import { cn } from "@/lib/utils";

const PAGE = 50;
const when = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

/**
 * Auditoria: filtros que já filtram, a lista e o CSV. Redesenho, etapa 5: cada evento abre o que mudou
 * em linhas de campo, antes e depois (auditFields), sem JSON à mostra.
 */
export async function AuditSection({ agencyId, people, filters, page }: { agencyId: string; people: AuditPeople; filters: AuditFilters; page: number }) {
  const supabase = await createClient();
  const [{ data: clients }, { data: bots }, targetIds] = await Promise.all([supabase.from("clients").select("id, name").order("name"), supabase.from("bots").select("id, name"), clientTargetIds(supabase, filters.clientId)]);
  const rows = await listAudit(supabase, agencyId, filters, { limit: PAGE + 1, offset: page * PAGE, targetIds });
  const more = rows.length > PAGE;
  const nameOf = targetNamer(new Map((clients ?? []).map((c) => [c.id as string, c.name as string])), new Map((bots ?? []).map((b) => [b.id as string, b.name as string])));
  const qs = (extra: Record<string, string | number>) => {
    const p = new URLSearchParams({ aba: "auditoria", dias: String(filters.days), ...(filters.actor ? { quem: filters.actor } : {}), ...(filters.group ? { tipo: filters.group } : {}), ...(filters.clientId ? { cliente: filters.clientId } : {}) });
    for (const [k, v] of Object.entries(extra)) p.set(k, String(v));
    return p.toString();
  };

  return (
    <section className="flex flex-col gap-3">
      <p className="text-sm text-muted">Quem fez o quê na sua conta, guardado por 1 ano, sem conteúdo de conversa. Os eventos graves (em vermelho) também vão por e-mail na hora.</p>
      <AuditFilterBar
        values={{ dias: String(filters.days), quem: filters.actor, tipo: filters.group, cliente: filters.clientId }}
        periods={PERIODS.map((d) => [String(d), d === 365 ? "1 ano" : `${d} dias`])}
        actors={Object.entries(ACTORS)}
        groups={Object.entries(ACTION_GROUPS)}
        clients={(clients ?? []).map((c) => [c.id as string, c.name as string])}
        csvHref={`/api/seguranca/auditoria?${qs({})}`}
      />

      {rows.length === 0 ? (
        <p className="card px-5 py-8 text-center text-sm text-muted">Nenhum evento com esses filtros.</p>
      ) : (
        <ul className="card flex flex-col divide-y divide-line-2 overflow-hidden">
          {rows.slice(0, PAGE).map((r) => {
            const alert = isSecurityAlert(r.action);
            const fields = auditFields(r.before, r.after);
            const both = Boolean(r.before && r.after);
            return (
              <li key={r.id}>
                <details className="group/ev">
                  <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 transition-colors duration-[120ms] hover:bg-raised/40 [&::-webkit-details-marker]:hidden">
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className={cn("text-sm font-medium", alert ? "text-danger" : "text-ink")}>{actionLabel(r.action)}</span>
                        {alert && <StatusPill tone="danger">grave</StatusPill>}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted">
                        {actorText(r, people)}
                        {nameOf(r) ? ` · ${nameOf(r)}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-muted">{when(r.created_at)}</span>
                    <ChevronDown size={15} className="shrink-0 text-muted transition-transform duration-[220ms] group-open/ev:rotate-180" />
                  </summary>
                  <div className="flex flex-col gap-2 px-4 pb-4">
                    {fields.length ? (
                      <div className="overflow-x-auto rounded-[12px] border border-line">
                        <table className="w-full text-[13px]">
                          <thead className="bg-raised/50 text-left text-xs text-muted">
                            <tr>
                              <th className="px-3 py-1.5 font-medium">Campo</th>
                              {both ? (
                                <>
                                  <th className="px-3 py-1.5 font-medium">Antes</th>
                                  <th className="px-3 py-1.5 font-medium">Depois</th>
                                </>
                              ) : (
                                <th className="px-3 py-1.5 font-medium">{r.before ? "Como estava" : "Registrado"}</th>
                              )}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-line-2">
                            {fields.map((f) => (
                              <tr key={f.label} className={f.changed ? "bg-brand-soft/30" : undefined}>
                                <td className="whitespace-nowrap px-3 py-1.5 text-muted">{f.label}</td>
                                {both ? (
                                  <>
                                    <td className="px-3 py-1.5 text-ink-2">{f.before}</td>
                                    <td className={cn("px-3 py-1.5", f.changed ? "font-medium text-ink" : "text-ink-2")}>{f.after}</td>
                                  </>
                                ) : (
                                  <td className="px-3 py-1.5 text-ink">{f.after ?? f.before}</td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-xs text-muted">Sem detalhes além do que está na linha.</p>
                    )}
                    <p className="text-[11px] text-muted">
                      Código do evento: <span className="font-mono">{r.action}</span>
                    </p>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}
      {(page > 0 || more) && (
        <div className="flex gap-2">
          {page > 0 && (
            <Link href={`/painel/seguranca?${qs({ pagina: page - 1 })}`} className="btn-ghost text-xs">
              Mais novos
            </Link>
          )}
          {more && (
            <Link href={`/painel/seguranca?${qs({ pagina: page + 1 })}`} className="btn-ghost text-xs">
              Mais antigos
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
