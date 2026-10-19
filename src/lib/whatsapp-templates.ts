import type { SupabaseClient } from "@supabase/supabase-js";
import { graphFor, recipientOf, type WaChannel } from "./whatsapp";
import { OPTOUT_BUTTON_TEXT } from "./suppression";
import { TEMPLATE_LANGUAGE, templateVariables, toSendable, unsupportedReason, type SendableTemplate, type Template, type TemplateCategory } from "./template-text";

/**
 * Modelos de mensagem (templates) do WhatsApp: a única forma de escrever para alguém fora da
 * janela de 24 h. Ficam na conta do WhatsApp Business (WABA) e passam pela aprovação da Meta.
 */

export interface TemplateChannel extends WaChannel {
  waba_id: string;
}

export * from "./template-text";

/** Número do chatbot com a conta do WhatsApp (sem ela não há modelos). Service role. */
export async function loadTemplateChannel(admin: SupabaseClient, botId: string): Promise<TemplateChannel | null> {
  const { data } = await admin.from("whatsapp_channels").select("phone_number_id, waba_id, access_token_enc, disconnected_at").eq("bot_id", botId).maybeSingle();
  // desconectado: sem token, e o do servidor não serve para a conta do cliente
  return data?.waba_id && !data.disconnected_at ? (data as TemplateChannel) : null;
}

/**
 * Modelos que podem ser enviados pelo painel: aprovados e só de UTILIDADE até a leva B3 (sem
 * prova de consentimento de marketing, nenhum modelo de marketing sai). Se a Meta reclassificar
 * um modelo para marketing, ele some daqui sozinho.
 */
/** Categorias que o painel envia: utilidade e marketing (só para quem aceitou novidades). */
const panelCategory = (category: string, marketing: boolean) => category === "UTILITY" || (marketing && category === "MARKETING");

export async function listSendable(ch: TemplateChannel, o: { marketing?: boolean } = {}): Promise<SendableTemplate[]> {
  return (await listTemplates(ch)).filter((t) => t.status === "APPROVED" && panelCategory(t.category, Boolean(o.marketing)) && !unsupportedReason(t)).map(toSendable);
}

export async function listTemplates(ch: TemplateChannel): Promise<Template[]> {
  const res = await graphFor<{ data?: Template[] }>(ch, `${ch.waba_id}/message_templates?fields=id,name,status,category,language,rejected_reason,components&limit=100`);
  return res.data ?? [];
}

/**
 * Cria o modelo. quickReplies: botões de resposta rápida (o modelo da BoaVoz que confirma os avisos
 * da equipe); no marketing, o botão de descadastro vai sempre.
 */
export async function createTemplate(ch: TemplateChannel, input: { name: string; category: TemplateCategory; body: string; examples: string[]; quickReplies?: string[] }) {
  const vars = templateVariables(input.body);
  const bodyComponent: Record<string, unknown> = { type: "BODY", text: input.body.trim() };
  if (vars.length) bodyComponent.example = { body_text: [input.examples.slice(0, vars.length)] };
  const components: Array<Record<string, unknown>> = [bodyComponent];
  // marketing: botão de descadastro (resposta rápida); o toque vale como SAIR das promoções
  const replies = [...(input.quickReplies ?? []), ...(input.category === "MARKETING" ? [OPTOUT_BUTTON_TEXT] : [])];
  if (replies.length) components.push({ type: "BUTTONS", buttons: replies.map((text) => ({ type: "QUICK_REPLY", text })) });
  return graphFor<{ id: string; status: string }>(ch, `${ch.waba_id}/message_templates`, {
    body: { name: input.name, language: TEMPLATE_LANGUAGE, category: input.category, components },
  });
}

export async function deleteTemplate(ch: TemplateChannel, name: string) {
  await graphFor(ch, `${ch.waba_id}/message_templates?name=${encodeURIComponent(name)}`, { method: "DELETE" });
}

/**
 * Manda o modelo. buttonPayloads: o que volta no toque de cada botão de resposta rápida, na ordem
 * (sem ele, volta o texto do botão).
 */
export async function sendTemplate(ch: WaChannel, to: string, t: { name: string; language: string }, params: string[], opts: { callbackData?: string; timeoutMs?: number; buttonPayloads?: string[] } = {}) {
  const components: Array<Record<string, unknown>> = params.length ? [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }] : [];
  for (const [i, payload] of (opts.buttonPayloads ?? []).entries()) components.push({ type: "button", sub_type: "quick_reply", index: String(i), parameters: [{ type: "payload", payload }] });
  return graphFor<{ messages?: Array<{ id: string }> }>(ch, `${ch.phone_number_id}/messages`, {
    // biz_opaque_callback_data volta nos status da Meta: as campanhas conciliam o envio por ele
    body: { messaging_product: "whatsapp", ...recipientOf(to), type: "template", template: { name: t.name, language: { code: t.language }, components }, ...(opts.callbackData ? { biz_opaque_callback_data: opts.callbackData } : {}) },
    timeoutMs: opts.timeoutMs,
  });
}

/*
 * Modelo padrão de retomada (leva B1'): criado pelo BoaVoz ao conectar o WhatsApp, de utilidade e
 * só em pt_BR, para a equipe retomar uma conversa depois das 24 h. Se a Meta recusar ou mudar a
 * categoria, o painel avisa e mostra os outros modelos de utilidade aprovados.
 */
export const RESUME_TEMPLATE_NAME = "retomada_atendimento";

/** Texto do modelo de retomada, com o nome do negócio fixo e o nome do contato em {{1}}. Pura. */
export function resumeTemplateBody(company: string): string {
  const name = company.replace(/[{}*_~`\n]/g, "").trim().slice(0, 60) || "nossa equipe";
  return `Olá, {{1}}! Aqui é a equipe de ${name}. Sua conversa com a gente ficou parada e queremos continuar o seu atendimento. Responda esta mensagem para seguirmos por aqui.`;
}

export type ResumeStatus = "aprovado" | "em_analise" | "recusado" | "reclassificado" | "ausente";

/** Estado do modelo de retomada na conta (pela lista de modelos da Meta). Pura. */
export function resumeStatus(templates: Template[]): ResumeStatus {
  const t = templates.find((x) => x.name === RESUME_TEMPLATE_NAME);
  if (!t) return "ausente";
  if (t.category !== "UTILITY") return "reclassificado";
  if (t.status === "APPROVED") return "aprovado";
  if (t.status === "REJECTED" || t.status === "DISABLED" || t.status === "PAUSED") return "recusado";
  return "em_analise";
}

/**
 * Cria o modelo de retomada se a conta ainda não tem. Nunca derruba a conexão: falha só vai para o
 * log (o painel mostra "ausente" e os outros modelos continuam valendo).
 */
export async function ensureResumeTemplate(ch: TemplateChannel, company: string): Promise<ResumeStatus> {
  try {
    const current = resumeStatus(await listTemplates(ch));
    if (current !== "ausente") return current;
    await createTemplate(ch, { name: RESUME_TEMPLATE_NAME, category: "UTILITY", body: resumeTemplateBody(company), examples: ["Ana"] });
    return "em_analise";
  } catch (e) {
    console.error("whatsapp: modelo de retomada não criado", (e as Error).message);
    return "ausente";
  }
}

/** Os modelos que dá para mandar numa conversa, com o de retomada primeiro, e o estado dele. */
export async function conversationTemplates(ch: TemplateChannel, o: { marketing?: boolean } = {}): Promise<{ templates: SendableTemplate[]; resume: ResumeStatus }> {
  const all = await listTemplates(ch);
  const sendable = all.filter((t) => t.status === "APPROVED" && panelCategory(t.category, Boolean(o.marketing)) && !unsupportedReason(t)).map(toSendable);
  sendable.sort((a, b) => Number(b.name === RESUME_TEMPLATE_NAME) - Number(a.name === RESUME_TEMPLATE_NAME));
  return { templates: sendable, resume: resumeStatus(all) };
}
