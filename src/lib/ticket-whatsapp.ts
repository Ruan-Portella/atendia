import type { SupabaseClient } from "@supabase/supabase-js";
import { createTemplate, listTemplates, loadTemplateChannel, sendTemplate, TEMPLATE_LANGUAGE } from "./whatsapp-templates";
import { activeSuppressions, blocks, suppressionScope } from "./suppression";
import { sendBlockedReason } from "./conversation-mode";
import { canonicalPhone } from "./phone";
import { agencyBaseUrl } from "./domain";

/*
 * O aviso da resposta do chamado pelo WhatsApp (Chamados, parte 7d; spec, "com telefone e
 * consentimento, por template de utilidade no WhatsApp"). Um modelo de utilidade por chatbot,
 * criado pelo BoaVoz quando o chamado pede o telefone e o WhatsApp está conectado, com o botão
 * "Ver a resposta" que abre o acompanhamento. Sai só para quem marcou o aceite no formulário, com
 * o modelo aprovado e sem descadastro de utilidade; o e-mail sai sempre.
 */

/** Um modelo por chatbot (o link do botão é do chatbot): resposta_chamado_ + o começo da chave. Pura. */
export const ticketTemplateName = (publicKey: string) => `resposta_chamado_${publicKey.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8)}`;

/** O texto do modelo, com o nome do negócio fixo, o nome em {{1}} e o protocolo em {{2}}. Pura. */
export function ticketTemplateBody(company: string): string {
  const name = company.replace(/[{}*_~`\n]/g, "").trim().slice(0, 60) || "nossa equipe";
  return `Olá, {{1}}! A equipe de ${name} respondeu ao seu chamado {{2}}. Toque no botão para ver a resposta e continuar o atendimento.`;
}

export type TicketTemplateStatus = "aprovado" | "em_analise" | "recusado" | "reclassificado" | "ausente" | "sem_whatsapp";

interface BotForTemplate {
  id: string;
  public_key: string;
  client_name: string;
  agencies: { custom_domain: string | null; custom_domain_verified_at: string | null } | Array<{ custom_domain: string | null; custom_domain_verified_at: string | null }> | null;
}

async function botForTemplate(db: SupabaseClient, botId: string): Promise<BotForTemplate | null> {
  const { data } = await db.from("bots").select("id, public_key, client_name, agencies(custom_domain, custom_domain_verified_at)").eq("id", botId).maybeSingle();
  return (data as BotForTemplate | null) ?? null;
}

/** O estado do modelo; ausente, o BoaVoz cria agora (fica em análise na Meta). */
export async function ensureTicketTemplate(db: SupabaseClient, botId: string): Promise<TicketTemplateStatus> {
  const [ch, bot] = await Promise.all([loadTemplateChannel(db, botId), botForTemplate(db, botId)]);
  if (!ch || !bot) return "sem_whatsapp";
  const name = ticketTemplateName(bot.public_key);
  try {
    const found = (await listTemplates(ch)).find((t) => t.name === name);
    if (found) return found.category !== "UTILITY" ? "reclassificado" : found.status === "APPROVED" ? "aprovado" : found.status === "REJECTED" ? "recusado" : "em_analise";
    const agency = Array.isArray(bot.agencies) ? bot.agencies[0] : bot.agencies;
    await createTemplate(ch, { name, category: "UTILITY", body: ticketTemplateBody(bot.client_name), examples: ["Ana", "K7Q2-9XMP"], urlButton: { text: "Ver a resposta", baseUrl: `${agencyBaseUrl(agency ?? { custom_domain: null })}/w/${bot.public_key}?chamado=`, example: "K7Q2-9XMP" } });
    return "em_analise";
  } catch (e) {
    console.error("chamado: modelo do WhatsApp não criado", (e as Error).message);
    return "ausente";
  }
}

/**
 * Manda o aviso da resposta pelo WhatsApp. false quando não sai (sem WhatsApp, modelo não aprovado,
 * telefone inválido, descadastro de utilidade ou canal bloqueado pela regra de estado).
 */
export async function notifyTicketByWhatsApp(db: SupabaseClient, o: { botId: string; phone: string; name: string | null; protocol: string }): Promise<boolean> {
  const phone = canonicalPhone(o.phone, { typed: true });
  const [ch, bot] = await Promise.all([loadTemplateChannel(db, o.botId), botForTemplate(db, o.botId)]);
  if (!phone || !ch || !bot) return false;
  const name = ticketTemplateName(bot.public_key);
  const template = (await listTemplates(ch).catch(() => [])).find((t) => t.name === name);
  if (!template || template.status !== "APPROVED" || template.category !== "UTILITY") return false;
  const kinds = (await activeSuppressions(db, { channel: "whatsapp", scope: suppressionScope({ wabaId: ch.waba_id, botId: o.botId }), contact: phone }).catch(() => [])).map((s) => s.kind);
  if (blocks(kinds, "UTILITY")) return false;
  if (await sendBlockedReason(db, o.botId, "whatsapp")) return false;
  const first = o.name?.trim().split(/\s+/)[0] || "tudo bem";
  try {
    await sendTemplate(ch, phone, { name, language: TEMPLATE_LANGUAGE }, [first.slice(0, 40), o.protocol], { urlSuffix: o.protocol });
    return true;
  } catch (e) {
    console.error("chamado: aviso no WhatsApp não saiu", (e as Error).message);
    return false;
  }
}
