import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { unseal } from "./secret-box";
import { appUrl } from "./utils";
import { fetchWithTimeout } from "./whatsapp";
import type { InstagramElement } from "./components";

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
// v26.0 (29/07/2026; leva S): da v23 à v26, sem mudança no envio, nos webhooks nem nos tokens
const VERSION = process.env.INSTAGRAM_GRAPH_VERSION ?? "v26.0";
const GRAPH = `https://graph.instagram.com/${VERSION}`;
export const IG_SCOPES = ["instagram_business_basic", "instagram_business_manage_messages"];

/**
 * Comentários (E1, parte 4): pedem a permissão instagram_business_manage_comments, que precisa de
 * uma revisão própria da Meta. INSTAGRAM_COMMENTS=1 liga (na dev, com as contas testadoras do app).
 */
export const commentsEnabled = () => process.env.INSTAGRAM_COMMENTS === "1";

/** As permissões pedidas no login: a dos comentários só com eles ligados. */
export const igScopes = (): string[] => (commentsEnabled() ? [...IG_SCOPES, "instagram_business_manage_comments"] : IG_SCOPES);
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
    scope: igScopes().join(","),
    state,
    // entra com a conta profissional do Instagram (não com o Facebook)
    enable_fb_login: "false",
    force_reauth: "true",
  });
  return `https://www.instagram.com/oauth/authorize?${qs}`;
}

/* ------------------------------------------------------------------ tokens */

async function json<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number; error_subcode?: number; error_user_title?: string; error_user_msg?: string } | string; error_message?: string; code?: number };
  if (!res.ok) {
    const err = typeof data.error === "object" ? data.error : null;
    const base = err?.message ?? data.error_message ?? (typeof data.error === "string" ? data.error : "");
    // o detalhe que a Meta às vezes manda (qual campo e por quê): "Invalid parameter" sozinho não diz
    const detail = [err?.error_user_title, err?.error_user_msg].filter((t) => t && t !== base).join(": ");
    console.error("instagram: API", res.status, JSON.stringify(data));
    throw new InstagramError([base || `Instagram API ${res.status}`, detail].filter(Boolean).join(" — "), err?.code ?? data.code, err?.error_subcode);
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

async function api<T>(path: string, token: string, init?: { method?: string; body?: unknown; timeoutMs?: number }): Promise<T> {
  return json<T>(
    await fetchWithTimeout(
      `${GRAPH}/${path}`,
      {
        method: init?.method ?? (init?.body ? "POST" : "GET"),
        headers: { Authorization: `Bearer ${token}`, ...(init?.body ? { "Content-Type": "application/json" } : {}) },
        body: init?.body ? JSON.stringify(init.body) : undefined,
        cache: "no-store",
      },
      init?.timeoutMs,
      "instagram",
    ),
  );
}

/** A conta profissional por trás do token: `user_id` é o id que chega nos webhooks (não muda com o nome). */
export async function instagramMe(token: string, timeoutMs?: number): Promise<{ igUserId: string; username: string | null }> {
  const me = await api<{ id?: string; user_id?: string; username?: string }>("me?fields=user_id,username", token, { timeoutMs });
  const igUserId = me.user_id ?? me.id;
  if (!igUserId) throw new InstagramError("o Instagram não informou a conta");
  return { igUserId: String(igUserId), username: me.username ?? null };
}

/**
 * Inscreve o app nas mensagens da conta (sem isso o webhook não recebe as DMs dela), nos toques
 * em botão de generic template e nas perguntas prontas (messaging_postbacks, parte 5d-2), no link
 * ig.me aberto numa conversa que já existe (messaging_referral, E1) e, com eles ligados, nos
 * comentários (E1, parte 4). Se a Meta recusar um campo novo (a conta sem a permissão dos
 * comentários, por exemplo), fica a inscrição de antes: a conexão não pode cair por isso.
 */
export async function subscribeInstagram(token: string) {
  const base = ["messages", "messaging_postbacks"];
  const tries = [[...base, "messaging_referral", ...(commentsEnabled() ? ["comments"] : [])], [...base, "messaging_referral"], base];
  for (const [i, fields] of tries.entries()) {
    if (i > 0 && fields.length === tries[i - 1].length) continue;
    try {
      await api(`me/subscribed_apps?subscribed_fields=${fields.join(",")}`, token, { method: "POST" });
      return;
    } catch (e) {
      if (isInstagramAccessError(e) || i === tries.length - 1) throw e;
    }
  }
}

/** Campos em que o app está inscrito na conta (sem "messages", as DMs não chegam). */
export async function instagramSubscribedFields(ch: IgChannel): Promise<string[]> {
  const r = await api<{ data?: Array<{ subscribed_fields?: string[] }> }>("me/subscribed_apps", tokenOf(ch));
  return (r.data ?? []).flatMap((a) => a.subscribed_fields ?? []);
}

/** Inscreve de novo, com o token guardado da conta (a conferência diária). */
export const resubscribeInstagram = (ch: IgChannel) => subscribeInstagram(tokenOf(ch));

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
export function plainInstagramText(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(^|\s)\*(\S[^*]*?)\*(?=\s|$|[.,!?])/g, "$1$2")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, label: string, url: string) => (label === url ? url : `${label}: ${url}`))
    .replace(/^#{1,6}\s+/gm, "")
    .trim();
}

/** Texto de uma DM só (sem markdown, cortado no limite de 1.000 bytes). */
export function toInstagramText(text: string): string {
  return fitDm(plainInstagramText(text));
}

/**
 * Resposta longa vira até `maxParts` DMs, cortadas no fim de um parágrafo (ou de uma linha, de
 * uma frase ou de uma palavra, nessa ordem), em vez de uma só cortada com "…". Só a última
 * ainda pode levar "…", se o texto passar de 3 mensagens.
 */
export function splitDm(text: string, maxParts = 3): string[] {
  let rest = plainInstagramText(text);
  const parts: string[] = [];
  while (parts.length < maxParts - 1 && Buffer.byteLength(rest, "utf8") > MAX_BYTES) {
    // maior começo que cabe em 1.000 bytes (por caractere, para não partir emoji ou acento)
    let size = 0;
    let end = 0;
    for (const ch of rest) {
      size += Buffer.byteLength(ch, "utf8");
      if (size > MAX_BYTES) break;
      end += ch.length;
    }
    const head = rest.slice(0, end);
    const min = Math.floor(end * 0.4); // não corta cedo demais (pedaço minúsculo)
    const cuts = [head.lastIndexOf("\n\n"), head.lastIndexOf("\n"), Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? ")) + 1, head.lastIndexOf(" ")];
    const cut = cuts.find((c) => c > min) ?? end;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(fitDm(rest));
  return parts.filter(Boolean);
}

/** Manda uma DM. Devolve o id da mensagem (o webhook ecoa as nossas; com ele sabemos ignorar). */
export async function sendInstagramText(ch: IgChannel, recipientId: string, text: string, quickReplies?: Array<{ title: string; payload: string }>, opts: { humanAgent?: boolean; timeoutMs?: number; replyTo?: string | null } = {}): Promise<string | null> {
  const message: Record<string, unknown> = { text: fitDm(text) };
  // respostas rápidas: botões embaixo da mensagem (o toque volta com quick_reply.payload)
  if (quickReplies?.length) message.quick_replies = quickReplies.slice(0, 13).map((q) => ({ content_type: "text", title: q.title.slice(0, 20), payload: q.payload }));
  // depois das 24 h, só a resposta da equipe, com a tag human_agent (até 7 dias; revisão própria da Meta)
  const tag = opts.humanAgent ? { messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" } : {};
  // citação: a DM aparece em cima da mensagem citada
  const reply = opts.replyTo ? { reply_to: { mid: opts.replyTo } } : {};
  const r = await api<{ message_id?: string }>("me/messages", tokenOf(ch), { body: { recipient: { id: recipientId }, ...reply, message, ...tag }, timeoutMs: opts.timeoutMs });
  return r.message_id ?? null;
}

/** Reação da empresa a uma DM: o Instagram só aceita o coração ("love"); false tira. */
export async function sendInstagramReaction(ch: IgChannel, recipientId: string, mid: string, react: boolean): Promise<void> {
  await api("me/messages", tokenOf(ch), { body: { recipient: { id: recipientId }, sender_action: react ? "react" : "unreact", payload: react ? { message_id: mid, reaction: "love" } : { message_id: mid } } });
}

/**
 * Carrossel (generic template): foto, título, subtítulo e botões por card; o toque num botão de
 * postback volta pelo webhook messaging_postbacks, com o payload. Não aparece no instagram.com
 * pelo computador. Devolve o id da mensagem.
 */
export async function sendInstagramTemplate(ch: IgChannel, recipientId: string, elements: InstagramElement[], opts: { timeoutMs?: number } = {}): Promise<string | null> {
  const r = await api<{ message_id?: string }>("me/messages", tokenOf(ch), { body: { recipient: { id: recipientId }, message: { attachment: { type: "template", payload: { template_type: "generic", elements } } } }, timeoutMs: opts.timeoutMs });
  return r.message_id ?? null;
}

/** Anexo pela URL (o Instagram baixa): imagem (PNG ou JPEG) ou arquivo (só PDF). Devolve o id da mensagem. */
export async function sendInstagramAttachment(ch: IgChannel, recipientId: string, a: { type: "image" | "file"; url: string }, opts: { timeoutMs?: number } = {}): Promise<string | null> {
  const r = await api<{ message_id?: string }>("me/messages", tokenOf(ch), { body: { recipient: { id: recipientId }, message: { attachment: { type: a.type, payload: { url: a.url } } } }, timeoutMs: opts.timeoutMs });
  return r.message_id ?? null;
}

/**
 * O @ de quem escreveu pelo Direct (API de perfil do usuário; só para quem mandou mensagem à conta).
 * Usado quando vira lead. Falha (permissão, perfil restrito) devolve null: o lead fica "pelo Instagram".
 */
export async function instagramUsername(ch: IgChannel, igsid: string): Promise<string | null> {
  if (!/^\d+$/.test(igsid)) return null;
  try {
    const r = await api<{ username?: string }>(`${igsid}?fields=username`, tokenOf(ch));
    return r.username && /^[a-z0-9._]{1,30}$/i.test(r.username) ? `@${r.username.toLowerCase()}` : null;
  } catch {
    return null;
  }
}

/** "Visto" e "digitando…" enquanto o assistente pensa. Falha não importa. */
export async function instagramTyping(ch: IgChannel, recipientId: string) {
  const token = tokenOf(ch);
  await api("me/messages", token, { body: { recipient: { id: recipientId }, sender_action: "mark_seen" } }).catch(() => {});
  await api("me/messages", token, { body: { recipient: { id: recipientId }, sender_action: "typing_on" } }).catch(() => {});
}

/**
 * Link de verdade (permalink) de um post ou reel compartilhado na DM. Só dá para ler posts da
 * própria conta conectada (o caso comum: o cliente manda o post da loja); de outras contas a Meta
 * não deixa, e aí volta null.
 */
export async function mediaPermalink(ch: IgChannel, mediaId: string): Promise<string | null> {
  if (!/^\d+$/.test(mediaId)) return null;
  try {
    const r = await api<{ permalink?: string }>(`${mediaId}?fields=permalink`, tokenOf(ch));
    return r.permalink && /^https:\/\/(www\.)?instagram\.com\//i.test(r.permalink) ? r.permalink : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ posts (E1) */

/** Um post do feed (ou um item do carrossel), como a API devolve. */
export interface IgMedia {
  id: string;
  caption?: string;
  media_type?: string;
  media_url?: string;
  /** Capa: só no vídeo e no reel. */
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
  children?: { data?: IgMedia[] };
}

const MEDIA_FIELDS = "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,children{id,media_type,media_url,thumbnail_url}";

/**
 * Um post, reel ou story pelo id (parte 2: o compartilhado no direct, o story respondido). Só dá
 * para ler a mídia da própria conta conectada: de outra conta, a Meta recusa e volta null.
 */
export async function instagramMediaById(ch: IgChannel, mediaId: string): Promise<IgMedia | null> {
  if (!/^\d+$/.test(mediaId)) return null;
  try {
    const m = await api<IgMedia>(`${mediaId}?fields=${encodeURIComponent(MEDIA_FIELDS)}`, tokenOf(ch));
    return m?.id ? m : null;
  } catch {
    return null;
  }
}

/**
 * Os posts do feed da conta conectada, do mais novo ao mais antigo, até `max` ou até o primeiro
 * mais velho que `since` (stories não vêm por aqui). Página a página (50 por vez), pelo cursor.
 */
export async function instagramMedia(ch: IgChannel, o: { max: number; since: Date }): Promise<IgMedia[]> {
  const token = tokenOf(ch);
  const out: IgMedia[] = [];
  let after: string | null = null;
  do {
    const page: { data?: IgMedia[]; paging?: { cursors?: { after?: string }; next?: string } } = await api(`me/media?fields=${encodeURIComponent(MEDIA_FIELDS)}&limit=50${after ? `&after=${encodeURIComponent(after)}` : ""}`, token);
    for (const m of page.data ?? []) {
      if (m.timestamp && new Date(m.timestamp) < o.since) return out;
      out.push(m);
      if (out.length >= o.max) return out;
    }
    after = page.paging?.next ? (page.paging.cursors?.after ?? null) : null;
  } while (after);
  return out;
}

/* ------------------------------------------------------------------ perguntas prontas (E1, parte 3a) */

/**
 * As perguntas prontas do direct (ice breakers, até 4): aparecem quando a pessoa abre a conversa
 * pela primeira vez, no app (no computador, não). O toque chega como postback, com a pergunta no
 * título e "ib:<n>" no payload. Lista vazia apaga as perguntas da conta.
 */
export async function setInstagramIceBreakers(ch: IgChannel, questions: string[]): Promise<string> {
  const token = tokenOf(ch);
  if (!questions.length) {
    await api("me/messenger_profile", token, { method: "DELETE", body: { fields: ["ice_breakers"] } });
    return "apagadas";
  }
  const actions = questions.slice(0, 4).map((question, i) => ({ question, payload: `ib:${i + 1}` }));
  // o formato da documentação primeiro; na dev (20/10) a Meta recusou com "Invalid parameter", então
  // seguem as variações conhecidas da API de mensagens: o locale "default", o id da conta no lugar
  // de "me" e o formato antigo (sem call_to_actions). A primeira aceita vale.
  const attempts: Array<{ name: string; path: string; body: unknown }> = [
    { name: "documentação", path: "me/messenger_profile", body: { platform: "instagram", ice_breakers: [{ call_to_actions: actions }] } },
    { name: "locale default", path: "me/messenger_profile", body: { platform: "instagram", ice_breakers: [{ call_to_actions: actions, locale: "default" }] } },
    { name: "id da conta", path: `${ch.ig_user_id}/messenger_profile`, body: { platform: "instagram", ice_breakers: [{ call_to_actions: actions, locale: "default" }] } },
    { name: "formato antigo", path: "me/messenger_profile", body: { platform: "instagram", ice_breakers: actions } },
  ];
  const refused: string[] = [];
  for (const a of attempts) {
    try {
      await api(a.path, token, { body: a.body });
      if (refused.length) console.warn("instagram: perguntas prontas aceitas no formato", a.name, "depois de", refused);
      return a.name;
    } catch (e) {
      // só o parâmetro recusado tenta o próximo formato; token, permissão e limite sobem na hora
      if (!(e instanceof InstagramError) || e.code !== 100) throw e;
      refused.push(`${a.name}: ${e.message}${e.subcode ? ` (${e.subcode})` : ""}`);
    }
  }
  throw new InstagramError(`nenhum formato foi aceito (${refused.join("; ")})`, 100);
}

/* ------------------------------------------------------------------ comentários (E1, parte 4) */

/** Falta a permissão dos comentários (a conta foi conectada antes, ou a Meta ainda não aprovou). */
export const isCommentsPermissionError = (e: unknown) => e instanceof InstagramError && (e.code === 10 || e.code === 200 || e.code === 3);

/**
 * Resposta privada a um comentário: uma mensagem no direct de quem comentou, uma vez por
 * comentário e até 7 dias depois dele (para quem não segue a conta, cai em Solicitações). Só dá
 * para mandar outra depois que a pessoa responder. Devolve o IGSID da pessoa e o id da mensagem.
 */
export async function sendCommentPrivateReply(ch: IgChannel, commentId: string, text: string): Promise<{ recipientId: string | null; messageId: string | null }> {
  const r = await api<{ recipient_id?: string; message_id?: string }>("me/messages", tokenOf(ch), { body: { recipient: { comment_id: commentId }, message: { text: fitDm(text) } } });
  return { recipientId: r.recipient_id ?? null, messageId: r.message_id ?? null };
}

/** Resposta pública no próprio comentário (vira um comentário da loja). Devolve o id dele. */
export async function replyToComment(ch: IgChannel, commentId: string, text: string): Promise<string | null> {
  const r = await api<{ id?: string }>(`${commentId}/replies`, tokenOf(ch), { body: { message: text.trim().slice(0, 300) } });
  return r.id ?? null;
}
