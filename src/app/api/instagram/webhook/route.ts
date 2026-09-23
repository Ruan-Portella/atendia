import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validSignature } from "@/lib/whatsapp";
import { isInstagramAccessError } from "@/lib/instagram";
import { IG_TOKEN_REJECTED, markInstagramDisconnected } from "@/lib/instagram-channel";
import { handleInstagramEcho, handleInstagramMessage, type IgChannelRow, type IgMessagingEvent } from "@/lib/instagram-inbound";

export const maxDuration = 60;

interface WebhookBody {
  object?: string;
  entry?: Array<{ id?: string; time?: number; messaging?: IgMessagingEvent[] }>;
}

/** Cadastro do webhook no painel da Meta: ela manda o verify token e espera o challenge de volta. */
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const expected = process.env.INSTAGRAM_VERIFY_TOKEN;
  if (expected && p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === expected) {
    return new Response(p.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("forbidden", { status: 403 });
}

/**
 * Mensagens diretas do Instagram (API com login do Instagram). Assinatura com a chave do app do
 * Instagram. Responde 200 na hora e trata depois (after): a Meta reenvia se a resposta demora.
 * Cada entrada é uma conta profissional (entry.id); `messaging` traz as DMs e os ecos.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!validSignature(raw, req.headers.get("x-hub-signature-256"), process.env.INSTAGRAM_APP_SECRET)) {
    return new Response("invalid signature", { status: 401 });
  }
  let body: WebhookBody;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("invalid body", { status: 400 });
  }
  if (body.object !== "instagram") return new Response("ok");

  const entries = (body.entry ?? []).filter((e) => e.id && e.messaging?.length);
  if (entries.length) {
    after(async () => {
      const db = createAdminClient();
      for (const entry of entries) {
        const { data: ch } = await db.from("instagram_channels").select("bot_id, ig_user_id, access_token_enc, disconnected_at").eq("ig_user_id", entry.id!).maybeSingle<IgChannelRow & { disconnected_at: string | null }>();
        if (!ch) {
          console.warn("instagram: conta sem chatbot ligado", entry.id);
          continue;
        }
        if (ch.disconnected_at) continue;
        for (const ev of entry.messaging!) {
          try {
            if (ev.message?.is_echo) await handleInstagramEcho(db, ch, ev);
            else if (ev.message || ev.postback) await handleInstagramMessage(db, ch, ev);
          } catch (e) {
            if (isInstagramAccessError(e)) {
              await markInstagramDisconnected(db, { column: "ig_user_id", value: entry.id! }, IG_TOKEN_REJECTED);
              break;
            }
            console.error("instagram: erro na mensagem", ev.message?.mid, e);
          }
        }
      }
    });
  }
  return new Response("ok");
}
