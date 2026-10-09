import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Cliente → Dados: resumo, só de leitura, das Integrações que valem para este cliente (chaves de
 * API e webhooks da conta com escopo nele, e as ações de cada chatbot). Quem mexe é a área
 * Integrações da conta e a aba Ações de cada chatbot.
 */
export async function ClientIntegrationsSummary({ agencyId, clientId, bots }: { agencyId: string; clientId: string; bots: Array<{ id: string; name: string }> }) {
  const db = createAdminClient();
  const botIds = bots.map((b) => b.id);
  const covers = (r: { scope_type: string; scope_client_id: string | null; scope_bot_ids: string[] | null }) => r.scope_type === "all" || (r.scope_type === "client" && r.scope_client_id === clientId) || (r.scope_bot_ids ?? []).some((id) => botIds.includes(id));
  const [{ data: keys }, { data: hooks }, { data: actions }] = await Promise.all([
    db.from("api_keys").select("id, name, prefix, scope_type, scope_client_id, scope_bot_ids").eq("agency_id", agencyId).is("revoked_at", null),
    db.from("webhooks").select("id, name, active, scope_type, scope_client_id, scope_bot_ids").eq("agency_id", agencyId),
    botIds.length ? db.from("actions").select("bot_id, active").in("bot_id", botIds) : Promise.resolve({ data: [] }),
  ]);
  const myKeys = (keys ?? []).filter((k) => covers(k as never));
  const myHooks = (hooks ?? []).filter((h) => covers(h as never));
  const actionCount = new Map<string, number>();
  for (const a of actions ?? []) actionCount.set(a.bot_id as string, (actionCount.get(a.bot_id as string) ?? 0) + 1);

  return (
    <section className="card flex flex-col gap-3 p-6 text-sm">
      <div>
        <h3 className="font-semibold">Integrações deste cliente</h3>
        <p className="text-muted">Chaves de API e webhooks ficam na área Integrações da conta (podem cobrir vários clientes); as ações ficam em cada chatbot.</p>
      </div>
      <ul className="flex flex-col gap-1 text-ink-2">
        <li>
          {myKeys.length ? `${myKeys.length} chave${myKeys.length === 1 ? "" : "s"} de API: ${myKeys.map((k) => `${k.name as string} (${k.prefix as string}…)`).join(", ")}` : "Nenhuma chave de API cobre este cliente."}{" "}
          <Link href="/painel/integracoes?aba=chaves" className="font-semibold text-brand hover:underline">
            Abrir
          </Link>
        </li>
        <li>
          {myHooks.length ? `${myHooks.length} webhook${myHooks.length === 1 ? "" : "s"}: ${myHooks.map((h) => `${h.name as string}${h.active ? "" : " (desativado)"}`).join(", ")}` : "Nenhum webhook cobre este cliente."}{" "}
          <Link href="/painel/integracoes?aba=webhooks" className="font-semibold text-brand hover:underline">
            Abrir
          </Link>
        </li>
        {bots.map((b) => (
          <li key={b.id}>
            {b.name}: {actionCount.get(b.id) ? `${actionCount.get(b.id)} ação${actionCount.get(b.id) === 1 ? "" : "ões"}` : "nenhuma ação"}{" "}
            <Link href={`/painel/bots/${b.id}?tab=acoes`} className="font-semibold text-brand hover:underline">
              Abrir
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
