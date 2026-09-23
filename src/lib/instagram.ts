import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { unseal } from "./secret-box";
import { appUrl } from "./utils";

/**
 * Instagram Direct pela API do Instagram com login do Instagram (sem Página do Facebook).
 *
 *   INSTAGRAM_APP_ID        → ID do app do Instagram (diferente do app do Facebook)
 *   INSTAGRAM_APP_SECRET    → chave secreta do app do Instagram (login, webhook e o "state")
 *   INSTAGRAM_VERIFY_TOKEN  → texto combinado no cadastro do webhook no painel da Meta
 *   INSTAGRAM_GRAPH_VERSION → versão da API (padrão abaixo)
 *
 * Regras que importam: resposta em até 24 h da última mensagem do contato; mensagem de até
 * 1.000 bytes; o token do cliente vale 60 dias e só pode ser renovado depois de 24 h de vida.
 */
const VERSION = process.env.INSTAGRAM_GRAPH_VERSION ?? "v23.0";
const GRAPH = `https://graph.instagram.com/${VERSION}`;
export const IG_SCOPES = ["instagram_business_basic", "instagram_business_manage_messages"];
/** Limite da Meta para o texto de uma DM. */
const MAX_BYTES = 1000;

export class InstagramError extends Error {
  constructor(message: string, readonly code?: number, readonly subcode?: number) {
    super(message);
  }
}

/** Token inválido ou revogado (o cliente removeu o app, trocou a senha, o token venceu). */
export const isInstagramAccessError = (e: unknown) => e instanceof InstagramError && e.code === 190;
/** Fora da janela de 24 h desde a última mensagem do contato. */
export const isOutsideWindow = (e: unknown) => e instanceof InstagramError && e.subcode === 2018278;

export const instagramRedirectUri = () => appUrl("/api/instagram/callback");

export function instagramConfigured(): boolean {
  return Boolean(process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET);
}

function secret(): string {
  const s = process.env.INSTAGRAM_APP_SECRET;
  if (!s) throw new InstagramError("INSTAGRAM_APP_SECRET não configurado");
  return s;
}

/* ------------------------------------------------------------------ state do login */

/** De onde veio o login: o painel da agência ou o link de conexão do cliente. */
export type ConnectOrigin = { botId: string; via: "painel" } | { botId: string; via: "link"; token: string };

/**
 * `state` assinado (HMAC com a chave do app) e com validade: o retorno do login só aceita um
 * state que nós mesmos geramos há pouco, para este chatbot. Evita que alguém ligue uma conta a
 * um chatbot que não é dele.
 */
export function signState(origin: ConnectOrigin, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...origin, exp: now + 15 * 60_000, n: randomBytes(6).toString("hex") })).toString("base64url");
  return `${body}.${createHmac("sha256", secret()).update(body).digest("base64url")}`;
}

export function readState(state: string | null, now = Date.now()): ConnectOrigin | null {
  const [body, sig] = (state ?? "").split(".");
  if (!body || !sig) return null;
  const expected = Buffer.from(createHmac("sha256", secret()).update(body).digest("base64url"));
  const got = Buffer.from(sig);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as ConnectOrigin & { exp: number };
    if (typeof data.exp !== "number" || data.exp < now || typeof data.botId !== "string") return null;
    if (data.via === "link") return typeof data.token === "string" ? { botId: data.botId, via: "link", token: data.token } : null;
    return data.via === "painel" ? { botId: data.botId, via: "painel" } : null;
  } catch {
    return null;
  }
}

export function authorizeUrl(state: string): string {
  const qs = new URLSearchParams({
    client_id: process.env.INSTAGRAM_APP_ID ?? "",
    redirect_uri: instagramRedirectUri(),
    response_type: "code",
    scope: IG_SCOPES.join(","),
    state,
    // entra com a conta profissional do Instagram (não com o Facebook)
    enable_fb_login: "false",
    force_reauth: "true",
  });
  return `https://www.instagram.com/oauth/authorize?${qs}`;
}

/* ------------------------------------------------------------------ tokens */

async function json<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number; error_subcode?: number } | string; error_message?: string; code?: number };
  if (!res.ok) {
    const err = typeof data.error === "object" ? data.error : null;
    const message = err?.message ?? data.error_message ?? (typeof data.error === "string" ? data.error : "");
    console.error("instagram: API", res.status, JSON.stringify(data));
    throw new InstagramError(message || `Instagram API ${res.status}`, err?.code ?? data.code, err?.error_subcode);
  }
  return data;
}

/** Código do login (vale 1 h, uso único) → token curto → token de 60 dias. */
export async function exchangeInstagramCode(code: string): Promise<{ token: string; expiresAt: string }> {
  const form = new URLSearchParams({ client_id: process.env.INSTAGRAM_APP_ID ?? "", client_secret: secret(), grant_type: "authorization_code", redirect_uri: instagramRedirectUri(), code });
  const short = await json<{ access_token?: string; data?: Array<{ access_token?: string }> }>(await fetch("https://api.instagram.com/oauth/access_token", { method: "POST", body: form, cache: "no-store" }));
  const shortToken = short.access_token ?? short.data?.[0]?.access_token;
  if (!shortToken) throw new InstagramError("o Instagram não devolveu o token");
  const qs = new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: secret(), access_token: shortToken });
  const long = await json<{ access_token: string; expires_in: number }>(await fetch(`https://graph.instagram.com/access_token?${qs}`, { cache: "no-store" }));
  return { token: long.access_token, expiresAt: new Date(Date.now() + long.expires_in * 1000).toISOString() };
}

/** Renova o token de 60 dias (a Meta só deixa depois de 24 h de vida). */
export async function refreshInstagramToken(token: string): Promise<{ token: string; expiresAt: string }> {
  const qs = new URLSearchParams({ grant_type: "ig_refresh_token", access_token: token });
  const r = await json<{ access_token: string; expires_in: number }>(await fetch(`https://graph.instagram.com/refresh_access_token?${qs}`, { cache: "no-store" }));
  return { token: r.access_token, expiresAt: new Date(Date.now() + r.expires_in * 1000).toISOString() };
}

/* ------------------------------------------------------------------ conta e mensagens */

export interface IgChannel {
  ig_user_id: string;
  access_token_enc?: string | null;
}

const tokenOf = (ch: IgChannel) => {
  if (!ch.access_token_enc) throw new InstagramError("conta do Instagram sem token", 190);
  return unseal(ch.access_token_enc);
};

async function api<T>(path: string, token: string, init?: { method?: string; body?: unknown }): Promise<T> {
  return json<T>(
    await fetch(`${GRAPH}/${path}`, {
      method: init?.method ?? (init?.body ? "POST" : "GET"),
      headers: { Authorization: `Bearer ${token}`, ...(init?.body ? { "Content-Type": "application/json" } : {}) },
      body: init?.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    }),
  );
}

/** A conta profissional por trás do token: `user_id` é o id que chega nos webhooks. */
export async function instagramMe(token: string): Promise<{ igUserId: string; username: string | null }> {
  const me = await api<{ id?: string; user_id?: string; username?: string }>("me?fields=user_id,username", token);
  const igUserId = me.user_id ?? me.id;
  if (!igUserId) throw new InstagramError("o Instagram não informou a conta");
  return { igUserId: String(igUserId), username: me.username ?? null };
}

/** Inscreve o app nas mensagens da conta (sem isso o webhook não recebe as DMs dela). */
export async function subscribeInstagram(token: string) {
  await api("me/subscribed_apps?subscribed_fields=messages", token, { method: "POST" });
}

export async function unsubscribeInstagram(token: string) {
  await api("me/subscribed_apps", token, { method: "DELETE" }).catch(() => {});
}

/** Corta no limite de 1.000 bytes da DM sem quebrar um caractere no meio. */
export function fitDm(text: string): string {
  const out = text.trim();
  if (Buffer.byteLength(out, "utf8") <= MAX_BYTES) return out;
  // por caractere (não por byte), para não partir um emoji ou acento ao meio
  const chars = Array.from(out);
  while (chars.length && Buffer.byteLength(chars.join("").trimEnd() + "…", "utf8") > MAX_BYTES) chars.length -= 10;
  return chars.join("").trimEnd() + "…";
}

/** O Instagram não tem formatação: tira o markdown que o modelo às vezes usa. */
export function toInstagramText(text: string): string {
  return fitDm(
    text
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/(^|\s)\*(\S[^*]*?)\*(?=\s|$|[.,!?])/g, "$1$2")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, label: string, url: string) => (label === url ? url : `${label}: ${url}`))
      .replace(/^#{1,6}\s+/gm, ""),
  );
}

/** Manda uma DM. Devolve o id da mensagem (o webhook ecoa as nossas; com ele sabemos ignorar). */
export async function sendInstagramText(ch: IgChannel, recipientId: string, text: string): Promise<string | null> {
  const r = await api<{ message_id?: string }>("me/messages", tokenOf(ch), { body: { recipient: { id: recipientId }, message: { text: toInstagramText(text) } } });
  return r.message_id ?? null;
}

/** "Visto" e "digitando…" enquanto o assistente pensa. Falha não importa. */
export async function instagramTyping(ch: IgChannel, recipientId: string) {
  const token = tokenOf(ch);
  await api("me/messages", token, { body: { recipient: { id: recipientId }, sender_action: "mark_seen" } }).catch(() => {});
  await api("me/messages", token, { body: { recipient: { id: recipientId }, sender_action: "typing_on" } }).catch(() => {});
}
