import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { routineTestView } from "@/lib/routine-test";

/*
 * O roteiro da conversa do teste ao vivo (itens menores da conferência de 20/10, parte 5): o chat
 * de teste do chatbot pergunta, a cada poucos segundos, em que passo a conversa está. Só para quem
 * enxerga o chatbot (RLS) e só conversa dele; volta os nomes dos dados, nunca os valores.
 */

export async function GET(req: Request, ctx: RouteContext<"/api/bots/[id]/routine-test">) {
  const { id: botId } = await ctx.params;
  const conversationId = new URL(req.url).searchParams.get("conversationId") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(conversationId)) return Response.json({ error: "invalid_conversation" }, { status: 400 });
  const { data: bot } = await (await createClient()).from("bots").select("id").eq("id", botId).maybeSingle();
  if (!bot) return Response.json({ error: "not_found" }, { status: 404 });
  const db = createAdminClient();
  const { data: conv } = await db.from("conversations").select("id").eq("id", conversationId).eq("bot_id", botId).maybeSingle();
  if (!conv) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ run: await routineTestView(db, conversationId) }, { headers: { "Cache-Control": "no-store" } });
}
