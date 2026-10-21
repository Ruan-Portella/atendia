import type { SupabaseClient } from "@supabase/supabase-js";
import { contactForPanel, type ContactPanelRow } from "./contacts";
import { consentHistory, consentStateOf, type ConsentRow, type ConsentState } from "./marketing-consent";
import { suppressionScope } from "./suppression";
import { activeLinks, isPairingLink, linkLabel } from "./pairing";

/*
 * O painel do contato na Caixa de entrada (parte 3; Telas, seção 6): os dados, as etiquetas, as
 * novidades do WhatsApp, os vínculos com contas da empresa e as outras conversas, ao lado da
 * conversa aberta. Só leitura: editar fica na página do contato.
 */

export interface InboxContactData {
  contact: ContactPanelRow;
  consent: { state: ConsentState; last: ConsentRow } | null;
  links: Array<{ id: string; label: string; routine: boolean; linkedAt: string }>;
  history: Array<{ id: string; botId: string; channel: string; startedAt: string; lastMessageAt: string; messages: number }>;
}

const HISTORY = 5;

/** Os dados do painel (service role; só contato e conversas dos chatbots informados). */
export async function loadInboxContact(db: SupabaseClient, o: { contactId: string; botIds: string[]; conversationId: string }): Promise<InboxContactData | null> {
  const contact = await contactForPanel(db, o.contactId, o.botIds);
  if (!contact) return null;
  const number = contact.channel === "whatsapp" ? contact.phone ?? contact.bsuid : null;
  const [consent, links, { data: convs }] = await Promise.all([
    number
      ? (async () => {
          const { data: wa } = await db.from("whatsapp_channels").select("waba_id").eq("bot_id", contact.bot_id).maybeSingle();
          const rows = await consentHistory(db, { scope: suppressionScope({ wabaId: (wa?.waba_id as string | null | undefined) ?? null, botId: contact.bot_id }), contact: number });
          return rows[0] ? { state: consentStateOf(rows), last: rows[0] } : null;
        })().catch(() => null)
      : Promise.resolve(null),
    activeLinks(db, o.contactId).catch(() => []),
    db
      .from("conversations")
      .select("id, bot_id, channel, started_at, last_message_at, message_count")
      .eq("contact_id", o.contactId)
      .in("bot_id", o.botIds)
      .neq("id", o.conversationId)
      .order("last_message_at", { ascending: false })
      .limit(HISTORY),
  ]);
  return {
    contact,
    consent,
    links: links.map((l) => ({ id: l.id, label: linkLabel(l.display, { byName: !isPairingLink(l) }), routine: !isPairingLink(l), linkedAt: l.linked_at })),
    history: (convs ?? []).map((c) => ({
      id: c.id as string,
      botId: c.bot_id as string,
      channel: (c.channel as string | null) ?? "widget",
      startedAt: c.started_at as string,
      lastMessageAt: c.last_message_at as string,
      messages: (c.message_count as number | null) ?? 0,
    })),
  };
}

/** O nome que o painel mostra: o nome, senão o telefone, senão o Instagram. Pura. */
export function contactTitle(c: Pick<ContactPanelRow, "name" | "phone" | "instagram">): string {
  return c.name ?? (c.phone ? `+${c.phone}` : c.instagram ? `Instagram ${c.instagram}` : "Sem nome");
}
