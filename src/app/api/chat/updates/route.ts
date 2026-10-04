import { createAdminClient } from "@/lib/supabase/admin";
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
 * O widget consulta aqui enquanto o chat está aberto: traz as respostas da equipe e serve de
 * sinal de "visitante online" (visitor_seen_at).
 * GET ?key=CHAVE&conversationId=ID&after=ULTIMO_ID&visitorId=VISITANTE (conversa de usuário: com o token, P2)
 * → { mode: "bot" | "requested" | "agent", messages: [{ id, content }] } (só mensagens de atendente)
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const key = sp.get("key") ?? "";
  const conversationId = sp.get("conversationId") ?? "";
  const after = Math.max(0, Number(sp.get("after")) || 0);
  const visitorId = sp.get("visitorId");
  if (!/^[a-f0-9]{16,32}$/i.test(key) || !/^[0-9a-f-]{36}$/i.test(conversationId)) {
    return Response.json({ error: "bad_request" }, { status: 400, headers: HEADERS });
  }

  const db = createAdminClient();
  const { data: conv } = await db
    .from("conversations")
    .select("id, visitor_id, identity_hash, context_hash, handoff_requested_at, takeover_at, handled_at, bots!inner(id, agency_id, client_id, public_key)")
    .eq("id", conversationId)
    .eq("bots.public_key", key)
    .maybeSingle();
  if (!conv) return Response.json({ error: "not_found" }, { status: 404, headers: HEADERS });
  // conversa de usuário (P2): só com o token da mesma pessoa e do mesmo contexto
  if (conv.identity_hash || conv.context_hash) {
    const bot = conv.bots as unknown as { id: string; agency_id: string; client_id: string | null; public_key: string };
    const who = await widgetWho(db, bot, req);
    if (who.kind === "invalid") return Response.json({ error: "invalid_token" }, { status: 401, headers: HEADERS });
    if (conversationAccess(conv, who, visitorId) !== "ok") return Response.json({ error: "not_found" }, { status: 404, headers: HEADERS });
  }

  const now = Date.now();
  await db
    .from("conversations")
    .update({ visitor_seen_at: new Date(now).toISOString() })
    .eq("id", conversationId)
    .or(`visitor_seen_at.is.null,visitor_seen_at.lt.${new Date(now - 20_000).toISOString()}`);

  const messages = await loadMessages(db, { conversationId, roles: ["agent"], afterId: after, limit: 50 }, ["id", "content"] as const);
  const mode = conv.handled_at ? "bot" : conv.takeover_at ? "agent" : conv.handoff_requested_at ? "requested" : "bot";
  return Response.json({ mode, messages }, { headers: HEADERS });
}
