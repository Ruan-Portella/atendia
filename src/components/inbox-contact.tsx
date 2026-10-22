import Link from "next/link";
import { ArrowUpRight, Brain } from "lucide-react";
import { CONSENT_LABEL, SOURCE_LABEL } from "@/lib/marketing-consent";
import { contactTitle, type InboxContactData } from "@/lib/inbox-contact";
import { birthdayLabel } from "@/lib/contact-import";
import { initials, relativeTime } from "@/lib/utils";

const CHANNEL: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram", widget: "Site" };
const when = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted">{label}</h3>
      <div className="break-words text-sm text-ink-2">{children}</div>
    </section>
  );
}

/**
 * O painel do contato na Caixa de entrada (parte 3; redesenho, etapa 2): quem é, como falar, as
 * etiquetas, o que o assistente lembra, as datas das réguas, as novidades, os vínculos e as outras
 * conversas. Só leitura; `contactHref` (quem pode editar) leva à página do contato.
 */
export function InboxContact({ data, botName, conversationHref, contactHref }: { data: InboxContactData | null; botName?: (botId: string) => string | undefined; conversationHref: (botId: string, convId: string) => string; contactHref?: string | null }) {
  if (!data) return <p className="p-5 text-sm text-muted">Sem cadastro de contato nesta conversa (visitante do site sem identificação). O que a pessoa deixou aparece na conversa.</p>;
  const { contact: c, consent, links, history } = data;
  const title = contactTitle(c);
  const dates = [
    c.birthday ? `aniversário ${birthdayLabel(c.birthday)}` : null,
    c.last_visit_at ? `última visita ${new Date(c.last_visit_at).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : null,
    c.appointment_at ? `horário marcado ${when(c.appointment_at)}` : null,
  ].filter(Boolean);
  return (
    <div className="flex flex-col gap-5 p-5">
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-raised text-base font-semibold text-ink shadow-[inset_0_0_0_1px_var(--color-line)]">{initials(title) || "?"}</span>
        <div>
          <p className="font-medium text-ink">{title}</p>
          <p className="text-[12.5px] text-muted">{[CHANNEL[c.channel] ?? c.channel, botName?.(c.bot_id)].filter(Boolean).join(" · ")}</p>
        </div>
        {contactHref && (
          <Link href={contactHref} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-brand hover:text-brand-2">
            Abrir o contato
            <ArrowUpRight size={13} />
          </Link>
        )}
      </div>

      {(c.phone || c.email || c.instagram) && (
        <Section label="Como falar">
          <div className="flex flex-col gap-0.5">
            {c.phone && <span className="font-mono text-[13px] text-ink">+{c.phone}</span>}
            {c.email && <span>{c.email}</span>}
            {c.instagram && <span>{c.instagram}</span>}
          </div>
        </Section>
      )}

      <Section label="Etiquetas">
        {c.tags.length ? (
          <span className="flex flex-wrap gap-1.5">
            {c.tags.map((t) => <span key={t} className="rounded-full bg-raised px-2.5 py-0.5 text-[12px] text-ink-2">{t}</span>)}
          </span>
        ) : <span className="text-muted">sem etiquetas</span>}
      </Section>

      {data.memory.length > 0 && (
        <Section label="O que o assistente lembra">
          <ul className="flex flex-col gap-1.5 rounded-[12px] bg-brand-soft p-3 text-[13px] text-ink">
            {data.memory.map((f) => (
              <li key={f} className="flex gap-2">
                <Brain size={13} className="mt-0.5 shrink-0 text-brand" aria-hidden />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section label="Mensagens">
        {c.first_inbound_at ? `primeira ${when(c.first_inbound_at)}` : "ainda não escreveu"}
        {c.last_inbound_at ? ` · última ${relativeTime(c.last_inbound_at)}` : ""}
      </Section>

      {dates.length > 0 && <Section label="Datas das réguas">{dates.join(" · ")}</Section>}

      {c.channel === "whatsapp" && (
        <Section label="Novidades">
          {consent ? <>{CONSENT_LABEL[consent.state]} <span className="text-[12px] text-muted">({SOURCE_LABEL[consent.last.source]}, {when(consent.last.revoked_at ?? consent.last.collected_at)})</span></> : <span className="text-muted">sem resposta</span>}
        </Section>
      )}

      {links.length > 0 && (
        <Section label="Vínculos">
          <ul className="flex flex-col gap-1">
            {links.map((l) => <li key={l.id}>{l.label} <span className="text-[12px] text-muted">· {l.routine ? "número lembrado pelo roteiro" : "pareado pela empresa"}, {relativeTime(l.linkedAt)}</span></li>)}
          </ul>
        </Section>
      )}

      <Section label="Outras conversas">
        {history.length === 0 && <span className="text-muted">Nenhuma outra guardada.</span>}
        <div className="-mx-2 flex flex-col">
          {history.map((h) => (
            <Link key={h.id} href={conversationHref(h.botId, h.id)} className="flex items-center gap-2 rounded-[10px] px-2 py-1.5 transition-colors duration-[120ms] hover:bg-raised">
              <span className="text-ink">{relativeTime(h.startedAt)}</span>
              <span className="text-[12px] text-muted">{h.messages} mensagens · {CHANNEL[h.channel] ?? h.channel}</span>
            </Link>
          ))}
        </div>
      </Section>
    </div>
  );
}
