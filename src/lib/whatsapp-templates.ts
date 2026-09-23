import type { SupabaseClient } from "@supabase/supabase-js";
import { graphFor, type WaChannel } from "./whatsapp";
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

export async function listSendable(ch: TemplateChannel): Promise<SendableTemplate[]> {
  return (await listTemplates(ch)).filter((t) => t.status === "APPROVED" && !unsupportedReason(t)).map(toSendable);
}

export async function listTemplates(ch: TemplateChannel): Promise<Template[]> {
  const res = await graphFor<{ data?: Template[] }>(ch, `${ch.waba_id}/message_templates?fields=id,name,status,category,language,rejected_reason,components&limit=100`);
  return res.data ?? [];
}

export async function createTemplate(ch: TemplateChannel, input: { name: string; category: TemplateCategory; body: string; examples: string[] }) {
  const vars = templateVariables(input.body);
  const bodyComponent: Record<string, unknown> = { type: "BODY", text: input.body.trim() };
  if (vars.length) bodyComponent.example = { body_text: [input.examples.slice(0, vars.length)] };
  return graphFor<{ id: string; status: string }>(ch, `${ch.waba_id}/message_templates`, {
    body: { name: input.name, language: TEMPLATE_LANGUAGE, category: input.category, components: [bodyComponent] },
  });
}

export async function deleteTemplate(ch: TemplateChannel, name: string) {
  await graphFor(ch, `${ch.waba_id}/message_templates?name=${encodeURIComponent(name)}`, { method: "DELETE" });
}

export async function sendTemplate(ch: WaChannel, to: string, t: { name: string; language: string }, params: string[]) {
  const components = params.length ? [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }] : [];
  return graphFor<{ messages?: Array<{ id: string }> }>(ch, `${ch.phone_number_id}/messages`, {
    body: { messaging_product: "whatsapp", to, type: "template", template: { name: t.name, language: { code: t.language }, components } },
  });
}
