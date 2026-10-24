import { createAdminClient } from "@/lib/supabase/admin";
import { loadMessages } from "@/lib/messages";
import { facesOfMessages, holderFace } from "@/lib/attendants";
import { WIDGET_ALLOW_HEADERS, conversationAccess, widgetWho } from "@/lib/widget-identity";
import { apiPauseActive } from "@/lib/presence";
import { attachmentsOfMessages } from "@/lib/attachments";
import { widgetFile } from "@/lib/file-links";
import { parseComponents } from "@/lib/components";

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
 * → { mode: "bot" | "requested" | "agent", agent: { name, avatar } | null, messages: [{ id, content, name, avatar }] }
 *   (só mensagens de atendente; nome de exibição e foto de quem escreveu, nunca o e-mail)
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
    .select("id, channel, visitor_id, identity_hash, context_hash, handoff_requested_at, takeover_at, handled_at, assigned_to_type, assigned_to_id, assigned_to_name, ai_paused_until, bots!inner(id, agency_id, client_id, public_key)")
    .eq("id", conversationId)
    .eq("bots.public_key", key)
    .maybeSingle();
  // só conversa do chat do site (WhatsApp e Instagram não passam por aqui)
  if (!conv || !["widget", "demo", "painel"].includes(String(conv.channel))) return Response.json({ error: "not_found" }, { status: 404, headers: HEADERS });
  // a mesma regra do chat: conversa de usuário (P2) só com o token da mesma pessoa e do mesmo
  // contexto; a anônima, só do mesmo navegador (relatório de segurança de 23/10/2026: antes, o id
  // da conversa bastava)
  const bot = conv.bots as unknown as { id: string; agency_id: string; client_id: string | null; public_key: string };
  const who = await widgetWho(db, bot, req);
  if (who.kind === "invalid") return Response.json({ error: "invalid_token" }, { status: 401, headers: HEADERS });
  if (conversationAccess(conv, who, visitorId || null) === "denied") return Response.json({ error: "not_found" }, { status: 404, headers: HEADERS });

  const now = Date.now();
  await db
    .from("conversations")
    .update({ visitor_seen_at: new Date(now).toISOString() })
    .eq("id", conversationId)
    .or(`visitor_seen_at.is.null,visitor_seen_at.lt.${new Date(now - 20_000).toISOString()}`);

  const rows = await loadMessages(db, { conversationId, roles: ["agent"], afterId: after, limit: 50 }, ["id", "content", "author_type", "author_id", "author_display_name", "components_enc"] as const);
  const faces = await facesOfMessages(db, rows);
  // imagem ou documento mandado pela equipe ou pela API: link assinado de 1 hora
  const files = await attachmentsOfMessages(db, rows.map((m) => m.id));
  // botões, lista ou link mandados pela integração (API, C pública parte 5b)
  const messages = rows.map((m) => ({ id: m.id, content: m.content, name: faces.get(m.id)?.name ?? null, avatar: faces.get(m.id)?.avatar ?? null, file: widgetFile(files.get(m.id)), ...(m.components_enc ? { components: parseComponents(m.components_enc) } : {}) }));
  // a integração pausou a IA (API): quem responde é ela, como um atendente
  const mode = conv.takeover_at && !conv.handled_at ? "agent" : apiPauseActive(conv.ai_paused_until) ? "agent" : conv.handoff_requested_at && !conv.handled_at ? "requested" : "bot";
  return Response.json({ mode, agent: await holderFace(db, conv), messages }, { headers: HEADERS });
}
