import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validSignature } from "@/lib/whatsapp";
import { isInstagramAccessError } from "@/lib/instagram";
import { IG_TOKEN_REJECTED, markInstagramDisconnected } from "@/lib/instagram-channel";
import { handleInstagramEcho, handleInstagramMessage, type IgChannelRow, type IgMessagingEvent } from "@/lib/instagram-inbound";

export const maxDuration = 60;

interface WebhookBody {
  object?: string;
  entry?: Array<{ id?: string; time?: number; messaging?: IgMessagingEvent[]; changes?: Array<{ field?: string; value?: IgMessagingEvent }> }>;
}

/**
 * A Meta entrega as DMs em `messaging` (o normal) ou em `changes` com field "messages" (o botão
 * "Testar" do painel e algumas contas). Juntamos os dois no mesmo formato.
 */
function messagingEvents(entry: NonNullable<WebhookBody["entry"]>[number]): IgMessagingEvent[] {
  const fromChanges = (entry.changes ?? []).filter((c) => c.field === "messages" && c.value).map((c) => c.value!);
  return [...(entry.messaging ?? []), ...fromChanges];
}

type Channel = IgChannelRow & { disconnected_at: string | null };

/**
 * A conta do evento. Normalmente é o id da entrada; por garantia tenta também o destinatário
 * (DM recebida) ou o remetente (eco), que são o id da conta do cliente nesses casos.
 */
async function findChannel(db: ReturnType<typeof createAdminClient>, entry: NonNullable<WebhookBody["entry"]>[number]): Promise<Channel | null> {
  const ev = entry.messaging?.[0];
  const ids = [...new Set([entry.id, ev?.message?.is_echo ? ev.sender?.id : ev?.recipient?.id].filter(Boolean) as string[])];
  const { data } = await db.from("instagram_channels").select("bot_id, ig_user_id, access_token_enc, disconnected_at").in("ig_user_id", ids).limit(1).maybeSingle<Channel>();
  return data;
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

  const entries = (body.entry ?? []).map((e) => ({ ...e, messaging: messagingEvents(e) })).filter((e) => e.id && e.messaging.length);
  if (!entries.length) console.log("instagram: webhook sem mensagens", { entradas: body.entry?.length ?? 0, campos: body.entry?.flatMap((e) => (e.changes ?? []).map((c) => c.field)) });
  if (entries.length) {
    after(async () => {
      const db = createAdminClient();
      for (const entry of entries) {
        const ch = await findChannel(db, entry);
        if (!ch) {
          console.warn("instagram: conta sem chatbot ligado", { entry: entry.id, destinatario: entry.messaging?.[0]?.recipient?.id, remetente: entry.messaging?.[0]?.sender?.id });
          continue;
        }
        if (ch.disconnected_at) {
          console.log("instagram: conta desconectada, evento ignorado", ch.ig_user_id);
          continue;
        }
        for (const ev of entry.messaging!) {
          try {
            if (ev.message?.is_echo) await handleInstagramEcho(db, ch, ev);
            else if (ev.message || ev.postback) await handleInstagramMessage(db, ch, ev);
            // leitura, reação, edição…: nada a responder. Registra só o formato (sem conteúdo),
            // para enxergar o que a Meta mandou quando uma DM não é tratada
            else console.log("instagram: evento sem mensagem ignorado", { campos: Object.keys(ev) });
          } catch (e) {
            if (isInstagramAccessError(e)) {
              await markInstagramDisconnected(db, { column: "ig_user_id", value: ch.ig_user_id }, IG_TOKEN_REJECTED);
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
