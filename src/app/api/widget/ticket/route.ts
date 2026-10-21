import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { SUSPENDED_NOTICE, isChannelSuspended } from "@/lib/conversation-mode";
import { CORS_HEADERS, type BotRow } from "@/lib/chat";
import { clientIp, firstExceeded, hashId, tooMany } from "@/lib/rate-limit";
import { ticketFormOf, ticketInputProblem } from "@/lib/tickets";
import { openTicket } from "@/lib/ticket-open";

/** Abrir chamado no chat do site (Caixa de entrada, parte 7a). */
const schema = z.object({
  key: z.string().min(8),
  visitorId: z.string().max(80).nullable().optional(),
  name: z.string().max(80),
  email: z.string().max(200),
  phone: z.string().max(40).nullable().optional(),
  subject: z.string().max(60).nullable().optional(),
  description: z.string().max(4000),
  whatsapp: z.boolean().optional(),
});

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_body", message: "Confira os campos e tente de novo." }, { status: 400, headers: CORS_HEADERS });
  const d = parsed.data;
  const db = createAdminClient();
  const { data: bot } = await db.from("bots").select("*").eq("public_key", d.key).maybeSingle<BotRow & { ticket_form?: unknown }>();
  // o bot modelo (D') não recebe chamado: quem atende são os derivados
  if (!bot || bot.is_template) return Response.json({ error: "bot_not_found" }, { status: 404, headers: CORS_HEADERS });
  const form = ticketFormOf(bot.ticket_form);
  if (!form) return Response.json({ error: "tickets_off", message: "Este atendimento não recebe chamados pelo site." }, { status: 404, headers: CORS_HEADERS });
  // canal suspenso pela BoaVoz (regra de estado, degrau 2): nem o chamado entra
  if (await isChannelSuspended(db, bot, "widget")) return Response.json({ error: "channel_suspended", message: SUSPENDED_NOTICE }, { status: 403, headers: CORS_HEADERS });
  const problem = ticketInputProblem(form, { name: d.name, email: d.email, phone: d.phone, subject: d.subject, description: d.description });
  if (problem) return Response.json({ error: "invalid_ticket", message: problem }, { status: 400, headers: CORS_HEADERS });
  const exceeded = await firstExceeded(db, [
    { key: `chamado:${bot.id}:ip:${hashId(clientIp(req))}`, max: 5, windowSeconds: 3600, message: "Recebemos vários chamados seus agora. A equipe já vai responder." },
    { key: `chamado:${bot.id}:email:${hashId(d.email.trim().toLowerCase())}`, max: 5, windowSeconds: 86_400, message: "Você já abriu vários chamados hoje. A equipe vai responder no seu e-mail." },
  ]);
  if (exceeded) return tooMany(exceeded, CORS_HEADERS);
  try {
    const { protocol } = await openTicket(db, bot, form, { name: d.name, email: d.email, phone: d.phone ?? null, subject: d.subject ?? null, description: d.description, visitorId: d.visitorId ?? null, whatsapp: d.whatsapp === true });
    return Response.json({ ok: true, protocol }, { headers: CORS_HEADERS });
  } catch (e) {
    console.error("chamado não aberto", (e as Error).message);
    return Response.json({ error: "ticket_failed", message: "Não foi possível abrir o chamado agora. Tente de novo em instantes." }, { status: 500, headers: CORS_HEADERS });
  }
}
