import type { SupabaseClient } from "@supabase/supabase-js";
import { dictionaryHits } from "./gate/match";
import { PAIRING_ALPHABET } from "./pairing";
import { InstagramError, setInstagramIceBreakers, subscribeInstagram, type IgChannel } from "./instagram";
import { unseal } from "./secret-box";
import { ICE_BREAKERS_MAX, ICE_BREAKER_MAX, REF_LABEL_MAX, REF_NOTE_MAX, refFromLabel } from "./instagram-links";

/*
 * O direct do Instagram (E1, parte 3a; spec Peça 9):
 *  - perguntas prontas (ice breakers): até 4 perguntas que aparecem quando a pessoa abre o direct
 *    pela primeira vez (só no app); o toque chega como mensagem e a IA responde. Gravadas no chatbot
 *    e na conta da Meta (messenger_profile), de novo a cada conexão;
 *  - links ig.me com origem: ig.me/<conta>?ref=<origem> para a bio, o QR impresso e o anúncio. O
 *    ref chega no webhook e diz à IA e ao painel de onde a pessoa veio. Em conversa nova, a Meta só
 *    manda o ref quando a conta tem perguntas prontas. O ref de 6 letras do alfabeto do pareamento
 *    (P2) continua sendo pareamento.
 */

export { ICE_BREAKERS_MAX, ICE_BREAKER_MAX, REF_LINKS_MAX, REF_LABEL_MAX, REF_NOTE_MAX, igMeLink, refFromLabel } from "./instagram-links";
const REF_RE = /^[a-z0-9_-]{2,40}$/;
const PAIRING_REF_RE = new RegExp(`^[${PAIRING_ALPHABET}]{6}$`);

/** Texto que a loja escreve e que vira mensagem ou botão: nada de item proibido ou 18+ (o mesmo dicionário do portão). Pura. */
export function restrictedTerm(text: string): string | null {
  const hit = dictionaryHits(text, { channel: "instagram" }).find((h) => h.level === "proibido" || h.level === "regulamentado");
  return hit ? hit.term : null;
}

/** As perguntas prontas do formulário: até 4, sem repetir, até 80 caracteres e sem item restrito. Pura. */
export function parseIceBreakers(raw: Array<unknown>): { questions: string[] } | { error: string } {
  const questions: string[] = [];
  for (const v of raw) {
    const q = String(v ?? "").replace(/\s+/g, " ").trim();
    if (!q) continue;
    if (q.length > ICE_BREAKER_MAX) return { error: `Cada pergunta vai até ${ICE_BREAKER_MAX} caracteres.` };
    const term = restrictedTerm(q);
    if (term) return { error: `A pergunta “${q}” cita um item que não pode ser oferecido pelo Instagram (${term}).` };
    if (!questions.some((x) => x.toLowerCase() === q.toLowerCase())) questions.push(q);
  }
  if (questions.length > ICE_BREAKERS_MAX) return { error: `Até ${ICE_BREAKERS_MAX} perguntas.` };
  return { questions };
}

/** As perguntas gravadas no chatbot (bots.ig_ice_breakers). Pura. */
export const iceBreakersOf = (bot: { ig_ice_breakers?: unknown }): string[] => (Array.isArray(bot.ig_ice_breakers) ? bot.ig_ice_breakers.filter((q): q is string => typeof q === "string" && Boolean(q.trim())).slice(0, ICE_BREAKERS_MAX) : []);

/**
 * Grava as perguntas do chatbot na conta do Instagram dele. Sem conta conectada, fica para a
 * conexão. Devolve o erro da Meta, se houver (e guarda no chatbot, para o painel mostrar). Na
 * conexão (onlyIfAny), chatbot sem perguntas não apaga as que a conta já tinha.
 */
export async function syncIceBreakers(db: SupabaseClient, botId: string, o: { onlyIfAny?: boolean } = {}): Promise<{ synced: boolean; error: string | null }> {
  const [{ data: bot }, { data: ch }] = await Promise.all([
    db.from("bots").select("id, ig_ice_breakers").eq("id", botId).maybeSingle(),
    db.from("instagram_channels").select("bot_id, ig_user_id, access_token_enc, disconnected_at").eq("bot_id", botId).maybeSingle<IgChannel & { disconnected_at: string | null }>(),
  ]);
  if (!bot || !ch?.access_token_enc || ch.disconnected_at) return { synced: false, error: null };
  if (o.onlyIfAny && !iceBreakersOf(bot).length) return { synced: false, error: null };
  try {
    // a inscrição nos eventos também (o ref do link ig.me numa conversa antiga chega por messaging_referral)
    await subscribeInstagram(unseal(ch.access_token_enc)).catch((e) => console.warn("instagram: inscrição nos eventos", (e as Error).message));
    await setInstagramIceBreakers(ch, iceBreakersOf(bot));
    await db.from("bots").update({ ig_ice_breakers_synced_at: new Date().toISOString(), ig_ice_breakers_error: null }).eq("id", botId);
    return { synced: true, error: null };
  } catch (e) {
    const error = `O Instagram não aceitou as perguntas: ${e instanceof InstagramError ? e.message : "erro desconhecido"}`.slice(0, 900);
    await db.from("bots").update({ ig_ice_breakers_error: error }).eq("id", botId);
    return { synced: false, error };
  }
}

/* ------------------------------------------------------------------ links ig.me com origem */

export interface RefLink {
  ref: string;
  label: string;
  note: string | null;
}

/** O link do formulário: nome, ref (do nome, se vier vazio) e a nota para a IA. Pura. */
export function parseRefLink(input: { label: unknown; ref?: unknown; note?: unknown }): RefLink | { error: string } {
  const label = String(input.label ?? "").replace(/\s+/g, " ").trim();
  if (!label) return { error: "Dê um nome ao link (ex.: Bio, QR do balcão, Anúncio de outubro)." };
  if (label.length > REF_LABEL_MAX) return { error: `O nome vai até ${REF_LABEL_MAX} caracteres.` };
  const ref = String(input.ref ?? "").trim().toLowerCase() || refFromLabel(label);
  if (!REF_RE.test(ref)) return { error: "A origem usa só letras minúsculas, números, - e _ (de 2 a 40)." };
  // um ref de 6 letras do alfabeto do pareamento seria lido como código de pareamento
  if (PAIRING_REF_RE.test(ref.toUpperCase())) return { error: "Essa origem parece um código de pareamento. Use outra (ex.: com um - ou mais letras)." };
  const note = String(input.note ?? "").trim();
  if (note.length > REF_NOTE_MAX) return { error: `A nota vai até ${REF_NOTE_MAX} caracteres.` };
  return { ref, label, note: note || null };
}

/** Ref do link ig.me: pareamento (o código de 6 letras do P2) ou origem. Pura. */
export function refKind(ref: string): "pairing" | "origin" {
  return PAIRING_REF_RE.test(ref) ? "pairing" : "origin";
}

/** A origem de um ref do chatbot: o link cadastrado (com o nome e a nota) ou só o ref, quando não está cadastrado. */
export async function originOf(db: SupabaseClient, botId: string, ref: string): Promise<RefLink> {
  const { data } = await db.from("instagram_ref_links").select("ref, label, note").eq("bot_id", botId).eq("ref", ref.toLowerCase()).maybeSingle();
  return data ? { ref: data.ref as string, label: data.label as string, note: (data.note as string | null) ?? null } : { ref: ref.slice(0, 64), label: ref.slice(0, 64), note: null };
}

