import Link from "next/link";
import { backFrom, withFrom } from "@/lib/back-link";
import { notFound } from "next/navigation";
import { requireAgency } from "@/lib/agency";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { can } from "@/lib/team";
import { contactForPanel, contactMemory } from "@/lib/contacts";
import { CONSENT_LABEL, SOURCE_LABEL, consentHistory, consentStateOf } from "@/lib/marketing-consent";
import { activeSuppressions, suppressionScope } from "@/lib/suppression";
import { relativeTime } from "@/lib/utils";
import { birthdayLabel } from "@/lib/contact-import";
import { CLIENT_TIMEZONES, DEFAULT_TIMEZONE, isoToLocalInput } from "@/lib/timezone";
import { Brain, CalendarDays, ChevronRight, FileCheck2, Megaphone, MessagesSquare, StickyNote, Tags } from "lucide-react";
import { listContactNotes } from "@/lib/conversation-notes";
import { listDateFields } from "@/lib/contact-date-fields";
import { dateLabelOf } from "@/lib/reguas";
import { NOTE_MAX } from "@/lib/note-text";
import { ContactAvatar } from "@/components/contact-avatar";
import { TagsField } from "@/components/tags-field";
import { SettingGroup, SettingRow } from "@/components/ui/setting-row";
import { StatusPill } from "@/components/ui/form-section";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { addConversationNote, clearContactMemoryAction, recordContactConsent, revokeContactConsent, saveContactDates, saveContactTags } from "../../../../actions";

export const metadata = { title: "Contato" };

const CHANNEL_LABEL: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram", widget: "Site" };
const when = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

/**
 * Cliente → Contatos → um contato (leva B3): canal, etiquetas, o histórico de novidades com a prova
 * (origem, data, texto aceito e revogação) e as conversas. A agência registra pelo painel um aceite
 * coletado fora do chat; ele não desfaz um SAIR. As datas das réguas (leva Réguas, parte 1), só no
 * WhatsApp: o aniversário, a última visita e o próximo horário, no fuso do cliente.
 */
export default async function ContactPage({ params, searchParams }: PageProps<"/painel/clientes/[id]/contatos/[contactId]">) {
  const [{ id, contactId }, sp, { role }] = await Promise.all([params, searchParams, requireAgency()]);
  // de onde a pessoa veio (Caixa, Contatos e leads…): o "←" volta para lá
  const back = backFrom(sp.de);
  if (!can(role, "config")) notFound();
  const supabase = await createClient();
  // a RLS limita os chatbots ao cliente e ao escopo de quem está logado
  const [{ data: client }, { data: bots }] = await Promise.all([
    supabase.from("clients").select("id, name, timezone").eq("id", id).maybeSingle(),
    supabase.from("bots").select("id, name").eq("client_id", id).eq("is_demo", false),
  ]);
  if (!client) notFound();
  const botIds = (bots ?? []).map((b) => b.id as string);
  const db = createAdminClient();
  const contact = await contactForPanel(db, contactId, botIds);
  if (!contact) notFound();
  const botName = (bots ?? []).find((b) => b.id === contact.bot_id)?.name as string | undefined;

  const number = contact.channel === "whatsapp" ? contact.phone ?? contact.bsuid : null;
  let history: Awaited<ReturnType<typeof consentHistory>> = [];
  let suppressed = false;
  if (number) {
    const { data: wa } = await db.from("whatsapp_channels").select("waba_id").eq("bot_id", contact.bot_id).maybeSingle();
    const scope = suppressionScope({ wabaId: (wa?.waba_id as string | null | undefined) ?? null, botId: contact.bot_id });
    [history, suppressed] = await Promise.all([
      consentHistory(db, { scope, contact: number }),
      activeSuppressions(db, { channel: "whatsapp", scope, contact: number }).then((s) => s.some((x) => x.kind !== "utility")),
    ]);
  }
  const state = consentStateOf(history);
  // memória do assistente (leva Memória e avisos, parte 1): o que a IA lembra desta pessoa neste chatbot
  const memory = await contactMemory(db, contactId).catch(() => [] as string[]);
  const { data: conversations } = await supabase.from("conversations").select("id, bot_id, started_at, last_message_at, message_count, channel").eq("contact_id", contactId).order("last_message_at", { ascending: false }).limit(20);
  // notas internas das conversas desta pessoa (rodada 2 das telas, 23/10): a nova vai para a conversa mais recente
  const notes = await listContactNotes(db, (conversations ?? []).map((c) => c.id as string)).catch(() => []);
  const latestConv = (conversations ?? [])[0]?.id as string | undefined;
  const convStart = new Map((conversations ?? []).map((c) => [c.id as string, c.started_at as string]));
  const title = contact.name ?? (contact.phone ? `+${contact.phone}` : contact.instagram ? `Instagram ${contact.instagram}` : "Sem nome");
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const tz = (client.timezone as string | null) ?? DEFAULT_TIMEZONE;
  const tzLabel = CLIENT_TIMEZONES.find((t) => t.id === tz)?.label ?? "Brasília";

  // as datas novas das réguas personalizadas do chatbot do contato
  const dateFields = contact.channel === "whatsapp" ? await listDateFields(db, [contact.bot_id]).catch(() => []) : [];
  const dates = [
    contact.birthday ? `aniversário ${birthdayLabel(contact.birthday)}` : null,
    contact.last_visit_at ? `última visita ${new Date(contact.last_visit_at).toLocaleDateString("pt-BR", { timeZone: tz })}` : null,
    contact.appointment_at ? `horário ${new Date(contact.appointment_at).toLocaleString("pt-BR", { timeZone: tz, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : null,
    ...dateFields.map((f) => (contact.custom_dates[f.key] ? `${f.label.toLowerCase()} ${dateLabelOf(contact.custom_dates[f.key], true)}` : null)),
  ].filter(Boolean);
  const here = `/painel/clientes/${id}/contatos/${contactId}`;

  // redesenho (23/10/2026, a pedido do usuário: "muito scroll e fora do padrão"): o cabeçalho com a
  // foto e as pílulas, e cada bloco numa linha que abre um modal
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <Link href={back?.href ?? `/painel/clientes/${id}?tab=contatos`} className="text-sm font-medium text-muted hover:text-ink">
          ← {back?.label ?? `Contatos de ${client.name}`}
        </Link>
        <div className="flex items-center gap-4">
          <ContactAvatar name={title} photo={contact.photo} channel={contact.channel} size={56} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-normal sm:text-[28px]">{title}</h1>
            <p className="truncate text-sm text-muted">{[CHANNEL_LABEL[contact.channel] ?? contact.channel, contact.name && contact.phone ? `+${contact.phone}` : null, contact.email, botName ? `chatbot ${botName}` : null].filter(Boolean).join(" · ")}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusPill>{contact.first_inbound_at ? `primeira mensagem ${when(contact.first_inbound_at)}` : "ainda não escreveu"}</StatusPill>
          {contact.last_inbound_at && <StatusPill>última {relativeTime(contact.last_inbound_at)}</StatusPill>}
          {contact.channel === "whatsapp" && <StatusPill tone={state === "granted" ? "ok" : "muted"}>novidades: {CONSENT_LABEL[state].toLowerCase()}</StatusPill>}
          {suppressed && <StatusPill tone="warn">pediu para sair</StatusPill>}
        </div>
      </div>

      <SettingGroup title="Contato">
        <SettingRow icon={<Tags size={18} />} title="Etiquetas" summary={contact.tags.length ? contact.tags.join(", ") : "Sem etiquetas"} description="Servem para filtrar a lista e escolher o público das campanhas." action={saveContactTags.bind(null, id, contactId)}>
          <TagsField name="tags" initial={contact.tags} />
        </SettingRow>
        {contact.channel === "whatsapp" && (
          <SettingRow
            icon={<CalendarDays size={18} />}
            title="Datas para as réguas"
            summary={dates.length ? dates.join(" · ") : "Nenhuma data"}
            description="As mensagens automáticas do WhatsApp usam estas datas. Também vêm da planilha de contatos e da API. Campo vazio apaga a data."
            action={saveContactDates.bind(null, id, contactId)}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="contato-aniversario" className="label">
                  Aniversário (dia/mês)
                </label>
                <input id="contato-aniversario" name="birthday" defaultValue={birthdayLabel(contact.birthday)} maxLength={10} placeholder="21/10" className="input" />
              </div>
              <div>
                <label htmlFor="contato-visita" className="label">
                  Última visita ou compra
                </label>
                <input id="contato-visita" name="last_visit" type="date" max={today} defaultValue={contact.last_visit_at ? new Date(contact.last_visit_at).toLocaleDateString("en-CA", { timeZone: tz }) : ""} className="input" />
              </div>
            </div>
            <div>
              <label htmlFor="contato-horario" className="label">
                Próximo horário ({tzLabel})
              </label>
              <input id="contato-horario" name="appointment" type="datetime-local" defaultValue={contact.appointment_at ? isoToLocalInput(contact.appointment_at, tz) : ""} className="input" />
            </div>
            {dateFields.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2">
                {dateFields.map((f) => (
                  <div key={f.id}>
                    <label htmlFor={`contato-data-${f.key}`} className="label">
                      {f.label}
                    </label>
                    <input id={`contato-data-${f.key}`} name={`custom_${f.key}`} type="date" defaultValue={contact.custom_dates[f.key] ?? ""} className="input" />
                  </div>
                ))}
              </div>
            )}
          </SettingRow>
        )}
        {memory.length > 0 && (
          <SettingRow
            icon={<Brain size={18} />}
            title="Memória do assistente"
            summary={`${memory.length} ${memory.length === 1 ? "coisa que ele lembra" : "coisas que ele lembra"}: ${memory[0]}`}
            description="O que o assistente lembra desta pessoa de conversas anteriores, só neste chatbot. Vale 180 dias desde a última atualização; a pessoa também pode pedir para ele esquecer."
            footer="close"
            footerStart={
              <ConfirmAction action={clearContactMemoryAction.bind(null, id, contactId)} title="Apagar a memória do assistente?" description="O assistente deixa de lembrar desta pessoa. Nas próximas conversas, ele pode aprender de novo (com a memória ligada no chatbot)." confirmLabel="Apagar" className="text-sm font-medium text-danger hover:underline">
                Apagar a memória
              </ConfirmAction>
            }
          >
            <ul className="flex flex-col gap-1.5 rounded-[12px] bg-brand-soft p-3 text-sm text-ink">
              {memory.map((f) => (
                <li key={f} className="flex gap-2">
                  <Brain size={13} className="mt-1 shrink-0 text-brand" aria-hidden />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </SettingRow>
        )}
      </SettingGroup>

      <SettingGroup title="Equipe">
        <SettingRow
          icon={<StickyNote size={18} />}
          title="Notas internas"
          badge={notes.length ? <StatusPill>{notes.length}</StatusPill> : undefined}
          summary={notes[0]?.body ? `A última, de ${notes[0].authorName}: ${notes[0].body}` : "Nenhuma nota nas conversas desta pessoa"}
          description={latestConv ? "Só a equipe vê. Cada nota fica na conversa em que foi escrita; a nova vai para a conversa mais recente." : "Só a equipe vê. As notas ficam nas conversas: esta pessoa ainda não tem conversa guardada."}
          dialogTitle="Notas internas"
          action={latestConv && can(role, "attend") ? addConversationNote.bind(null, latestConv) : undefined}
          saveLabel="Gravar a nota"
          footer={latestConv && can(role, "attend") ? "save" : "close"}
        >
          {notes.length > 0 && (
            <ul className="flex max-h-[40vh] flex-col gap-1.5 overflow-y-auto">
              {notes.map((n) => (
                <li key={n.id} className="rounded-[12px] bg-amber-soft/60 px-3 py-2 text-[13px] text-ink shadow-[inset_0_0_0_1px_var(--color-amber-line)]">
                  <span className="block text-[11.5px] text-muted">
                    {n.authorName} · {relativeTime(n.createdAt)}
                    {convStart.get(n.conversationId) ? ` · na conversa de ${new Date(convStart.get(n.conversationId)!).toLocaleDateString("pt-BR", { timeZone: tz })}` : ""}
                  </span>
                  {n.body && <span className="mt-0.5 block whitespace-pre-wrap break-words">{n.body}</span>}
                </li>
              ))}
            </ul>
          )}
          {latestConv && can(role, "attend") && (
            <div>
              <label htmlFor="contato-nota" className="label">
                Nova nota
              </label>
              <textarea id="contato-nota" name="nota" required rows={3} maxLength={NOTE_MAX} className="input" placeholder="Ex.: prefere ser chamada pelo WhatsApp depois das 18h" />
            </div>
          )}
        </SettingRow>
      </SettingGroup>

      {contact.channel === "whatsapp" && (
        <SettingGroup title="Novidades e promoções (WhatsApp)">
          <SettingRow
            icon={<Megaphone size={18} />}
            title="Aceite de novidades"
            badge={<StatusPill tone={state === "granted" ? "ok" : "muted"}>{CONSENT_LABEL[state]}</StatusPill>}
            summary={history[0] ? `${history[0].granted ? "Aceitou" : "Recusou"} ${SOURCE_LABEL[history[0].source]}, ${when(history[0].collected_at)}` : contact.marketing_offer_at ? `O assistente ofereceu em ${when(contact.marketing_offer_at)}; sem resposta` : "Nenhuma resposta ainda"}
            dialogTitle="O histórico das novidades"
            footer="close"
            footerStart={
              state === "granted" ? (
                <ConfirmAction action={revokeContactConsent.bind(null, id, contactId)} title="Revogar o aceite de novidades?" description="O contato deixa de receber promoções deste cliente. O registro do aceite e da revogação fica guardado como prova." confirmLabel="Revogar" className="text-sm font-medium text-danger hover:underline">
                  Revogar o aceite
                </ConfirmAction>
              ) : undefined
            }
          >
            {suppressed && <p className="rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink">Este contato pediu para não receber promoções (SAIR ou pelo próprio WhatsApp). Um aceite registrado pelo painel fica guardado, mas só vale depois que a própria pessoa aceitar de novo pelo chat.</p>}
            {contact.marketing_offer_at && <p className="text-xs text-muted">O assistente ofereceu novidades em {when(contact.marketing_offer_at)}.</p>}
            {history.length > 0 ? (
              <ul className="flex flex-col divide-y divide-line-2 text-sm">
                {history.map((h) => (
                  <li key={h.id} className="flex flex-col gap-0.5 py-2">
                    <span>
                      <strong>{h.granted ? "Aceitou" : "Recusou"}</strong> {SOURCE_LABEL[h.source]} · {when(h.collected_at)}
                      {h.collected_by ? <span className="text-muted"> · registrado por {h.collected_by}</span> : null}
                    </span>
                    <span className="text-xs text-ink-2">{h.text}</span>
                    {h.revoked_at && <span className="text-xs text-muted">Revogado {when(h.revoked_at)}{h.revoke_source ? ` (${h.revoke_source.startsWith("chat") ? "pelo contato no chat" : h.revoke_source.startsWith("meta") ? "pelo WhatsApp" : "pelo painel"})` : ""}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Nenhuma resposta ainda.</p>
            )}
          </SettingRow>
          {number && state !== "granted" && (
            <SettingRow icon={<FileCheck2 size={18} />} title="Registrar um aceite coletado fora do chat" summary="Cadastro, formulário do site ou contrato" description="Use quando a pessoa aceitou receber promoções por WhatsApp em outro lugar. A empresa responde pela prova desse aceite." action={recordContactConsent.bind(null, id, contactId)} saveLabel="Registrar aceite">
              <div>
                <label htmlFor="consent-origem" className="label">
                  Onde a pessoa aceitou
                </label>
                <input id="consent-origem" name="origem" required minLength={5} maxLength={200} className="input" placeholder="Ex.: cadastro no balcão da loja" />
              </div>
              <div>
                <label htmlFor="consent-data" className="label">
                  Data do aceite
                </label>
                <input id="consent-data" name="data" type="date" required max={today} className="input max-w-[200px]" />
              </div>
              <div>
                <label htmlFor="consent-texto" className="label">
                  Texto que a pessoa aceitou
                </label>
                <textarea id="consent-texto" name="texto" required minLength={10} maxLength={600} rows={3} className="input" placeholder="Ex.: Aceito receber novidades e promoções da Pizzaria do Zé pelo WhatsApp." />
              </div>
              <label className="flex items-start gap-2.5 rounded-[12px] bg-raised p-3 text-sm">
                <input type="checkbox" name="confirm" required className="mt-0.5 accent-brand" />
                <span>A empresa coletou este aceite e consegue prová-lo se a pessoa ou a Meta pedirem.</span>
              </label>
            </SettingRow>
          )}
        </SettingGroup>
      )}

      <SettingGroup title={`Conversas · ${(conversations ?? []).length}`}>
        {(conversations ?? []).length === 0 && <p className="px-4 py-5 text-sm text-muted">Nenhuma conversa guardada (as antigas podem ter sido apagadas pelo prazo de guarda).</p>}
        {(conversations ?? []).map((c) => (
          <Link key={c.id as string} href={withFrom(`/painel/bots/${c.bot_id as string}/conversas/${c.id as string}`, here)} className="group/set flex items-center gap-3 px-4 py-3.5 transition-colors duration-[120ms] hover:bg-raised/40">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-raised text-ink-2">
              <MessagesSquare size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium text-ink">Começou {relativeTime(c.started_at as string)}</span>
              <span className="mt-0.5 block text-[12.5px] text-muted">
                {c.message_count as number} mensagens · {CHANNEL_LABEL[c.channel as string] ?? (c.channel as string)} · última {relativeTime(c.last_message_at as string)}
              </span>
            </span>
            <ChevronRight size={16} className="shrink-0 text-muted transition-transform duration-[120ms] group-hover/set:translate-x-0.5" />
          </Link>
        ))}
      </SettingGroup>
    </div>
  );
}
