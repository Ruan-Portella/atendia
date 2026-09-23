import { createClient } from "@/lib/supabase/server";
import { getPendingHandoffs } from "@/lib/panel";

/** Visitantes esperando atendente (para o aviso do painel da agência). A RLS limita à agência. */
export async function GET() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) return Response.json({ items: [] }, { status: 401 });
  const pending = await getPendingHandoffs(supabase);
  const items = pending
    .filter((h) => !h.takeover_at)
    .map((h) => ({ id: h.id, href: `/painel/bots/${h.bot_id}/conversas/${h.id}`, title: [h.bots?.client_name, h.bots?.name].filter(Boolean).join(" · ") }));
  return Response.json({ items }, { headers: { "Cache-Control": "no-store" } });
}
