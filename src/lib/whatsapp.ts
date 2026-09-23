import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { unseal } from "./secret-box";

/**
 * Cloud API do WhatsApp (Meta): envio de mensagens, cadastro incorporado e conferência do webhook.
 *
 *   META_APP_ID             → ID do app na Meta (troca do código do cadastro incorporado)
 *   WHATSAPP_CONFIG_ID      → configuração do Facebook Login for Business (cadastro incorporado)
 *   WHATSAPP_APP_SECRET     → chave secreta do app (webhook e troca do código)
 *   WHATSAPP_VERIFY_TOKEN   → texto combinado no cadastro do webhook no painel da Meta
 *   WHATSAPP_TOKEN_KEY      → chave que cifra os tokens dos clientes no banco
 *   WHATSAPP_TOKEN          → token do usuário do sistema: só para números sem token próprio
 *                             (o número de teste do app, ligado pelo ID)
 *   WHATSAPP_GRAPH_VERSION  → versão da Graph API (padrão abaixo)
 */
export const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION ?? "v23.0";
/** Limite da Meta para o corpo de uma mensagem de texto. */
const MAX_BODY = 4096;

export class WhatsAppError extends Error {
  constructor(message: string, readonly code?: number) {
    super(message);
  }
}

/** Fora da janela de 24 h desde a última mensagem do contato: só modelo aprovado passa. */
export const OUTSIDE_WINDOW_CODE = 131047;

/** Um número ligado a um chatbot, com o token cifrado do cliente (ou sem, no número de teste). */
export interface WaChannel {
  phone_number_id: string;
  access_token_enc?: string | null;
}

export function whatsappConfigured() {
  return Boolean(process.env.WHATSAPP_TOKEN);
}

/** Dados que o botão "Conectar WhatsApp" precisa; null se o cadastro incorporado não está configurado. */
export function embeddedSignupConfig(): { appId: string; configId: string; graphVersion: string } | null {
  const appId = process.env.META_APP_ID;
  const configId = process.env.WHATSAPP_CONFIG_ID;
  return appId && configId ? { appId, configId, graphVersion: GRAPH_VERSION } : null;
}

/**
 * Enquanto o WhatsApp está em teste, só estes e-mails veem a aba e ligam números.
 * WHATSAPP_BETA_EMAILS: lista separada por vírgula; "*" libera para todos.
 */
export function whatsappAllowed(email: string): boolean {
  const list = (process.env.WHATSAPP_BETA_EMAILS ?? "ruanmorales29@gmail.com").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return list.includes("*") || (Boolean(email) && list.includes(email.trim().toLowerCase()));
}

function envToken(): string {
  const token = process.env.WHATSAPP_TOKEN;
  if (!token) throw new WhatsAppError("WHATSAPP_TOKEN não configurado");
  return token;
}

function channelToken(ch: WaChannel): string {
  return ch.access_token_enc ? unseal(ch.access_token_enc) : envToken();
}

async function graph<T>(path: string, token: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`, {
    method: init?.method ?? (init?.body ? "POST" : "GET"),
    headers: { Authorization: `Bearer ${token}`, ...(init?.body ? { "Content-Type": "application/json" } : {}) },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (data as { error?: { message?: string; code?: number; error_user_title?: string; error_user_msg?: string; error_data?: { details?: string } } }).error;
    // a Meta manda uma explicação para pessoas (error_user_msg) além da técnica
    const human = [err?.error_user_title, err?.error_user_msg].filter(Boolean).join(": ");
    console.error("whatsapp: Graph API", res.status, path.split("?")[0], JSON.stringify(err));
    throw new WhatsAppError(human || err?.error_data?.details || err?.message || `Graph API ${res.status}`, err?.code);
  }
  return data as T;
}

/** Chamada à Graph API com o token do número (para quem monta outras operações, ex.: modelos). */
export function graphFor<T>(ch: WaChannel, path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  return graph<T>(path, channelToken(ch), init);
}

export async function sendText(ch: WaChannel, to: string, body: string) {
  return graph<{ messages?: Array<{ id: string }> }>(`${ch.phone_number_id}/messages`, channelToken(ch), {
    body: { messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { body: body.slice(0, MAX_BODY), preview_url: true } },
  });
}

/** O WhatsApp aceita mídia de até 16 MB; mais que isso nem tentamos baixar. */
export const MAX_MEDIA_BYTES = 16 * 1024 * 1024;

/**
 * Baixa uma mídia recebida (ex.: áudio). A Meta devolve um endereço temporário, que também
 * exige o token do número.
 */
export async function downloadMedia(ch: WaChannel, mediaId: string): Promise<{ data: Uint8Array; mimeType: string }> {
  const token = channelToken(ch);
  const meta = await graph<{ url?: string; mime_type?: string; file_size?: number }>(mediaId, token);
  if (!meta.url) throw new WhatsAppError("a Meta não devolveu o endereço da mídia");
  if (meta.file_size && meta.file_size > MAX_MEDIA_BYTES) throw new WhatsAppError("mídia grande demais");
  const res = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!res.ok) throw new WhatsAppError(`download da mídia falhou (${res.status})`);
  const data = new Uint8Array(await res.arrayBuffer());
  if (data.byteLength > MAX_MEDIA_BYTES) throw new WhatsAppError("mídia grande demais");
  return { data, mimeType: meta.mime_type ?? res.headers.get("content-type") ?? "application/octet-stream" };
}

/** Marca como lida e mostra "digitando…" enquanto o assistente pensa. Falha não importa. */
export async function markReadTyping(ch: WaChannel, messageId: string) {
  await graph(`${ch.phone_number_id}/messages`, channelToken(ch), {
    body: { messaging_product: "whatsapp", status: "read", message_id: messageId, typing_indicator: { type: "text" } },
  }).catch(() => {});
}

/** Confere se o token enxerga o número e devolve como ele aparece no WhatsApp. */
export async function getPhoneNumber(phoneNumberId: string, token = envToken()) {
  return graph<{ id: string; display_phone_number?: string; verified_name?: string }>(`${phoneNumberId}?fields=display_phone_number,verified_name`, token);
}

/** Inscreve o app nos eventos da conta do WhatsApp (sem isso o webhook não recebe nada dela). */
export async function subscribeApp(wabaId: string, token = envToken()) {
  await graph(`${wabaId}/subscribed_apps`, token, { method: "POST", body: {} });
}

/** Desfaz a inscrição ao desconectar. Falha não importa: o número já saiu do banco. */
export async function unsubscribeApp(wabaId: string, token: string) {
  await graph(`${wabaId}/subscribed_apps`, token, { method: "DELETE" }).catch(() => {});
}

/** Troca o código do cadastro incorporado (vale 30 s) pelo token do cliente. */
export async function exchangeSignupCode(code: string): Promise<string> {
  const appId = process.env.META_APP_ID;
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!appId || !secret) throw new WhatsAppError("META_APP_ID ou WHATSAPP_APP_SECRET não configurado");
  const qs = new URLSearchParams({ client_id: appId, client_secret: secret, code });
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token?${qs}`, { cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; error?: { message?: string; code?: number } };
  if (!res.ok || !data.access_token) throw new WhatsAppError(data.error?.message ?? "a Meta não devolveu o token", data.error?.code);
  return data.access_token;
}

/** Registra o número na Cloud API. O PIN vira a verificação em duas etapas do número. */
export async function registerNumber(phoneNumberId: string, pin: string, token: string) {
  await graph(`${phoneNumberId}/register`, token, { body: { messaging_product: "whatsapp", pin } });
}

/** Números de uma conta do WhatsApp (na coexistência a Meta não diz qual foi escolhido). */
export async function listWabaPhoneNumbers(wabaId: string, token: string) {
  const res = await graph<{ data?: Array<{ id: string; display_phone_number?: string; verified_name?: string }> }>(`${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name`, token);
  return res.data ?? [];
}

/**
 * Coexistência: pede à Meta a sincronização dos contatos e do histórico do app do celular.
 * Obrigatório em até 24 h depois de conectar, senão a Meta desconecta o número.
 */
export async function startAppSync(phoneNumberId: string, token: string, syncType: "smb_app_state_sync" | "history") {
  await graph(`${phoneNumberId}/smb_app_data`, token, { body: { messaging_product: "whatsapp", sync_type: syncType } });
}

export function newPin(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * O mesmo celular brasileiro em dois formatos: com o 9 (55 21 9xxxx-xxxx, 13 dígitos) e sem
 * (55 21 xxxx-xxxx, 12 dígitos). A Meta às vezes identifica o contato sem o 9, então quem busca
 * a conversa de um número precisa olhar os dois.
 */
export function waIdVariants(waId: string): string[] {
  const d = waId.replace(/\D/g, "");
  if (d.startsWith("55") && d.length === 13 && d[4] === "9") return [d, d.slice(0, 4) + d.slice(5)];
  if (d.startsWith("55") && d.length === 12 && /[6-9]/.test(d[4])) return [d, d.slice(0, 4) + "9" + d.slice(4)];
  return [d];
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
