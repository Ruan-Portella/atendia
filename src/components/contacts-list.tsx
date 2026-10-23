import Link from "next/link";
import { Search } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientContactTags, listClientContacts, type ContactListRow } from "@/lib/contacts";
import { CONSENT_LABEL, consentByContact } from "@/lib/marketing-consent";
import { BotFace } from "@/components/bot-face";
import { relativeTime } from "@/lib/utils";
import { ContactAvatar } from "@/components/contact-avatar";

const CHANNEL_LABEL: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram", widget: "Site" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export interface ContactBot {
  name: string;
  color?: string | null;
  face?: unknown;
  /** o cliente do chatbot (na lista de todos os clientes) */
  client?: string;
}

/**
 * Contatos (leva B3; redesenho, etapa 4): quem conversou com os chatbots, com busca por nome ou
 * telefone (o telefone pelo hash), filtro por canal, etiqueta e, na lista de todos os clientes,
 * por cliente; a situação das novidades (WhatsApp). Serve à página do cliente e a Contatos e leads.
 */
export async function ContactsList({
  botIds,
  bots,
  contactHref,
  searchParams,
  basePath,
  hidden = {},
  importSlot = null,
  clients = null,
  emptyText,
}: {
  botIds: string[];
  bots: Map<string, ContactBot>;
  contactHref: (c: ContactListRow) => string | null;
  searchParams: Record<string, string | string[] | undefined>;
  /** para onde o filtro e as páginas apontam */
  basePath: string;
  /** os parâmetros que ficam (ex.: a aba) */
  hidden?: Record<string, string>;
  /** o botão de importar planilha (o painel lateral), quando a tela permite */
  importSlot?: React.ReactNode;
  /** o filtro por cliente (Contatos e leads): as opções e o escolhido */
  clients?: { options: Array<{ id: string; name: string }>; value: string } | null;
  emptyText: string;
}) {
  const q = one(searchParams.q).slice(0, 80);
  const canal = ["whatsapp", "instagram", "widget"].includes(one(searchParams.canal)) ? one(searchParams.canal) : "";
  const etiqueta = one(searchParams.etiqueta).slice(0, 30);
  const pagina = Math.max(0, Math.min(200, Number(one(searchParams.pagina)) || 0));
  const db = createAdminClient();
  const [{ rows, more }, tags] = await Promise.all([listClientContacts(db, { botIds, q, channel: canal || null, tag: etiqueta || null, page: pagina }), clientContactTags(db, botIds)]);
  const consent = await consentByContact(db, rows.filter((r) => r.channel === "whatsapp").map((r) => r.id));
  const keep = { ...hidden, ...(clients?.value ? { cliente: clients.value } : {}) };
  const pageHref = (n: number) => `${basePath}?${new URLSearchParams({ ...keep, ...(q ? { q } : {}), ...(canal ? { canal } : {}), ...(etiqueta ? { etiqueta } : {}), ...(n ? { pagina: String(n) } : {}) })}`;
  const filtered = Boolean(q || canal || etiqueta || clients?.value);

  return (
    <div className="flex flex-col gap-3">
      {/* o painel de importar fica fora do formulário do filtro (os botões dele não enviam o filtro) */}
      <div className="flex flex-wrap items-end gap-2">
      <form className="flex min-w-0 flex-1 flex-wrap items-end gap-2" action={basePath}>
        {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <div className="relative min-w-[200px] flex-1">
          <label htmlFor="contatos-q" className="sr-only">Buscar</label>
          <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
          <input id="contatos-q" name="q" defaultValue={q} maxLength={80} className="input pl-9" placeholder="Buscar pelo nome ou pelo telefone com DDD" />
        </div>
        {clients && (
          <select name="cliente" defaultValue={clients.value} aria-label="Cliente" className="input w-auto">
            <option value="">Todos os clientes</option>
            {clients.options.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <select name="canal" defaultValue={canal} aria-label="Canal" className="input w-auto">
          <option value="">Todos os canais</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="instagram">Instagram</option>
          <option value="widget">Site</option>
        </select>
        {tags.length > 0 && (
          <select name="etiqueta" defaultValue={etiqueta} aria-label="Etiqueta" className="input w-auto">
            <option value="">Todas as etiquetas</option>
            {tags.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        <button type="submit" className="btn-ghost">Filtrar</button>
        {filtered && <Link href={`${basePath}${Object.keys(hidden).length ? `?${new URLSearchParams(hidden)}` : ""}`} className="btn-ghost text-muted">Limpar</Link>}
      </form>
      {importSlot}
      </div>

      <div className="card overflow-hidden">
        {rows.length === 0 && <p className="p-6 text-sm text-muted">{filtered ? "Nenhum contato com esse filtro." : emptyText}</p>}
        {rows.map((c, k) => {
          const state = c.channel === "whatsapp" ? consent.get(c.id) ?? "none" : null;
          const title = c.name ?? (c.phone ? `+${c.phone}` : c.instagram ? `Instagram ${c.instagram}` : "Sem nome");
          const bot = bots.get(c.bot_id);
          const href = contactHref(c);
          const inner = (
            <>
              <ContactAvatar name={title} photo={c.photo} channel={c.channel} size={36} />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate font-medium text-ink">{title}</span>
                <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted">
                  <span className="shrink-0 rounded-md px-1.5 py-px text-[11px] shadow-[inset_0_0_0_1px_var(--color-line-strong)]">{CHANNEL_LABEL[c.channel] ?? c.channel}</span>
                  {c.name && c.phone && <span className="font-mono text-[11.5px]">+{c.phone}</span>}
                  {bot && (
                    <span className="flex min-w-0 items-center gap-1">
                      <BotFace color={bot.color} face={bot.face} size={14} />
                      <span className="truncate">{bot.client ? `${bot.client} · ${bot.name}` : bot.name}</span>
                    </span>
                  )}
                </span>
              </span>
              {c.tags.length > 0 && (
                <span className="hidden flex-wrap gap-1 md:flex">
                  {c.tags.slice(0, 3).map((t) => <span key={t} className="rounded-full bg-raised px-2 py-0.5 text-[11.5px] text-ink-2">{t}</span>)}
                  {c.tags.length > 3 && <span className="text-[11.5px] text-muted">+{c.tags.length - 3}</span>}
                </span>
              )}
              {state && (
                <span className={`hidden shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-medium sm:inline ${state === "granted" ? "bg-brand-soft text-brand" : "bg-raised text-muted"}`}>
                  Novidades: {CONSENT_LABEL[state]}
                </span>
              )}
              <span className="w-[86px] shrink-0 text-right text-[12px] text-muted">{c.last_inbound_at ? relativeTime(c.last_inbound_at) : "não escreveu"}</span>
            </>
          );
          const cls = "flex items-center gap-3 border-b border-line-2 px-4 py-3 text-sm last:border-0";
          return href ? (
            <Link key={c.id} href={href} className={`${cls} transition-colors duration-[120ms] hover:bg-raised/50`} style={{ animation: `rise-in var(--dur-base) var(--ease-out) ${Math.min(k, 12) * 20}ms both` }}>{inner}</Link>
          ) : (
            <div key={c.id} className={cls}>{inner}</div>
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
