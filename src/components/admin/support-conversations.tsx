import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { activeGrant } from "@/lib/support-access";
import { relativeTime } from "@/lib/utils";

const CHANNEL: Record<string, string> = { widget: "site", whatsapp: "WhatsApp", instagram: "Instagram" };
const when = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

/**
 * Backoffice → agência: conversas para o suporte, só com a liberação da agência (Segurança → Acesso
 * do suporte). Sem liberação, nem a lista aparece. Abrir uma conversa vai para a auditoria dela.
 */
export async function SupportConversations({ agencyId, bots }: { agencyId: string; bots: Array<{ id: string; name: string; client_name: string }> }) {
  const db = createAdminClient();
  const grant = await activeGrant(db, agencyId);
  if (!grant) {
    return (
      <section className="card flex flex-col gap-2 p-5">
        <h2 className="text-lg font-bold">Conversas (acesso do suporte)</h2>
        <p className="text-sm text-muted">Sem liberação. A agência libera em Segurança → Acesso do suporte, por 24 horas e com motivo; cada conversa aberta aqui aparece na auditoria dela.</p>
      </section>
    );
  }
  const botName = new Map(bots.map((b) => [b.id, `${b.name} · ${b.client_name}`]));
  const { data } = bots.length
    ? await db.from("conversations").select("id, bot_id, channel, started_at, last_message_at, message_count, needs_human").in("bot_id", bots.map((b) => b.id)).order("last_message_at", { ascending: false }).limit(30)
    : { data: [] };
  return (
    <section className="card flex flex-col gap-3 p-5">
      <div>
        <h2 className="text-lg font-bold">Conversas (acesso do suporte)</h2>
        <p className="rounded-lg bg-amber-soft px-3 py-2 text-xs text-amber-ink">
          Liberado pela agência até {when(grant.expires_at)}. Motivo: {grant.reason}. Abra só o que o motivo pede: cada conversa aberta vai para a auditoria da agência.
        </p>
      </div>
      {(data ?? []).length === 0 ? (
        <p className="text-sm text-muted">Nenhuma conversa.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line-2 text-sm">
          {(data ?? []).map((c) => (
            <li key={c.id as string} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2">
              <Link href={`/admin/clientes/${agencyId}/conversas/${c.id}`} className="font-medium hover:underline">{botName.get(c.bot_id as string) ?? "chatbot"}</Link>
              <span className="text-xs text-muted">{CHANNEL[(c.channel as string) ?? "widget"] ?? c.channel} · {c.message_count ?? 0} mensagens · {relativeTime(c.last_message_at as string)}{c.needs_human ? " · pediu ajuda" : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
