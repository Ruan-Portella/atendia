import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Cloud API do WhatsApp (Meta): envio de mensagens e conferência do webhook.
 *
 *   WHATSAPP_TOKEN          → token do usuário do sistema (envia as mensagens)
 *   WHATSAPP_APP_SECRET     → chave secreta do app (confere a assinatura do webhook)
 *   WHATSAPP_VERIFY_TOKEN   → texto combinado no cadastro do webhook no painel da Meta
 *   WHATSAPP_GRAPH_VERSION  → versão da Graph API (padrão abaixo)
 */
const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION ?? "v23.0";
/** Limite da Meta para o corpo de uma mensagem de texto. */
const MAX_BODY = 4096;

export class WhatsAppError extends Error {
  constructor(message: string, readonly code?: number) {
    super(message);
  }
}

/** Fora da janela de 24 h desde a última mensagem do contato: só modelo aprovado passa. */
export const OUTSIDE_WINDOW_CODE = 131047;

export function whatsappConfigured() {
  return Boolean(process.env.WHATSAPP_TOKEN);
}

/**
 * Enquanto o WhatsApp está em teste, só estes e-mails veem a aba e ligam números.
 * WHATSAPP_BETA_EMAILS: lista separada por vírgula; "*" libera para todos.
 */
export function whatsappAllowed(email: string): boolean {
  const list = (process.env.WHATSAPP_BETA_EMAILS ?? "ruanmorales29@gmail.com").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return list.includes("*") || (Boolean(email) && list.includes(email.trim().toLowerCase()));
}

async function graph<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const token = process.env.WHATSAPP_TOKEN;
  if (!token) throw new WhatsAppError("WHATSAPP_TOKEN não configurado");
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`, {
    method: init?.method ?? (init?.body ? "POST" : "GET"),
    headers: { Authorization: `Bearer ${token}`, ...(init?.body ? { "Content-Type": "application/json" } : {}) },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (data as { error?: { message?: string; code?: number; error_data?: { details?: string } } }).error;
    throw new WhatsAppError(err?.error_data?.details ?? err?.message ?? `Graph API ${res.status}`, err?.code);
  }
  return data as T;
}

export async function sendText(phoneNumberId: string, to: string, body: string) {
  return graph<{ messages?: Array<{ id: string }> }>(`${phoneNumberId}/messages`, {
    body: { messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { body: body.slice(0, MAX_BODY), preview_url: true } },
  });
}

/** Marca como lida e mostra "digitando…" enquanto o assistente pensa. Falha não importa. */
export async function markReadTyping(phoneNumberId: string, messageId: string) {
  await graph(`${phoneNumberId}/messages`, {
    body: { messaging_product: "whatsapp", status: "read", message_id: messageId, typing_indicator: { type: "text" } },
  }).catch(() => {});
}

/** Confere se o token enxerga o número e devolve como ele aparece no WhatsApp. */
export async function getPhoneNumber(phoneNumberId: string) {
  return graph<{ id: string; display_phone_number?: string; verified_name?: string }>(`${phoneNumberId}?fields=display_phone_number,verified_name`);
}

/** Inscreve o app nos eventos da conta do WhatsApp (sem isso o webhook não recebe nada dela). */
export async function subscribeApp(wabaId: string) {
  await graph(`${wabaId}/subscribed_apps`, { method: "POST", body: {} });
}

/** `X-Hub-Signature-256` = "sha256=" + HMAC-SHA256 do corpo cru com a chave secreta do app. */
export function validSignature(rawBody: string, header: string | null, secret: string | undefined): boolean {
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(rawBody).digest("hex"));
  const got = Buffer.from(header.slice(7));
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** O WhatsApp tem a própria formatação: *negrito* com um asterisco, sem links em markdown. */
export function toWhatsAppText(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/__(.+?)__/g, "_$1_")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, label: string, url: string) => (label === url ? url : `${label}: ${url}`))
    .replace(/^#{1,6}\s+/gm, "")
    .trim();
}
