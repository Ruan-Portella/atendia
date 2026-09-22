import { createAdminClient } from "@/lib/supabase/admin";

/**
 * O widget.js chama esta rota uma vez por sessão de navegação quando carrega num site.
 * Corpo: "CHAVE|dominio" (text/plain, sem preflight de CORS). Grava onde o bot está instalado
 * para o painel mostrar "Instalado em clinicasorriso.com.br".
 * Precisa da migração 0002 (colunas installed_at, installed_host, last_seen_at); sem ela, ignora em silêncio.
 */
export async function POST(req: Request) {
  const body = (await req.text().catch(() => "")).slice(0, 300);
  const [key, host] = body.split("|");
  if (!key || !/^[a-f0-9]{16,32}$/i.test(key)) return new Response(null, { status: 204 });
  const cleanHost = (host ?? "").toLowerCase().replace(/[^a-z0-9.:-]/g, "").slice(0, 120);
  if (!cleanHost || cleanHost.startsWith("localhost")) return new Response(null, { status: 204 });

  const db = createAdminClient();
  const now = new Date().toISOString();
  const { data: bot } = await db.from("bots").select("id, installed_at, installed_host").eq("public_key", key).eq("is_demo", false).maybeSingle();
  if (bot) {
    const patch: Record<string, unknown> = { last_seen_at: now, installed_host: cleanHost };
    if (!bot.installed_at) patch.installed_at = now;
    await db.from("bots").update(patch).eq("id", bot.id);
  }
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
