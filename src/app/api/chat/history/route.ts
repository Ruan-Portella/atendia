import { createAdminClient } from "@/lib/supabase/admin";
import { isResumable } from "@/lib/presence";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "no-store",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: HEADERS });
}

/**
 * O widget recarregou (F5, voltou ao site): devolve a conversa aberta para continuar de onde
 * parou. Só para o mesmo visitante (visitorId do navegador) e dentro de RESUME_HOURS.
 * GET ?key=CHAVE&conversationId=ID&visitorId=VISITANTE
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const key = sp.get("key") ?? "";
  const conversationId = sp.get("conversationId") ?? "";
  const visitorId = sp.get("visitorId") ?? "";
  if (!/^[a-f0-9]{16,32}$/i.test(key) || !/^[0-9a-f-]{36}$/i.test(conversationId) || !visitorId || visitorId.length > 80) {
    return Response.json({ error: "bad_request" }, { status: 400, headers: HEADERS });
  }
  const db = createAdminClient();
  const { data: conv } = await db
    .from("conversations")
    .select("id, visitor_id, last_message_at, handoff_requested_at, takeover_at, handled_at, bots!inner(public_key)")
    .eq("id", conversationId)
    .eq("bots.public_key", key)
    .maybeSingle();
  // outra pessoa, outro bot ou conversa velha: o widget começa uma nova
  if (!conv || conv.visitor_id !== visitorId || !isResumable(conv.last_message_at)) {
    return Response.json({ resumable: false }, { headers: HEADERS });
  }
  const { data: messages } = await db.from("messages").select("id, role, content").eq("conversation_id", conversationId).order("id").limit(200);
  const mode = conv.handled_at ? "bot" : conv.takeover_at ? "agent" : conv.handoff_requested_at ? "requested" : "bot";
  await db.from("conversations").update({ visitor_seen_at: new Date().toISOString() }).eq("id", conversationId);
  return Response.json({ resumable: true, mode, messages: messages ?? [] }, { headers: HEADERS });
}
