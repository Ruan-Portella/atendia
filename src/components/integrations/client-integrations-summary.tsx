import Link from "next/link";
import { ArrowUpRight, KeyRound, Webhook, Workflow } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { SettingGroup, SettingRow } from "@/components/ui/setting-row";

const OPEN = "inline-flex shrink-0 items-center gap-1 rounded-[9px] px-2 py-1 text-[12.5px] font-medium text-brand hover:bg-brand-soft";

/**
 * Cliente → Dados: resumo, só de leitura, das Integrações que valem para este cliente (chaves de
 * API e webhooks da conta com escopo nele, e as ações de cada chatbot). Quem mexe é a área
 * Integrações da conta e a aba Ações de cada chatbot. Redesenho (23/10/2026): uma linha para cada,
 * com o "Abrir" no canto.
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
  const open = (href: string) => (
    <Link href={href} className={OPEN}>
      Abrir
      <ArrowUpRight size={13} />
    </Link>
  );

  return (
    <SettingGroup title="Integrações deste cliente">
      <SettingRow icon={<KeyRound size={18} />} title="Chaves de API" summary={myKeys.length ? myKeys.map((k) => `${k.name as string} (${k.prefix as string}…)`).join(", ") : "Nenhuma chave cobre este cliente"} trailing={open("/painel/integracoes?aba=chaves")} />
      <SettingRow icon={<Webhook size={18} />} title="Webhooks" summary={myHooks.length ? myHooks.map((h) => `${h.name as string}${h.active ? "" : " (desativado)"}`).join(", ") : "Nenhum webhook cobre este cliente"} trailing={open("/painel/integracoes?aba=webhooks")} />
      {bots.map((b) => {
        const n = actionCount.get(b.id) ?? 0;
        return <SettingRow key={b.id} icon={<Workflow size={18} />} title={`Ações · ${b.name}`} summary={n ? `${n} ${n === 1 ? "ação" : "ações"}` : "Nenhuma ação"} trailing={open(`/painel/bots/${b.id}?tab=acoes`)} />;
      })}
    </SettingGroup>
  );
}
