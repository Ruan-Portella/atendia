import { createAdminClient } from "@/lib/supabase/admin";
import { deadline, isCronAuthorized } from "@/lib/cron";
import { ingestSource, type SourceRow } from "@/lib/ingest";
import { daysAgoIso } from "@/lib/utils";

export const maxDuration = 60;

/**
 * Todo dia (vercel.json): relê sites e páginas de chatbots no ar que não são lidos há 7 dias.
 * Sem mudança no texto, só marca a data (sem custo de embedding). Com erro, a fonte segue
 * valendo com o conteúdo anterior. Processa as mais antigas primeiro, até perto do limite
 * de tempo; o que sobrar fica para o dia seguinte.
 */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return new Response("unauthorized", { status: 401 });
  const db = createAdminClient();
  const { data: sources } = await db
    .from("sources")
    .select("id, bot_id, kind, title, url, content, content_hash, bots!inner(status, is_demo, auto_refresh)")
    .in("kind", ["site", "page"])
    .eq("status", "ready")
    .eq("bots.status", "live")
    .eq("bots.is_demo", false)
    .eq("bots.auto_refresh", true)
    .lt("last_refreshed_at", daysAgoIso(7))
    .order("last_refreshed_at", { ascending: true })
    .limit(30);

  const hasTime = deadline(45_000);
  const result = { refreshed: 0, unchanged: 0, failed: 0, left: 0 };
  for (const s of sources ?? []) {
    if (!hasTime()) {
      result.left++;
      continue;
    }
    try {
      const r = await ingestSource(db, s as unknown as SourceRow, undefined, { background: true, previousHash: s.content_hash as string | null });
      if (r.unchanged) result.unchanged++;
      else result.refreshed++;
    } catch {
      result.failed++;
    }
  }
  return Response.json(result);
}
