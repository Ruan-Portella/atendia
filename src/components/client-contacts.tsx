import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientContactTags, listClientContacts } from "@/lib/contacts";
import { CONSENT_LABEL, consentByContact } from "@/lib/marketing-consent";
import { relativeTime } from "@/lib/utils";

const CHANNEL_LABEL: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram", widget: "Site" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * Cliente → Contatos (leva B3): quem conversou com os chatbots do cliente, com busca por nome ou
 * telefone (o telefone é buscado pelo hash), filtro por canal e etiqueta e a situação das
 * novidades (WhatsApp). Sem busca por palavra das conversas.
 */
export async function ClientContacts({ clientId, botIds, botName, searchParams }: { clientId: string; botIds: string[]; botName: Map<string, string>; searchParams: Record<string, string | string[] | undefined> }) {
  const q = one(searchParams.q).slice(0, 80);
  const canal = ["whatsapp", "instagram", "widget"].includes(one(searchParams.canal)) ? one(searchParams.canal) : "";
  const etiqueta = one(searchParams.etiqueta).slice(0, 30);
  const pagina = Math.max(0, Math.min(200, Number(one(searchParams.pagina)) || 0));
  const db = createAdminClient();
  const [{ rows, more }, tags] = await Promise.all([listClientContacts(db, { botIds, q, channel: canal || null, tag: etiqueta || null, page: pagina }), clientContactTags(db, botIds)]);
  const consent = await consentByContact(db, rows.filter((r) => r.channel === "whatsapp").map((r) => r.id));
  const pageHref = (n: number) => {
    const p = new URLSearchParams({ tab: "contatos", ...(q ? { q } : {}), ...(canal ? { canal } : {}), ...(etiqueta ? { etiqueta } : {}), ...(n ? { pagina: String(n) } : {}) });
    return `/painel/clientes/${clientId}?${p}`;
  };
  const filtered = Boolean(q || canal || etiqueta);

  return (
    <div className="flex flex-col gap-3">
      <form className="card flex flex-wrap items-end gap-2 p-4" action={`/painel/clientes/${clientId}`}>
        <input type="hidden" name="tab" value="contatos" />
        <div className="min-w-[200px] flex-1">
          <label htmlFor="contatos-q" className="label">Buscar</label>
          <input id="contatos-q" name="q" defaultValue={q} maxLength={80} className="input" placeholder="Nome ou telefone com DDD" />
        </div>
        <div>
          <label htmlFor="contatos-canal" className="label">Canal</label>
          <select id="contatos-canal" name="canal" defaultValue={canal} className="input">
            <option value="">Todos</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="instagram">Instagram</option>
            <option value="widget">Site</option>
          </select>
        </div>
        {tags.length > 0 && (
          <div>
            <label htmlFor="contatos-etiqueta" className="label">Etiqueta</label>
            <select id="contatos-etiqueta" name="etiqueta" defaultValue={etiqueta} className="input">
              <option value="">Todas</option>
              {tags.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        )}
        <button type="submit" className="btn-primary">Filtrar</button>
        {filtered && <Link href={`/painel/clientes/${clientId}?tab=contatos`} className="btn-ghost">Limpar</Link>}
      </form>

      <div className="card overflow-hidden">
        {rows.length === 0 && (
          <p className="p-5 text-sm text-muted">{filtered ? "Nenhum contato com esse filtro." : "Nenhum contato ainda. Cada pessoa que conversa com os chatbots deste cliente pelo WhatsApp, pelo Instagram ou identificada no site aparece aqui."}</p>
        )}
        {rows.map((c) => {
          const state = c.channel === "whatsapp" ? consent.get(c.id) ?? "none" : null;
          const title = c.name ?? (c.phone ? `+${c.phone}` : c.instagram ? `Instagram ${c.instagram}` : "Sem nome");
          return (
            <Link key={c.id} href={`/painel/clientes/${clientId}/contatos/${c.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-2 px-4 py-3 text-sm last:border-0 hover:bg-ground">
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate font-semibold">{title}</span>
                <span className="block truncate text-xs text-muted">
                  {[CHANNEL_LABEL[c.channel] ?? c.channel, c.name && c.phone ? `+${c.phone}` : null, botName.get(c.bot_id)].filter(Boolean).join(" · ")}
                </span>
              </span>
              {c.tags.length > 0 && (
                <span className="flex flex-wrap gap-1">
                  {c.tags.slice(0, 4).map((t) => <span key={t} className="rounded-full bg-ground px-2 py-0.5 text-xs text-ink-2">{t}</span>)}
                  {c.tags.length > 4 && <span className="text-xs text-muted">+{c.tags.length - 4}</span>}
                </span>
              )}
              {state && (
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${state === "granted" ? "bg-brand-soft text-brand" : "bg-ground text-muted"}`}>
                  Novidades: {CONSENT_LABEL[state]}
                </span>
              )}
              <span className="w-full text-xs text-muted sm:w-auto">{c.last_inbound_at ? `última mensagem ${relativeTime(c.last_inbound_at)}` : "ainda não escreveu"}</span>
            </Link>
          );
        })}
      </div>

      {(pagina > 0 || more) && (
        <div className="flex justify-between">
          {pagina > 0 ? <Link href={pageHref(pagina - 1)} className="btn-ghost">← Anteriores</Link> : <span />}
          {more && <Link href={pageHref(pagina + 1)} className="btn-ghost">Próximos →</Link>}
        </div>
      )}
    </div>
  );
}
