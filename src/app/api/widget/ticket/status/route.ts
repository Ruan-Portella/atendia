import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { CORS_HEADERS } from "@/lib/chat";
import { clientIp, firstExceeded, hashId, tooMany } from "@/lib/rate-limit";
import { parseProtocol } from "@/lib/tickets";
import { addTicketMessage, ticketByProtocol, ticketThread } from "@/lib/ticket-follow";

/**
 * Acompanhar o chamado no chat do site (Chamados, parte 7c): com o protocolo e o e-mail de quem
 * abriu, o status, o assunto e as mensagens (as notas internas nunca). Com `text`, a pessoa
 * escreve de novo e o chamado volta para a equipe.
 */
const schema = z.object({ key: z.string().min(8), protocol: z.string().max(20), email: z.string().max(200), text: z.string().max(4000).optional() });

const notFound = () => Response.json({ error: "not_found", message: "Não achamos esse chamado. Confira o protocolo e o e-mail usado para abrir." }, { status: 404, headers: CORS_HEADERS });

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return notFound();
  const d = parsed.data;
  const protocol = parseProtocol(d.protocol);
  if (!protocol) return notFound();
  const db = createAdminClient();
  // limite por IP: o protocolo junto do e-mail não se acha no chute
  const exceeded = await firstExceeded(db, [
    { key: `chamado-acompanhar:ip:${hashId(clientIp(req))}`, max: 20, windowSeconds: 600, message: "Muitas consultas seguidas. Tente de novo em alguns minutos." },
    ...(d.text ? [{ key: `chamado-mensagem:${protocol}`, max: 10, windowSeconds: 3600, message: "Você mandou várias mensagens agora. A equipe já vai responder." }] : []),
  ]);
  if (exceeded) return tooMany(exceeded, CORS_HEADERS);
  const { data: bot } = await db.from("bots").select("id, is_template").eq("public_key", d.key).maybeSingle();
  if (!bot || bot.is_template) return notFound();
  const ticket = await ticketByProtocol(db, bot.id as string, protocol, d.email);
  if (!ticket) return notFound();
  if (d.text !== undefined) {
    const r = await addTicketMessage(db, ticket, d.text);
    if (!r.ok) return Response.json({ error: "invalid_message", message: r.message }, { status: 400, headers: CORS_HEADERS });
  }
  const fresh = d.text !== undefined ? ((await ticketByProtocol(db, bot.id as string, protocol, d.email)) ?? ticket) : ticket;
  return Response.json({ protocol, status: fresh.ticket_status, subject: fresh.ticket_subject, messages: await ticketThread(db, ticket.id) }, { headers: CORS_HEADERS });
}
