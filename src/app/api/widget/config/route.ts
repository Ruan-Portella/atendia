import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Configuração pública do widget, lida pelo widget.js ao carregar no site do cliente.
 * Assim, mudar cor/posição na aba Aparência vale na hora, sem trocar o código instalado.
 * GET /api/widget/config?key=CHAVE → { color, position, offset, live }
 */
export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("key") ?? "";
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
  };
  if (!/^[a-f0-9]{16,32}$/i.test(key)) return Response.json({ error: "bad_key" }, { status: 400, headers });

  const db = createAdminClient();
  const { data: bot } = await db.from("bots").select("status, is_demo, appearance, agency_id").eq("public_key", key).maybeSingle();
  if (!bot) return Response.json({ error: "not_found" }, { status: 404, headers });

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
      live: bot.is_demo || bot.status === "live",
    },
    { headers },
  );
}
