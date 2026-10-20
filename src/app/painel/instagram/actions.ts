"use server";

import { revalidatePath } from "next/cache";
import { requireAgency } from "@/lib/agency";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit, requestMeta } from "@/lib/audit";
import { can } from "@/lib/team";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { ICE_BREAKERS_MAX, REF_LINKS_MAX, parseIceBreakers, parseRefLink, syncIceBreakers } from "@/lib/instagram-direct";
import { KEYWORDS_PER_BOT, keywordConflict, parseKeywordInput, type KeywordRow } from "@/lib/instagram-keywords";
import { commentsEnabled } from "@/lib/instagram";

/*
 * O direct do Instagram na aba Instagram do chatbot (E1, partes 3a e 3b): as perguntas prontas, os
 * links ig.me com origem e as palavras-chave. Quem configura o chatbot (dono, administrador e editor) mexe; cada
 * mudança vai para a auditoria.
 */

const DENIED = "O seu papel na equipe não permite mexer no Instagram do chatbot. Fale com o dono ou com um administrador da agência.";

async function context(botId: string) {
  const ctx = await requireAgency();
  if (!can(ctx.role, "config")) return null;
  // chatbot no escopo de quem está logado (RLS)
  const { data: bot } = await (await createClient()).from("bots").select("id, is_demo, is_template").eq("id", String(botId)).maybeSingle();
  if (!bot || bot.is_demo || bot.is_template) return null;
  return { ...ctx, botId: bot.id as string };
}

async function auditIg(ctx: NonNullable<Awaited<ReturnType<typeof context>>>, action: string, after: Record<string, unknown>) {
  await audit(createAdminClient(), { agencyId: ctx.agency.id, actorType: "user", actorId: ctx.userId, action, targetType: "bot", targetId: ctx.botId, after, ...(await requestMeta()) });
}

/** As perguntas prontas: gravadas no chatbot e, com o Instagram conectado, na conta da Meta. */
export async function saveIceBreakers(botId: string, fd: FormData): Promise<ActionResult> {
  const ctx = await context(botId);
  if (!ctx) return fail(DENIED);
  const parsed = parseIceBreakers(Array.from({ length: ICE_BREAKERS_MAX }, (_, i) => fd.get(`q${i + 1}`)));
  if ("error" in parsed) return fail(parsed.error);
  const db = createAdminClient();
  const { error } = await db.from("bots").update({ ig_ice_breakers: parsed.questions, ig_ice_breakers_error: null }).eq("id", ctx.botId);
  if (error) return fail("Não foi possível salvar. Tente de novo.");
  await auditIg(ctx, "instagram.perguntas_prontas", { perguntas: parsed.questions.length });
  const sync = await syncIceBreakers(db, ctx.botId);
  revalidatePath(`/painel/bots/${ctx.botId}`);
  if (sync.error) return fail(`Salvo no chatbot, mas ${sync.error.charAt(0).toLowerCase()}${sync.error.slice(1)}`);
  if (!sync.synced) return ok("Salvo. As perguntas vão para o Instagram quando a conta for conectada.");
  return ok(parsed.questions.length ? "Pronto: as perguntas aparecem para quem abrir o direct pela primeira vez (no app)." : "Pronto: as perguntas prontas saíram do Instagram.");
}

/** Um link ig.me com origem (bio, QR, anúncio). */
export async function addRefLink(botId: string, fd: FormData): Promise<ActionResult> {
  const ctx = await context(botId);
  if (!ctx) return fail(DENIED);
  const link = parseRefLink({ label: fd.get("label"), ref: fd.get("ref"), note: fd.get("note") });
  if ("error" in link) return fail(link.error);
  const db = createAdminClient();
  const { count } = await db.from("instagram_ref_links").select("id", { count: "exact", head: true }).eq("bot_id", ctx.botId);
  if ((count ?? 0) >= REF_LINKS_MAX) return fail(`Até ${REF_LINKS_MAX} links por chatbot.`);
  const { error } = await db.from("instagram_ref_links").insert({ bot_id: ctx.botId, ref: link.ref, label: link.label, note: link.note });
  if (error?.code === "23505") return fail(`Já existe um link com a origem “${link.ref}”.`);
  if (error) return fail("Não foi possível criar o link. Tente de novo.");
  await auditIg(ctx, "instagram.link_origem", { ref: link.ref, label: link.label });
  revalidatePath(`/painel/bots/${ctx.botId}`);
  return ok("Link criado: copie e use na bio, no QR ou no anúncio.");
}

export async function removeRefLink(botId: string, fd: FormData): Promise<ActionResult> {
  const ctx = await context(botId);
  if (!ctx) return fail(DENIED);
  const { data, error } = await createAdminClient().from("instagram_ref_links").delete().eq("id", String(fd.get("id") ?? "")).eq("bot_id", ctx.botId).select("ref");
  if (error || !data?.length) return fail("Link não encontrado.");
  await auditIg(ctx, "instagram.link_origem_removido", { ref: data[0].ref });
  revalidatePath(`/painel/bots/${ctx.botId}`);
  return ok("Link removido. Quem abrir o link antigo chega sem a origem.");
}

/** Uma palavra-chave (nova, ou a do id): as palavras e as respostas do direct e dos comentários. */
export async function saveKeyword(botId: string, fd: FormData): Promise<ActionResult> {
  const ctx = await context(botId);
  if (!ctx) return fail(DENIED);
  const db = createAdminClient();
  const id = String(fd.get("id") ?? "") || null;
  const { data: current } = id ? await db.from("instagram_keywords").select("comment_reply, comment_public, media_ids").eq("id", id).eq("bot_id", ctx.botId).maybeSingle() : { data: null };
  if (id && !current) return fail("Palavra-chave não encontrada.");
  const input = parseKeywordInput(
    { words: fd.get("words"), dm_reply: fd.get("dm_reply"), comment_reply: fd.get("comment_reply"), comment_public: fd.get("comment_public"), posts: fd.get("posts"), media_ids: fd.getAll("media_ids") },
    { comments: commentsEnabled(), keep: (current as Pick<KeywordRow, "comment_reply" | "comment_public" | "media_ids"> | null) ?? undefined },
  );
  if ("error" in input) return fail(input.error);
  const conflict = await keywordConflict(db, ctx.botId, input.words, id);
  if (conflict) return fail(conflict);
  if (!id) {
    const { count } = await db.from("instagram_keywords").select("id", { count: "exact", head: true }).eq("bot_id", ctx.botId);
    if ((count ?? 0) >= KEYWORDS_PER_BOT) return fail(`Até ${KEYWORDS_PER_BOT} palavras-chave por chatbot.`);
  }
  // nova: ligada; na edição, o que a caixa "ligada" disser
  const row = { ...input, active: fd.get("has_active") ? fd.get("active") === "on" : true };
  const { error } = id ? await db.from("instagram_keywords").update(row).eq("id", id).eq("bot_id", ctx.botId) : await db.from("instagram_keywords").insert({ ...row, bot_id: ctx.botId });
  if (error) return fail("Não foi possível salvar. Tente de novo.");
  await auditIg(ctx, id ? "instagram.palavra_chave_editar" : "instagram.palavra_chave", { palavras: input.words, direct: Boolean(input.dm_reply), comentario: Boolean(input.comment_reply || input.comment_public) });
  revalidatePath(`/painel/bots/${ctx.botId}`);
  return ok(id ? "Palavra-chave salva." : "Palavra-chave criada.");
}

export async function removeKeyword(botId: string, fd: FormData): Promise<ActionResult> {
  const ctx = await context(botId);
  if (!ctx) return fail(DENIED);
  const { data, error } = await createAdminClient().from("instagram_keywords").delete().eq("id", String(fd.get("id") ?? "")).eq("bot_id", ctx.botId).select("words");
  if (error || !data?.length) return fail("Palavra-chave não encontrada.");
  await auditIg(ctx, "instagram.palavra_chave_removida", { palavras: data[0].words });
  revalidatePath(`/painel/bots/${ctx.botId}`);
  return ok("Palavra-chave removida.");
}
