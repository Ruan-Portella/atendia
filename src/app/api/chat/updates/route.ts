import { createAdminClient } from "@/lib/supabase/admin";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "no-store",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: HEADERS });
}

/**
 * O widget consulta aqui enquanto a conversa está com atendimento humano.
 * GET ?key=CHAVE&conversationId=ID&after=ULTIMO_ID
 * → { mode: "bot" | "requested" | "agent", messages: [{ id, content }] } (só mensagens de atendente)
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const key = sp.get("key") ?? "";
  const conversationId = sp.get("conversationId") ?? "";
  const after = Math.max(0, Number(sp.get("after")) || 0);
  if (!/^[a-f0-9]{16,32}$/i.test(key) || !/^[0-9a-f-]{36}$/i.test(conversationId)) {
    return Response.json({ error: "bad_request" }, { status: 400, headers: HEADERS });
  }

  const db = createAdminClient();
  const { data: conv } = await db
    .from("conversations")
    .select("id, handoff_requested_at, takeover_at, handled_at, bots!inner(public_key)")
    .eq("id", conversationId)
    .eq("bots.public_key", key)
    .maybeSingle();
  if (!conv) return Response.json({ error: "not_found" }, { status: 404, headers: HEADERS });

  const { data: messages } = await db.from("messages").select("id, content").eq("conversation_id", conversationId).eq("role", "agent").gt("id", after).order("id").limit(50);
  const mode = conv.handled_at ? "bot" : conv.takeover_at ? "agent" : conv.handoff_requested_at ? "requested" : "bot";
  return Response.json({ mode, messages: messages ?? [] }, { headers: HEADERS });
}
