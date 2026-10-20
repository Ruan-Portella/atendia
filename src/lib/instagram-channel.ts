import type { SupabaseClient } from "@supabase/supabase-js";
import { queueChannelEvent } from "./platform-events";
import { notifyAgencyOwner } from "./notify";
import { seal, unseal } from "./secret-box";
import { appUrl } from "./utils";
import { syncIceBreakers } from "./instagram-direct";
import { igProfileUrl, postsSourceTitle } from "./instagram-links";
import { InstagramError, exchangeInstagramCode, instagramMe, isInstagramAccessError, refreshInstagramToken, subscribeInstagram } from "./instagram";

/**
 * A conta do Instagram ligada a um chatbot: conectar (depois do login), perder o acesso (com aviso
 * à agência), renovar o token de 60 dias no cron e acompanhar a troca do nome de usuário. Tudo com
 * a service role.
 */

export const IG_TOKEN_REJECTED = "o Instagram recusou o acesso (o app foi removido, a senha mudou ou o acesso venceu)";

/** Depois do login: troca o código, confere a conta, inscreve nas mensagens e liga ao chatbot. */
export async function connectInstagram(db: SupabaseClient, opts: { botId: string; code: string; via: "painel" | "link" }): Promise<{ ok: true; username: string | null } | { ok: false; message: string }> {
  let token: string;
  let expiresAt: string;
  let me: Awaited<ReturnType<typeof instagramMe>>;
  try {
    ({ token, expiresAt } = await exchangeInstagramCode(opts.code));
    me = await instagramMe(token);
    await subscribeInstagram(token);
  } catch (e) {
    console.error("instagram: conexão falhou", e);
    return { ok: false, message: `O Instagram recusou a conexão: ${e instanceof InstagramError ? e.message : "erro desconhecido"}. Confira se a conta é profissional e tente de novo.` };
  }

  const { data: taken } = await db.from("instagram_channels").select("bot_id").eq("ig_user_id", me.igUserId).maybeSingle();
  if (taken && taken.bot_id !== opts.botId) return { ok: false, message: opts.via === "link" ? "Esta conta do Instagram já está ligada a outro assistente. Fale com a agência." : "Esta conta do Instagram já está ligada a outro chatbot. Desconecte lá primeiro." };

  await db.from("instagram_channels").delete().eq("bot_id", opts.botId);
  const { error } = await db.from("instagram_channels").insert({ bot_id: opts.botId, ig_user_id: me.igUserId, username: me.username, access_token_enc: seal(token), token_expires_at: expiresAt });
  if (error) return { ok: false, message: "A conta foi autorizada, mas não deu para salvar. Tente de novo." };
  // webhooks: channel.connected
  await queueChannelEvent(db, opts.botId, "connected", { type: "instagram", igUserId: me.igUserId, username: me.username ?? null }, { at: new Date().toISOString() });
  // perguntas prontas do direct (E1): as do chatbot vão para a conta nova
  await syncIceBreakers(db, opts.botId, { onlyIfAny: true }).catch((e) => console.warn("instagram: perguntas prontas", (e as Error).message));

  const { data: bot } = await db.from("bots").select("name, client_name, agency_id").eq("id", opts.botId).maybeSingle();
  if (bot) {
    await notifyAgencyOwner(db, bot.agency_id, `Instagram conectado: ${bot.client_name}`, [
      `${opts.via === "link" ? `${bot.client_name} conectou` : "Foi conectada"} a conta @${me.username ?? me.igUserId} do Instagram ao chatbot ${bot.name}. O assistente já responde as mensagens diretas.`,
      "",
      "As mensagens do Instagram não são cobradas pela Meta.",
      "Confira no Instagram da conta: Configurações → Mensagens e respostas a stories → Ferramentas conectadas → “Permitir acesso às mensagens” precisa estar ligado.",
      "",
      `Painel: ${appUrl(`/painel/bots/${opts.botId}?tab=instagram`)}`,
    ]).catch(() => false);
  }
  return { ok: true, username: me.username };
}

/** Marca a conta como desconectada, apaga o token e avisa a agência (uma vez só). */
export async function markInstagramDisconnected(db: SupabaseClient, where: { column: "bot_id" | "ig_user_id"; value: string }, reason: string, code = reason === IG_TOKEN_REJECTED ? "token_rejected" : "access_lost"): Promise<number> {
  const at = new Date().toISOString();
  const { data: rows } = await db
    .from("instagram_channels")
    .update({ disconnected_at: at, disconnect_reason: reason, access_token_enc: null })
    .eq(where.column, where.value)
    .is("disconnected_at", null)
    .select("bot_id, username, ig_user_id, bots(name, client_name, agency_id)");
  for (const r of rows ?? []) {
    const bot = (Array.isArray(r.bots) ? r.bots[0] : r.bots) as { name: string; client_name: string; agency_id: string } | null;
    console.warn("instagram: conta desconectada", r.ig_user_id, reason);
    if (!bot) continue;
    // webhooks: channel.disconnected com o motivo
    await queueChannelEvent(db, r.bot_id, "disconnected", { type: "instagram", igUserId: r.ig_user_id, username: r.username ?? null }, { at, reason: { code, message: reason } });
    await notifyAgencyOwner(db, bot.agency_id, `O Instagram de ${bot.client_name} foi desconectado`, [
      `A conta @${r.username ?? r.ig_user_id} do chatbot ${bot.name} (${bot.client_name}) foi desconectada: ${reason}.`,
      "",
      "O assistente parou de responder as mensagens diretas. As conversas antigas continuam no painel.",
      "",
      `Para voltar, conecte o Instagram de novo: ${appUrl(`/painel/bots/${r.bot_id}?tab=instagram`)}`,
    ]).catch(() => false);
  }
  return rows?.length ?? 0;
}

/**
 * Cron diário: renova os tokens que vencem em até 10 dias (a Meta só deixa renovar depois de 24 h
 * de vida, e o token dura 60 dias: sobra folga). Token já vencido ou recusado = desconectado.
 */
export async function refreshInstagramTokens(db: SupabaseClient): Promise<{ refreshed: number; disconnected: number }> {
  const soon = new Date(Date.now() + 10 * 86_400_000).toISOString();
  const { data: rows } = await db.from("instagram_channels").select("bot_id, access_token_enc, token_expires_at").is("disconnected_at", null).lt("token_expires_at", soon).limit(200);
  let refreshed = 0;
  let disconnected = 0;
  for (const r of rows ?? []) {
    if (!r.access_token_enc || (r.token_expires_at && new Date(r.token_expires_at) < new Date())) {
      disconnected += await markInstagramDisconnected(db, { column: "bot_id", value: r.bot_id }, "o acesso venceu (60 dias sem renovar)", "token_expired");
      continue;
    }
    try {
      const { token, expiresAt } = await refreshInstagramToken(unseal(r.access_token_enc));
      await db.from("instagram_channels").update({ access_token_enc: seal(token), token_expires_at: expiresAt }).eq("bot_id", r.bot_id);
      refreshed++;
    } catch (e) {
      if (isInstagramAccessError(e)) disconnected += await markInstagramDisconnected(db, { column: "bot_id", value: r.bot_id }, IG_TOKEN_REJECTED);
      else console.error("instagram: token não renovado", r.bot_id, e);
    }
  }
  return { refreshed, disconnected };
}

/* ------------------------------------------------------------------ nome de usuário */

/** Na aba do painel, o nome conferido vale 1 minuto (as ações da aba recarregam a página). */
export const IG_USERNAME_PANEL_MS = 60_000;
/** O cron diário pula as contas conferidas nas últimas 20 h (pelo painel ou por ele mesmo). */
const IG_USERNAME_DAILY_MS = 20 * 3_600_000;

type UsernameRow = { bot_id: string; ig_user_id: string; username: string | null; access_token_enc: string | null; username_checked_at: string | null };
export type UsernameChange = { username: string; previousUsername: string | null; changedAt: string };

const USERNAME_COLUMNS = "bot_id, ig_user_id, username, access_token_enc, username_checked_at";

/**
 * O nome de usuário muda no Instagram sem aviso (a Meta não manda webhook disso) e os links ig.me
 * (com origem e de pareamento) levam o nome: com o antigo, o link abre o Instagram mas não acha a
 * conversa. Confere na Meta (ao abrir a aba no painel e no cron diário) e, se mudou, guarda o novo e
 * o antigo (o painel avisa por 30 dias), acerta a fonte dos posts e avisa a agência quando o chatbot
 * tem links com origem, que estão na bio, no QR impresso e nos anúncios. Devolve a troca, se houve.
 * Erro da Meta não derruba nada: fica o nome guardado.
 */
export async function refreshInstagramUsername(db: SupabaseClient, botId: string, opts: { maxAgeMs: number; now?: number }): Promise<UsernameChange | null> {
  const { data } = await db.from("instagram_channels").select(USERNAME_COLUMNS).eq("bot_id", botId).is("disconnected_at", null).maybeSingle();
  return data ? checkUsername(db, data as UsernameRow, opts.maxAgeMs, opts.now ?? Date.now()) : null;
}

/** Cron diário: as contas conectadas que ninguém conferiu nas últimas 20 h. */
export async function refreshInstagramUsernames(db: SupabaseClient, hasTime: () => boolean = () => true): Promise<{ checked: number; renamed: number }> {
  const { data: rows } = await db.from("instagram_channels").select(USERNAME_COLUMNS).is("disconnected_at", null).order("username_checked_at", { ascending: true, nullsFirst: true }).limit(500);
  let checked = 0;
  let renamed = 0;
  for (const r of (rows ?? []) as UsernameRow[]) {
    if (!hasTime()) break;
    if (!usernameDue(r, IG_USERNAME_DAILY_MS, Date.now())) continue;
    checked++;
    if (await checkUsername(db, r, IG_USERNAME_DAILY_MS, Date.now())) renamed++;
  }
  return { checked, renamed };
}

const usernameDue = (r: UsernameRow, maxAgeMs: number, now: number) => Boolean(r.access_token_enc) && (!r.username_checked_at || now - Date.parse(r.username_checked_at) >= maxAgeMs);

async function checkUsername(db: SupabaseClient, r: UsernameRow, maxAgeMs: number, now: number): Promise<UsernameChange | null> {
  if (!usernameDue(r, maxAgeMs, now)) return null;
  const at = new Date(now).toISOString();
  let me: Awaited<ReturnType<typeof instagramMe>> | null = null;
  try {
    me = await instagramMe(unseal(r.access_token_enc as string), 4_000);
  } catch (e) {
    // quem desconecta a conta sem acesso é a renovação do token e o envio; aqui só conta como conferida
    console.warn("instagram: nome de usuário não conferido", r.bot_id, (e as Error).message);
  }
  // o id da conta não muda com o nome: token de outra conta (ou resposta sem nome) não troca nada
  const next = me && me.igUserId === r.ig_user_id && me.username ? me.username : null;
  if (!next || next === r.username) {
    await db.from("instagram_channels").update({ username_checked_at: at }).eq("bot_id", r.bot_id);
    return null;
  }
  // o painel e o cron podem ver a troca juntos: grava (e avisa) só quem ainda achou o nome antigo
  const rename = db.from("instagram_channels").update({ username: next, previous_username: r.username, username_changed_at: at, username_checked_at: at }).eq("bot_id", r.bot_id);
  const { data: won } = await (r.username === null ? rename.is("username", null) : rename.eq("username", r.username)).select("bot_id");
  if (!won?.length) return null;
  console.warn("instagram: a conta trocou o nome", r.ig_user_id, r.username, "→", next);
  await renamePostsSource(db, r, next);
  await notifyRename(db, r.bot_id, r.username, next);
  return { username: next, previousUsername: r.username, changedAt: at };
}

/** A fonte dos posts (E1): o link do perfil e o título padrão (o título que a loja escreveu fica). */
async function renamePostsSource(db: SupabaseClient, r: UsernameRow, next: string) {
  const { data: src } = await db.from("sources").select("id, title").eq("bot_id", r.bot_id).eq("kind", "instagram").maybeSingle();
  if (!src) return;
  const title = src.title === postsSourceTitle(r.username ?? r.ig_user_id) ? postsSourceTitle(next) : src.title;
  await db.from("sources").update({ url: igProfileUrl(next), title }).eq("id", src.id);
}

/** Com links com origem, a agência precisa trocar o da bio, o do QR impresso e o dos anúncios. */
async function notifyRename(db: SupabaseClient, botId: string, previous: string | null, next: string) {
  const { count } = await db.from("instagram_ref_links").select("id", { count: "exact", head: true }).eq("bot_id", botId);
  if (!count) return;
  const { data: bot } = await db.from("bots").select("name, client_name, agency_id").eq("id", botId).maybeSingle();
  if (!bot) return;
  await notifyAgencyOwner(db, bot.agency_id, `O Instagram de ${bot.client_name} agora é @${next}`, [
    `A conta${previous ? ` @${previous}` : ""} do chatbot ${bot.name} mudou o nome para @${next} no Instagram. O BoaVoz já atualizou o nome e os links com origem.`,
    "",
    "Os links com o nome antigo não abrem mais o direct: troque o da bio, o do QR impresso e o dos anúncios pelos links novos, na aba Instagram do painel.",
    "",
    `Painel: ${appUrl(`/painel/bots/${botId}?tab=instagram`)}`,
  ]).catch(() => false);
}
