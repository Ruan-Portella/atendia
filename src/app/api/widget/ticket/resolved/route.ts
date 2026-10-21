import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { CORS_HEADERS } from "@/lib/chat";
import { clientIp, firstExceeded, hashId } from "@/lib/rate-limit";
import { ticketFormOf } from "@/lib/tickets";
import { recordSuggestionEvent } from "@/lib/ticket-metrics";

/** "Resolveu, não preciso abrir" (Chamados, parte 7b): o chamado evitado entra no relatório. */
const schema = z.object({ key: z.string().min(8), subject: z.string().max(60).nullable().optional() });

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false }, { status: 400, headers: CORS_HEADERS });
  const db = createAdminClient();
  const { data: bot } = await db.from("bots").select("id, is_template, ticket_form").eq("public_key", parsed.data.key).maybeSingle();
  const form = bot && !bot.is_template ? ticketFormOf(bot.ticket_form) : null;
  if (!bot || !form) return Response.json({ ok: false }, { status: 404, headers: CORS_HEADERS });
  if (await firstExceeded(db, [{ key: `chamado-evitado:${bot.id}:ip:${hashId(clientIp(req))}`, max: 10, windowSeconds: 3600, message: "" }])) return Response.json({ ok: true }, { headers: CORS_HEADERS });
  const subject = parsed.data.subject && form.subjects.includes(parsed.data.subject) ? parsed.data.subject : null;
  await recordSuggestionEvent(db, { botId: bot.id as string, kind: "resolveu", subject });
  return Response.json({ ok: true }, { headers: CORS_HEADERS });
}
