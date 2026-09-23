import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validSignature } from "@/lib/whatsapp";
import { handleInbound, type ChannelRow, type InboundMessage } from "@/lib/whatsapp-inbound";

export const maxDuration = 60;

interface WebhookBody {
  object?: string;
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string };
        contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
        messages?: InboundMessage[];
        statuses?: Array<{ status?: string; recipient_id?: string; errors?: Array<{ code?: number; title?: string }> }>;
      };
    }>;
  }>;
}

/** Cadastro do webhook no painel da Meta: ela manda o verify token e espera o challenge de volta. */
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (expected && p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === expected) {
    return new Response(p.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("forbidden", { status: 403 });
}

/**
 * Eventos do WhatsApp (mensagens recebidas e status de entrega). Responde 200 na hora e
 * trata depois (after): a Meta reenvia o evento se a resposta demora.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!validSignature(raw, req.headers.get("x-hub-signature-256"), process.env.WHATSAPP_APP_SECRET)) {
    return new Response("invalid signature", { status: 401 });
  }
  let body: WebhookBody;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("invalid body", { status: 400 });
  }
  if (body.object !== "whatsapp_business_account") return new Response("ok");

  const changes = (body.entry ?? []).flatMap((e) => e.changes ?? []).filter((c) => c.field === "messages" && c.value);
  if (changes.length) {
    after(async () => {
      const db = createAdminClient();
      for (const { value } of changes) {
        const phoneNumberId = value?.metadata?.phone_number_id;
        for (const s of value?.statuses ?? []) {
          if (s.status === "failed") console.warn("whatsapp: mensagem não entregue", phoneNumberId, s.errors?.[0]);
        }
        if (!phoneNumberId || !value?.messages?.length) continue;
        const { data: channel } = await db.from("whatsapp_channels").select("bot_id, phone_number_id, access_token_enc").eq("phone_number_id", phoneNumberId).maybeSingle<ChannelRow>();
        if (!channel) {
          console.warn("whatsapp: número sem chatbot ligado", phoneNumberId);
          continue;
        }
        for (const msg of value.messages) {
          const profileName = value.contacts?.find((c) => c.wa_id === msg.from)?.profile?.name ?? null;
          await handleInbound(db, channel, msg, profileName).catch((e) => console.error("whatsapp: erro na mensagem", msg.id, e));
        }
      }
    });
  }
  return new Response("ok");
}
