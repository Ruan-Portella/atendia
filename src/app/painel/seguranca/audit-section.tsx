import Link from "next/link";
import { Download } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ACTION_GROUPS, ACTORS, PERIODS, actionLabel, actorText, clientTargetIds, listAudit, targetNamer, type AuditFilters, type AuditPeople } from "@/lib/audit-view";
import { isSecurityAlert } from "@/lib/security-alerts";

const PAGE = 50;
const when = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

/** Auditoria: filtros, lista com antes e depois, exportar CSV. */
export async function AuditSection({ agencyId, people, filters, page }: { agencyId: string; people: AuditPeople; filters: AuditFilters; page: number }) {
  const supabase = await createClient();
  const [{ data: clients }, { data: bots }, targetIds] = await Promise.all([
    supabase.from("clients").select("id, name").order("name"),
    supabase.from("bots").select("id, name"),
    clientTargetIds(supabase, filters.clientId),
  ]);
  const rows = await listAudit(supabase, agencyId, filters, { limit: PAGE + 1, offset: page * PAGE, targetIds });
  const more = rows.length > PAGE;
  const nameOf = targetNamer(new Map((clients ?? []).map((c) => [c.id as string, c.name as string])), new Map((bots ?? []).map((b) => [b.id as string, b.name as string])));
  const qs = (extra: Record<string, string | number>) => {
    const p = new URLSearchParams({ aba: "auditoria", dias: String(filters.days), ...(filters.actor ? { quem: filters.actor } : {}), ...(filters.group ? { tipo: filters.group } : {}), ...(filters.clientId ? { cliente: filters.clientId } : {}) });
    for (const [k, v] of Object.entries(extra)) p.set(k, String(v));
    return p.toString();
  };

  return (
    <section className="card flex flex-col gap-4 p-6">
      <div>
        <h2 className="text-base font-bold">Auditoria</h2>
        <p className="text-sm text-muted">Quem fez o quê na sua conta, guardado por 1 ano, sem conteúdo de conversa. Os eventos graves também vão por e-mail na hora.</p>
      </div>
      <form method="get" className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="aba" value="auditoria" />
        <div>
          <label htmlFor="f-dias" className="label">Período</label>
          <select id="f-dias" name="dias" defaultValue={filters.days} className="input">
            {PERIODS.map((d) => <option key={d} value={d}>{d === 365 ? "1 ano" : `${d} dias`}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="f-quem" className="label">Quem</label>
          <select id="f-quem" name="quem" defaultValue={filters.actor} className="input">
            <option value="">Todos</option>
            {Object.entries(ACTORS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="f-tipo" className="label">Tipo</label>
          <select id="f-tipo" name="tipo" defaultValue={filters.group} className="input">
            <option value="">Todos</option>
            {Object.entries(ACTION_GROUPS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="f-cliente" className="label">Cliente</label>
          <select id="f-cliente" name="cliente" defaultValue={filters.clientId} className="input max-w-[220px]">
            <option value="">Todos</option>
            {(clients ?? []).map((c) => <option key={c.id as string} value={c.id as string}>{c.name as string}</option>)}
          </select>
        </div>
        <button type="submit" className="btn-ghost">Filtrar</button>
        <a href={`/api/seguranca/auditoria?${qs({})}`} className="btn-ghost"><Download size={14} />CSV</a>
      </form>

      {rows.length === 0 ? (
        <p className="text-sm text-muted">Nenhum evento com esses filtros.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line text-sm">
          {rows.slice(0, PAGE).map((r) => (
            <li key={r.id} className="py-2.5">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <span className={isSecurityAlert(r.action) ? "font-semibold text-danger" : "font-medium"}>{actionLabel(r.action)}</span>
                  <span className="text-xs text-muted">{when(r.created_at)} · {actorText(r, people)}{nameOf(r) ? ` · ${nameOf(r)}` : ""}</span>
                </summary>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold text-muted">Antes</p>
                    <pre className="max-h-48 overflow-auto rounded-lg bg-ground p-2 text-xs">{r.before ? JSON.stringify(r.before, null, 2) : "—"}</pre>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-muted">Depois</p>
                    <pre className="max-h-48 overflow-auto rounded-lg bg-ground p-2 text-xs">{r.after ? JSON.stringify(r.after, null, 2) : "—"}</pre>
                  </div>
                  <p className="text-xs text-muted sm:col-span-2">Código: {r.action}</p>
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
      {(page > 0 || more) && (
        <div className="flex gap-2">
          {page > 0 && <Link href={`/painel/seguranca?${qs({ pagina: page - 1 })}`} className="btn-ghost text-xs">Mais novos</Link>}
          {more && <Link href={`/painel/seguranca?${qs({ pagina: page + 1 })}`} className="btn-ghost text-xs">Mais antigos</Link>}
        </div>
      )}
    </section>
  );
}
