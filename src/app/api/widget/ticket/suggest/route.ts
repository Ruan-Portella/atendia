import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { isChannelSuspended } from "@/lib/conversation-mode";
import { CORS_HEADERS, aiBlockedReason, type BotRow } from "@/lib/chat";
import { botHasAi } from "@/lib/plans";
import { recordAiUsage } from "@/lib/ai-usage";
import { clientIp, firstExceeded, hashId } from "@/lib/rate-limit";
import { ticketFormOf } from "@/lib/tickets";
import { suggestForTicket } from "@/lib/ticket-suggest";
import { recordSuggestionEvent } from "@/lib/ticket-metrics";

/** A sugestão da base antes de abrir o chamado (Chamados, parte 7b). Sem sugestão: { suggestion: null }. */
const schema = z.object({
  key: z.string().min(8),
  visitorId: z.string().max(80).nullable().optional(),
  subject: z.string().max(60).nullable().optional(),
  text: z.string().max(4000),
});

const none = () => Response.json({ suggestion: null }, { headers: CORS_HEADERS });

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return none();
  const d = parsed.data;
  const db = createAdminClient();
  const { data: bot } = await db.from("bots").select("*").eq("public_key", d.key).maybeSingle<BotRow & { ticket_form?: unknown }>();
  const form = bot && !bot.is_template ? ticketFormOf(bot.ticket_form) : null;
  // só com o formulário ligado e um tamanho com IA; a IA pausada da conta (pagamento) também não sugere
  if (!bot || !form || !botHasAi(bot) || (await aiBlockedReason(db, bot.agency_id)) || (await isChannelSuspended(db, bot, "widget"))) return none();
  const subject = d.subject && form.subjects.includes(d.subject) ? d.subject : null;
  const exceeded = await firstExceeded(db, [
    { key: `chamado-sugestao:${bot.id}:ip:${hashId(clientIp(req))}`, max: 10, windowSeconds: 600, message: "" },
    ...(d.visitorId ? [{ key: `chamado-sugestao:${bot.id}:v:${hashId(d.visitorId)}`, max: 6, windowSeconds: 600, message: "" }] : []),
  ]);
  if (exceeded) return none();
  const suggestion = await suggestForTicket(db, bot, {
    subject,
    text: d.text,
    onUsage: (u) => void recordAiUsage(db, { agencyId: bot.agency_id, botId: bot.id, kind: "resposta", channel: "widget", ...u }),
  });
  if (suggestion) await recordSuggestionEvent(db, { botId: bot.id, kind: "mostrada", subject });
  return Response.json({ suggestion }, { headers: CORS_HEADERS });
}
