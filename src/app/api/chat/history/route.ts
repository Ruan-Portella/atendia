import { createAdminClient } from "@/lib/supabase/admin";
import { isResumable } from "@/lib/presence";
import { loadMessages } from "@/lib/messages";
import { WIDGET_ALLOW_HEADERS, conversationAccess, widgetWho } from "@/lib/widget-identity";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": WIDGET_ALLOW_HEADERS,
  "Cache-Control": "no-store",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: HEADERS });
}

/**
 * O widget recarregou (F5, voltou ao site): devolve a conversa aberta para continuar de onde
 * parou, dentro de RESUME_HOURS.
 * - Anônimo: GET ?key=CHAVE&conversationId=ID&visitorId=VISITANTE (o id que o navegador guardou).
 * - Com token (Authorization: Bearer, P2): acha sozinho a última conversa daquela pessoa e
 *   daquele contexto; o navegador não guarda o id de conversas de usuário.
 * Conversa de usuário nunca volta sem o token da mesma pessoa e do mesmo contexto.
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const key = sp.get("key") ?? "";
  const conversationId = sp.get("conversationId") ?? "";
  const visitorId = sp.get("visitorId") ?? "";
  if (!/^[a-f0-9]{16,32}$/i.test(key) || (conversationId && !/^[0-9a-f-]{36}$/i.test(conversationId)) || visitorId.length > 80) {
    return Response.json({ error: "bad_request" }, { status: 400, headers: HEADERS });
  }
  const db = createAdminClient();
  const { data: bot } = await db.from("bots").select("id, agency_id, client_id, public_key").eq("public_key", key).maybeSingle();
  if (!bot) return Response.json({ resumable: false }, { headers: HEADERS });
  const who = await widgetWho(db, bot, req);
  if (who.kind === "invalid") return Response.json({ error: "invalid_token" }, { status: 401, headers: HEADERS });

  const cols = "id, visitor_id, identity_hash, context_hash, last_message_at, handoff_requested_at, takeover_at, handled_at";
  let conv: { id: string; visitor_id: string | null; identity_hash: string | null; context_hash: string | null; last_message_at: string; handoff_requested_at: string | null; takeover_at: string | null; handled_at: string | null } | null = null;
  if (who.kind === "token" && (who.identityHash || who.contextHash)) {
    // a última conversa desta pessoa (ou deste navegador, se o token só traz contexto) neste contexto
    let q = db.from("conversations").select(cols).eq("bot_id", bot.id);
    q = who.identityHash ? q.eq("identity_hash", who.identityHash) : q.is("identity_hash", null).eq("visitor_id", visitorId);
    q = who.contextHash ? q.eq("context_hash", who.contextHash) : q.is("context_hash", null);
    const { data } = await q.order("last_message_at", { ascending: false }).limit(1).maybeSingle();
    conv = data;
  } else if (conversationId && visitorId) {
    const { data } = await db.from("conversations").select(cols).eq("id", conversationId).eq("bot_id", bot.id).maybeSingle();
    conv = data;
  }
  // outra pessoa, outro contexto, sem token numa conversa de usuário ou conversa velha: o widget começa uma nova
  if (!conv || conversationAccess(conv, who, visitorId || null) !== "ok" || !isResumable(conv.last_message_at)) {
    return Response.json({ resumable: false }, { headers: HEADERS });
  }
  const messages = await loadMessages(db, { conversationId: conv.id, limit: 200 }, ["id", "role", "content"] as const);
  const mode = conv.handled_at ? "bot" : conv.takeover_at ? "agent" : conv.handoff_requested_at ? "requested" : "bot";
  await db.from("conversations").update({ visitor_seen_at: new Date().toISOString() }).eq("id", conv.id);
  return Response.json({ resumable: true, conversationId: conv.id, mode, messages }, { headers: HEADERS });
}
