import { createAdminClient } from "@/lib/supabase/admin";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { StatusPill } from "@/components/ui/form-section";
import { endOtherSessions } from "@/app/painel/actions";
import { deviceOf } from "@/lib/access-log";
import { actorText, type AuditPeople } from "@/lib/audit-view";

const EVENT: Record<string, string> = { session: "Acesso", login: "Entrada", login_failed: "Falha na entrada", magic_link: "Entrada por link", logout: "Saída" };

const when = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

/**
 * Acessos ao painel e à área do cliente (Marco Civil: IP completo por 6 meses). Uma linha por pessoa,
 * IP e dia, mais entradas, falhas e saídas. "Encerrar as outras sessões" sai de todos os outros
 * aparelhos de quem está logado. Redesenho, etapa 5: a tabela num cartão, com o tipo em pílula.
 */
export async function AccessSection({ agencyId, people }: { agencyId: string; people: AuditPeople }) {
  const db = createAdminClient();
  const { data } = await db.from("access_log").select("id, actor_type, actor_id, event, ip, user_agent, created_at").eq("agency_id", agencyId).order("created_at", { ascending: false }).limit(100);
  const rows = (data ?? []) as Array<{ id: number; actor_type: string; actor_id: string; event: string; ip: string | null; user_agent: string | null; created_at: string }>;
  // pessoas da área do cliente: pelo e-mail (o registro guarda o id do usuário)
  const memberIds = [...new Set(rows.filter((r) => r.actor_type === "member").map((r) => r.actor_id))].slice(0, 30);
  const emails = new Map<string, string>();
  for (const id of memberIds) {
    const { data: u } = await db.auth.admin.getUserById(id);
    if (u?.user?.email) emails.set(id, u.user.email);
  }
  const who = (r: (typeof rows)[number]) => (r.actor_type === "user" ? actorText(r, people) : `Área do cliente (${emails.get(r.actor_id) ?? "pessoa removida"})`);
  const failed = rows.filter((r) => r.event === "login_failed").length;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 text-sm text-muted">
          Entradas, falhas e acessos com IP, do painel e da área do cliente, guardados por 6 meses (Marco Civil).
          {failed > 0 && <span className="text-danger"> {failed === 1 ? "1 falha na entrada" : `${failed} falhas na entrada`} entre os últimos {rows.length}.</span>}
        </p>
        <ConfirmAction action={endOtherSessions} title="Encerrar as outras sessões?" description="Você sai do painel em todos os outros aparelhos e navegadores. Esta sessão continua." confirmLabel="Encerrar" className="btn-ghost py-1.5 text-xs">
          Encerrar as minhas outras sessões
        </ConfirmAction>
      </div>
      {rows.length === 0 ? (
        <p className="card px-5 py-8 text-center text-sm text-muted">Nenhum acesso registrado ainda.</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-raised/50 text-left text-xs text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Quando</th>
                <th className="px-3 py-2 font-medium">Quem</th>
                <th className="px-3 py-2 font-medium">O quê</th>
                <th className="px-3 py-2 font-medium">IP</th>
                <th className="px-4 py-2 font-medium">Aparelho</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-2">
              {rows.map((r) => (
                <tr key={r.id} className={r.event === "login_failed" ? "bg-danger-soft/30" : undefined}>
                  <td className="whitespace-nowrap px-4 py-2 tabular-nums text-ink-2">{when(r.created_at)}</td>
                  <td className="px-3 py-2 text-ink">{who(r)}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <StatusPill tone={r.event === "login_failed" ? "danger" : r.event === "logout" ? "muted" : "ok"}>{EVENT[r.event] ?? r.event}</StatusPill>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-ink-2">{r.ip ?? "—"}</td>
                  <td className="px-4 py-2 text-xs text-muted">{deviceOf(r.user_agent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
