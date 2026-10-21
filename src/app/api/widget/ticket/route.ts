import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { SUSPENDED_NOTICE, isChannelSuspended } from "@/lib/conversation-mode";
import { CORS_HEADERS, type BotRow } from "@/lib/chat";
import { clientIp, firstExceeded, hashId, tooMany } from "@/lib/rate-limit";
import { TICKET_FILE_MAX_BYTES, ticketFileMime, ticketFormOf, ticketInputProblem } from "@/lib/tickets";
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

/** O corpo: JSON, ou formulário (multipart) quando vem o anexo. */
async function readBody(req: Request): Promise<{ raw: unknown; file: File | null }> {
  if (!req.headers.get("content-type")?.includes("multipart/form-data")) return { raw: await req.json().catch(() => null), file: null };
  const fd = await req.formData().catch(() => null);
  if (!fd) return { raw: null, file: null };
  const text = (k: string) => (typeof fd.get(k) === "string" ? (fd.get(k) as string) : undefined);
  const file = fd.get("file");
  return {
    raw: { key: text("key"), visitorId: text("visitorId") || null, name: text("name"), email: text("email"), phone: text("phone") || null, subject: text("subject") || null, description: text("description"), whatsapp: text("whatsapp") === "true" },
    file: file instanceof File && file.size > 0 ? file : null,
  };
}

export async function POST(req: Request) {
  const { raw, file } = await readBody(req);
  const parsed = schema.safeParse(raw);
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
  // o anexo: só com a opção ligada, um arquivo, foto ou PDF pelos primeiros bytes, até 4 MB
  let attachment: { data: Uint8Array; mime: string; filename: string | null } | null = null;
  if (file) {
    if (!form.attachment) return Response.json({ error: "attachment_off", message: "Este chamado não aceita anexo." }, { status: 400, headers: CORS_HEADERS });
    if (file.size > TICKET_FILE_MAX_BYTES) return Response.json({ error: "attachment_too_large", message: "O anexo vai até 4 MB. Mande uma foto menor ou um PDF mais leve." }, { status: 400, headers: CORS_HEADERS });
    const data = new Uint8Array(await file.arrayBuffer());
    const mime = ticketFileMime(data);
    if (!mime) return Response.json({ error: "attachment_type", message: "O anexo precisa ser uma foto (JPEG, PNG ou WEBP) ou um PDF." }, { status: 400, headers: CORS_HEADERS });
    attachment = { data, mime, filename: file.name ? file.name.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 120) : null };
  }
  try {
    const { protocol } = await openTicket(db, bot, form, { name: d.name, email: d.email, phone: d.phone ?? null, subject: d.subject ?? null, description: d.description, visitorId: d.visitorId ?? null, whatsapp: d.whatsapp === true, attachment });
    return Response.json({ ok: true, protocol }, { headers: CORS_HEADERS });
  } catch (e) {
    console.error("chamado não aberto", (e as Error).message);
    return Response.json({ error: "ticket_failed", message: "Não foi possível abrir o chamado agora. Tente de novo em instantes." }, { status: 500, headers: CORS_HEADERS });
  }
}
