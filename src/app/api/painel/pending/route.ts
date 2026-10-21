import { createClient } from "@/lib/supabase/server";
import { getPendingHandoffs } from "@/lib/panel";
import { handoffStatus } from "@/lib/handoff-status";
import { createAdminClient } from "@/lib/supabase/admin";
import { markSeen } from "@/lib/availability";

/** Visitantes esperando atendente (para o aviso do painel da agência). A RLS limita à agência. */
export async function GET() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) return Response.json({ items: [] }, { status: 401 });
  const pending = await getPendingHandoffs(supabase);
  // o painel aberto: a presença para o rodízio dos setores (no máximo uma gravação por minuto)
  const admin = createAdminClient();
  const { data: me } = await admin.from("agency_members").select("id").eq("user_id", data.claims.sub).is("removed_at", null).not("accepted_at", "is", null).maybeSingle();
  if (me) await markSeen(admin, { type: "agency_member", id: me.id as string }).catch(() => undefined);
  const items = pending
    // pediu atendente, ou assumida e sem resposta há mais de 1 hora
    .filter((h) => handoffStatus(h)?.waiting)
    .map((h) => ({ id: h.id, href: `/painel/bots/${h.bot_id}/conversas/${h.id}`, title: [h.bots?.client_name, h.bots?.name].filter(Boolean).join(" · ") }));
  return Response.json({ items }, { headers: { "Cache-Control": "no-store" } });
}
