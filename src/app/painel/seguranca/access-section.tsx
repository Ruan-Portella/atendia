import { createAdminClient } from "@/lib/supabase/admin";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { endOtherSessions } from "../actions";
import { deviceOf } from "@/lib/access-log";
import { actorText, type AuditPeople } from "@/lib/audit-view";

const EVENT: Record<string, string> = { session: "Acesso", login: "Entrada", login_failed: "Falha na entrada", magic_link: "Entrada por link", logout: "Saída" };

const when = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

/**
 * Acessos ao painel e à área do cliente (Marco Civil: IP completo por 6 meses). Uma linha por pessoa,
 * IP e dia, mais entradas, falhas e saídas. "Encerrar as outras sessões" sai de todos os outros
 * aparelhos de quem está logado.
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

  return (
    <section className="card flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold">Acessos ao painel</h2>
          <p className="text-sm text-muted">Entradas, falhas e acessos com IP, do painel e da área do cliente. Guardados por 6 meses (Marco Civil).</p>
        </div>
        <ConfirmAction
          action={endOtherSessions}
          title="Encerrar as outras sessões?"
          description="Você sai do painel em todos os outros aparelhos e navegadores. Esta sessão continua."
          confirmLabel="Encerrar"
          className="btn-ghost text-xs"
        >
          Encerrar as outras sessões
        </ConfirmAction>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">Nenhum acesso registrado ainda.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr><th className="py-1.5 pr-3 font-semibold">Quando</th><th className="py-1.5 pr-3 font-semibold">Quem</th><th className="py-1.5 pr-3 font-semibold">O quê</th><th className="py-1.5 pr-3 font-semibold">IP</th><th className="py-1.5 font-semibold">Aparelho</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id} className={r.event === "login_failed" ? "text-danger" : ""}>
                  <td className="whitespace-nowrap py-1.5 pr-3">{when(r.created_at)}</td>
                  <td className="py-1.5 pr-3">{who(r)}</td>
                  <td className="whitespace-nowrap py-1.5 pr-3">{EVENT[r.event] ?? r.event}</td>
                  <td className="py-1.5 pr-3 font-mono text-xs">{r.ip ?? "—"}</td>
                  <td className="py-1.5 text-xs text-muted">{deviceOf(r.user_agent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
