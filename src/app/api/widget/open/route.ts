import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp, firstExceeded } from "@/lib/rate-limit";
import { hmacHex } from "@/lib/hash";

/**
 * O widget.js chama esta rota na primeira vez que o chat abre numa sessão de navegação (o funil do
 * relatório: aberturas → conversas → leads → atendente). Corpo: a chave do chatbot (text/plain, sem
 * preflight de CORS). Só soma no contador do dia, sem dado pessoal; o mesmo IP conta no máximo 20
 * vezes por hora em cada chatbot, para um script não inflar o número.
 */
export async function POST(req: Request) {
  const key = (await req.text().catch(() => "")).trim().slice(0, 64);
  if (!/^[a-f0-9]{16,32}$/i.test(key)) return new Response(null, { status: 204 });
  const db = createAdminClient();
  const { data: bot } = await db.from("bots").select("id").eq("public_key", key).eq("is_demo", false).maybeSingle();
  if (bot) {
    let ipKey = "sem-ip";
    try {
      ipKey = hmacHex(`abertura:${clientIp(req)}`).slice(0, 24);
    } catch {}
    const limited = await firstExceeded(db, [{ key: `wopen:${bot.id}:${ipKey}`, max: 20, windowSeconds: 3600, message: "" }]);
    if (!limited) {
      const { error } = await db.rpc("widget_open_hit", { p_bot_id: bot.id });
      if (error) console.warn("widget: abertura não contada", error.message);
    }
  }
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
