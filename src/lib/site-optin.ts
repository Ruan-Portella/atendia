import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalPhone } from "./phone";
import { findMessage } from "./messages";
import { leadsOfConversation } from "./leads";
import { importWhatsAppContacts, markMarketingOffer } from "./contacts";
import { OPTIN_NO_TEXT, OPTIN_SITE_VERSION, isSiteOffer, optInSiteText, optInSiteYesText, recordConsent, typedOptInAnswer, whatsappScopeOfBot } from "./marketing-consent";

/*
 * Oferta de novidades no site (leva B3, parte 2c): quando a IA grava um contato com WhatsApp no
 * chat do site, a oferta vai no fim da resposta, com "Sim, quero" e "Não, obrigado" (chat.ts). O
 * clique (ou sim/não digitado logo depois) volta como texto e é tratado aqui, sem a IA: a resposta
 * fica na prova para aquele número, que vira contato do WhatsApp do chatbot (aparece na aba
 * Contatos). O número foi digitado no site, sem confirmação de que é da pessoa: por isso o sim
 * daqui não desfaz um SAIR (só um sim dado no próprio WhatsApp desfaz).
 */

/**
 * A mensagem é a resposta à oferta feita na última vez do assistente? Grava e devolve a
 * confirmação; senão, null (segue para a IA).
 */
export async function handleSiteOptIn(db: SupabaseClient, bot: { id: string; agency_id: string; client_id?: string | null; client_name: string }, conversationId: string, text: string): Promise<string | null> {
  const last = await findMessage(db, { conversationId, roles: ["assistant"], newestFirst: true }, ["content", "created_at"] as const);
  if (!last || !isSiteOffer(last.content, bot.client_name)) return null;
  const answer = typedOptInAnswer(text, last.created_at);
  if (!answer) return null;
  // o WhatsApp é o do contato que a IA gravou nesta conversa (o mais recente com telefone)
  const lead = (await leadsOfConversation(db, conversationId)).filter((l) => l.phone).pop();
  const phone = canonicalPhone(lead?.phone, { typed: true });
  const wa = phone ? await whatsappScopeOfBot(db, bot.id) : null;
  if (!phone || !wa) return null;
  const { ids } = await importWhatsAppContacts(db, bot, [{ phone, name: lead?.name ?? null, tags: [] }]);
  const contactId = ids.get(phone) ?? null;
  await recordConsent(db, {
    scope: wa.scope,
    contact: phone,
    agencyId: bot.agency_id,
    clientId: bot.client_id ?? null,
    botId: bot.id,
    wabaId: wa.wabaId,
    contactId,
    granted: answer === "sim",
    source: "chat",
    keepSuppression: true,
    text: `${optInSiteText(bot.client_name, phone)} Resposta no chat do site: ${text.slice(0, 100)}`,
    textVersion: OPTIN_SITE_VERSION,
  });
  if (contactId) await markMarketingOffer(db, contactId);
  return answer === "sim" ? optInSiteYesText(bot.client_name, phone) : OPTIN_NO_TEXT;
}
