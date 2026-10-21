import Link from "next/link";
import { CONSENT_LABEL, SOURCE_LABEL } from "@/lib/marketing-consent";
import { contactTitle, type InboxContactData } from "@/lib/inbox-contact";
import { birthdayLabel } from "@/lib/contact-import";
import { relativeTime } from "@/lib/utils";

const CHANNEL: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram", widget: "Site" };
const when = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">{label}</dt>
      <dd className="break-words text-sm">{children}</dd>
    </div>
  );
}

/**
 * O painel do contato na Caixa de entrada (parte 3): dados, etiquetas, novidades, vínculos e as
 * outras conversas. Só leitura; `contactHref` (quem pode editar) leva à página do contato.
 */
export function InboxContact({ data, botName, conversationHref, contactHref }: { data: InboxContactData | null; botName?: (botId: string) => string | undefined; conversationHref: (botId: string, convId: string) => string; contactHref?: string | null }) {
  if (!data) return <p className="p-4 text-sm text-muted">Sem cadastro de contato nesta conversa (visitante do site sem identificação). O que a pessoa deixou aparece na conversa.</p>;
  const { contact: c, consent, links, history } = data;
  const dates = [
    c.birthday ? `aniversário ${birthdayLabel(c.birthday)}` : null,
    c.last_visit_at ? `última visita ${new Date(c.last_visit_at).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : null,
    c.appointment_at ? `horário marcado ${when(c.appointment_at)}` : null,
  ].filter(Boolean);
  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <p className="font-semibold">{contactTitle(c)}</p>
        <p className="text-xs text-muted">{[CHANNEL[c.channel] ?? c.channel, botName?.(c.bot_id)].filter(Boolean).join(" · ")}</p>
        {contactHref && <Link href={contactHref} className="text-xs font-semibold text-brand hover:underline">Abrir o contato</Link>}
      </div>
      <dl className="flex flex-col gap-2.5">
        {c.phone && <Row label="Telefone">+{c.phone}</Row>}
        {c.email && <Row label="E-mail">{c.email}</Row>}
        {c.instagram && <Row label="Instagram">{c.instagram}</Row>}
        <Row label="Mensagens">{c.first_inbound_at ? `primeira ${when(c.first_inbound_at)}` : "ainda não escreveu"}{c.last_inbound_at ? ` · última ${relativeTime(c.last_inbound_at)}` : ""}</Row>
        <Row label="Etiquetas">
          {c.tags.length ? (
            <span className="mt-0.5 flex flex-wrap gap-1">
              {c.tags.map((t) => <span key={t} className="rounded-full bg-ground px-2 py-0.5 text-xs">{t}</span>)}
            </span>
          ) : <span className="text-muted">sem etiquetas</span>}
        </Row>
        {dates.length > 0 && <Row label="Datas das réguas">{dates.join(" · ")}</Row>}
        {c.channel === "whatsapp" && (
          <Row label="Novidades">
            {consent ? <>{CONSENT_LABEL[consent.state]} <span className="text-xs text-muted">({SOURCE_LABEL[consent.last.source]}, {when(consent.last.revoked_at ?? consent.last.collected_at)})</span></> : <span className="text-muted">sem resposta</span>}
          </Row>
        )}
        {data.memory.length > 0 && (
          <Row label="O assistente lembra">
            <ul className="flex list-disc flex-col gap-0.5 pl-4">
              {data.memory.map((f) => <li key={f}>{f}</li>)}
            </ul>
          </Row>
        )}
        {links.length > 0 && (
          <Row label="Vínculos">
            <ul className="flex flex-col gap-0.5">
              {links.map((l) => <li key={l.id}>{l.label} <span className="text-xs text-muted">· {l.routine ? "número lembrado pelo roteiro" : "pareado pela empresa"}, {relativeTime(l.linkedAt)}</span></li>)}
            </ul>
          </Row>
        )}
      </dl>
      <div className="flex flex-col gap-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">Outras conversas</p>
        {history.length === 0 && <p className="text-sm text-muted">Nenhuma outra guardada.</p>}
        {history.map((h) => (
          <Link key={h.id} href={conversationHref(h.botId, h.id)} className="flex items-center gap-2 rounded-lg px-1 py-1 text-sm hover:bg-ground">
            <span>{relativeTime(h.startedAt)}</span>
            <span className="text-xs text-muted">{h.messages} mensagens · {CHANNEL[h.channel] ?? h.channel}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
