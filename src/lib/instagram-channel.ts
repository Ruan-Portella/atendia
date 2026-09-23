import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyAgencyOwner } from "./notify";
import { seal, unseal } from "./secret-box";
import { appUrl } from "./utils";
import { InstagramError, exchangeInstagramCode, instagramMe, isInstagramAccessError, refreshInstagramToken, subscribeInstagram } from "./instagram";

/**
 * A conta do Instagram ligada a um chatbot: conectar (depois do login), perder o acesso (com aviso
 * à agência) e renovar o token de 60 dias no cron. Tudo com a service role.
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
export async function markInstagramDisconnected(db: SupabaseClient, where: { column: "bot_id" | "ig_user_id"; value: string }, reason: string): Promise<number> {
  const { data: rows } = await db
    .from("instagram_channels")
    .update({ disconnected_at: new Date().toISOString(), disconnect_reason: reason, access_token_enc: null })
    .eq(where.column, where.value)
    .is("disconnected_at", null)
    .select("bot_id, username, ig_user_id, bots(name, client_name, agency_id)");
  for (const r of rows ?? []) {
    const bot = (Array.isArray(r.bots) ? r.bots[0] : r.bots) as { name: string; client_name: string; agency_id: string } | null;
    console.warn("instagram: conta desconectada", r.ig_user_id, reason);
    if (!bot) continue;
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
      disconnected += await markInstagramDisconnected(db, { column: "bot_id", value: r.bot_id }, "o acesso venceu (60 dias sem renovar)");
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
