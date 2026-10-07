import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAgency } from "@/lib/agency";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { can } from "@/lib/team";
import { contactForPanel } from "@/lib/contacts";
import { CONSENT_LABEL, SOURCE_LABEL, consentHistory, consentStateOf } from "@/lib/marketing-consent";
import { activeSuppressions, suppressionScope } from "@/lib/suppression";
import { relativeTime } from "@/lib/utils";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { recordContactConsent, revokeContactConsent, saveContactTags } from "../../../../actions";

export const metadata = { title: "Contato" };

const CHANNEL_LABEL: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram", widget: "Site" };
const when = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

/**
 * Cliente → Contatos → um contato (leva B3): canal, etiquetas, o histórico de novidades com a prova
 * (origem, data, texto aceito e revogação) e as conversas. A agência registra pelo painel um aceite
 * coletado fora do chat; ele não desfaz um SAIR.
 */
export default async function ContactPage({ params }: PageProps<"/painel/clientes/[id]/contatos/[contactId]">) {
  const [{ id, contactId }, { role }] = await Promise.all([params, requireAgency()]);
  if (!can(role, "config")) notFound();
  const supabase = await createClient();
  // a RLS limita os chatbots ao cliente e ao escopo de quem está logado
  const [{ data: client }, { data: bots }] = await Promise.all([
    supabase.from("clients").select("id, name").eq("id", id).maybeSingle(),
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
  const { data: conversations } = await supabase.from("conversations").select("id, bot_id, started_at, last_message_at, message_count, channel").eq("contact_id", contactId).order("last_message_at", { ascending: false }).limit(20);
  const title = contact.name ?? (contact.phone ? `+${contact.phone}` : contact.instagram ? `Instagram ${contact.instagram}` : "Sem nome");
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

  return (
    <div className="flex max-w-[860px] flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Link href={`/painel/clientes/${id}?tab=contatos`} className="text-sm font-semibold text-muted">← Contatos de {client.name}</Link>
        <h1 className="text-2xl font-bold sm:text-[28px]">{title}</h1>
        <p className="text-sm text-muted">
          {[CHANNEL_LABEL[contact.channel] ?? contact.channel, contact.name && contact.phone ? `+${contact.phone}` : null, contact.email, botName ? `chatbot ${botName}` : null].filter(Boolean).join(" · ")}
        </p>
        <p className="text-xs text-muted">
          {contact.first_inbound_at ? `Primeira mensagem ${when(contact.first_inbound_at)}` : "Ainda não escreveu"}
          {contact.last_inbound_at ? ` · última ${relativeTime(contact.last_inbound_at)}` : ""}
        </p>
      </div>

      <ActionForm action={saveContactTags.bind(null, id, contactId)} className="card flex flex-col gap-2 p-5">
        <h2 className="font-semibold">Etiquetas</h2>
        <p className="text-xs text-muted">Separadas por vírgula (ex.: cliente vip, pizza, zona sul). Servem para filtrar a lista e, depois, escolher o público das campanhas.</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label htmlFor="contato-tags" className="sr-only">Etiquetas</label>
          <input id="contato-tags" name="tags" defaultValue={contact.tags.join(", ")} maxLength={700} className="input" placeholder="sem etiquetas" />
          <SubmitButton className="btn-primary shrink-0">Salvar</SubmitButton>
        </div>
      </ActionForm>

      {contact.channel === "whatsapp" && (
        <section className="card flex flex-col gap-3 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">Novidades e promoções (WhatsApp)</h2>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${state === "granted" ? "bg-brand-soft text-brand" : "bg-ground text-muted"}`}>{CONSENT_LABEL[state]}</span>
          </div>
          {suppressed && (
            <p className="rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink">
              Este contato pediu para não receber promoções (SAIR ou pelo próprio WhatsApp). Um aceite registrado pelo painel fica guardado, mas só vale depois que a própria pessoa aceitar de novo pelo chat.
            </p>
          )}
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
          {state === "granted" && (
            <ConfirmAction action={revokeContactConsent.bind(null, id, contactId)} title="Revogar o aceite de novidades?" description="O contato deixa de receber promoções deste cliente. O registro do aceite e da revogação fica guardado como prova." confirmLabel="Revogar" className="btn-ghost self-start">
              Revogar aceite
            </ConfirmAction>
          )}
          {number && state !== "granted" && (
            <details className="rounded-xl border border-line p-3">
              <summary className="cursor-pointer text-sm font-semibold">Registrar um aceite coletado fora do chat</summary>
              <ActionForm action={recordContactConsent.bind(null, id, contactId)} className="mt-3 flex flex-col gap-3">
                <p className="text-xs text-muted">Use quando a pessoa aceitou receber promoções por WhatsApp em outro lugar (cadastro, formulário do site, contrato). A empresa responde pela prova desse aceite.</p>
                <div>
                  <label htmlFor="consent-origem" className="label">Onde a pessoa aceitou</label>
                  <input id="consent-origem" name="origem" required minLength={5} maxLength={200} className="input" placeholder="Ex.: cadastro no balcão da loja" />
                </div>
                <div>
                  <label htmlFor="consent-data" className="label">Data do aceite</label>
                  <input id="consent-data" name="data" type="date" required max={today} className="input max-w-[200px]" />
                </div>
                <div>
                  <label htmlFor="consent-texto" className="label">Texto que a pessoa aceitou</label>
                  <textarea id="consent-texto" name="texto" required minLength={10} maxLength={600} rows={3} className="input" placeholder="Ex.: Aceito receber novidades e promoções da Pizzaria do Zé pelo WhatsApp." />
                </div>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="confirm" required className="mt-1" />
                  <span>A empresa coletou este aceite e consegue prová-lo se a pessoa ou a Meta pedirem.</span>
                </label>
                <SubmitButton className="btn-primary self-start">Registrar aceite</SubmitButton>
              </ActionForm>
            </details>
          )}
        </section>
      )}

      <section className="card overflow-hidden">
        <h2 className="px-5 pt-4 font-semibold">Conversas</h2>
        {(conversations ?? []).length === 0 && <p className="px-5 py-4 text-sm text-muted">Nenhuma conversa guardada (as antigas podem ter sido apagadas pelo prazo de guarda).</p>}
        <div className="mt-2">
          {(conversations ?? []).map((c) => (
            <Link key={c.id as string} href={`/painel/bots/${c.bot_id as string}/conversas/${c.id as string}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line-2 px-5 py-3 text-sm hover:bg-ground">
              <span className="text-muted">{relativeTime(c.started_at as string)}</span>
              <span>{c.message_count as number} mensagens</span>
              <span className="text-xs text-muted">{CHANNEL_LABEL[c.channel as string] ?? (c.channel as string)}</span>
              <span className="ml-auto text-xs text-muted">última {relativeTime(c.last_message_at as string)}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
