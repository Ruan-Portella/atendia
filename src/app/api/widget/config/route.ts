import { createAdminClient } from "@/lib/supabase/admin";
import { isChannelSuspended } from "@/lib/conversation-mode";
import { isBotSize } from "@/lib/plans";

/**
 * Configuração pública do widget, lida pelo widget.js ao carregar no site do cliente.
 * Assim, mudar cor/posição na aba Aparência vale na hora, sem trocar o código instalado.
 * GET /api/widget/config?key=CHAVE → { color, position, offset, live }
 */
export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("key") ?? "";
  const headers = {
    "Access-Control-Allow-Origin": "*",
    // navegador não guarda (o widget.js pede com no-store); CDN guarda 60 s
    "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
  };
  if (!/^[a-f0-9]{16,32}$/i.test(key)) return Response.json({ error: "bad_key" }, { status: 400, headers });

  const db = createAdminClient();
  const { data: bot } = await db.from("bots").select("id, status, is_demo, appearance, agency_id, size, quota_override").eq("public_key", key).maybeSingle();
  if (!bot) return Response.json({ error: "not_found" }, { status: 404, headers });
  // canal suspenso pela BoaVoz (regra de estado, degrau 2): o widget nem aparece no site
  const suspended = await isChannelSuspended(db, bot, "widget");
  // o chat do site só liga com tamanho (o Atendimento mostra o formulário de contato); a demo é à parte
  const sized = isBotSize(bot.size) || bot.quota_override !== null;

  const a = (bot.appearance ?? {}) as { color?: string; position?: string; offset?: number };
  let color = a.color;
  if (!color) {
    const { data: ag } = await db.from("agencies").select("brand_color").eq("id", bot.agency_id).maybeSingle();
    color = ag?.brand_color ?? "#1f4e3d";
  }
  return Response.json(
    {
      color,
      position: a.position === "left" ? "left" : "right",
      offset: Math.min(200, Math.max(0, Number(a.offset ?? 20) || 0)),
      live: !suspended && (bot.is_demo || (bot.status === "live" && sized)),
    },
    { headers },
  );
}
