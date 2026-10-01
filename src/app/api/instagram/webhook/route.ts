import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validSignature } from "@/lib/whatsapp";
import type { IgChannelRow, IgMessagingEvent } from "@/lib/instagram-inbound";
import { acceptInbound, type Group } from "@/lib/inbound-queue";
import { processAfterWebhook, type IgPayload } from "@/lib/inbound-process";
import { deadline } from "@/lib/cron";

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

/**
 * Formato do webhook para o log, sem conteúdo: tipo, campos de cada entrada e de cada evento e os
 * ids envolvidos. É o que precisamos para entender um evento que não foi tratado.
 */
function shape(body: WebhookBody) {
  return {
    objeto: body.object,
    camposDoCorpo: Object.keys(body),
    entradas: (body.entry ?? []).map((e) => ({
      id: e.id,
      campos: Object.keys(e),
      changes: (e.changes ?? []).map((c) => c.field),
      eventos: (e.messaging ?? []).map((ev) => ({ campos: Object.keys(ev), mensagem: Object.keys(ev.message ?? {}), de: ev.sender?.id, para: ev.recipient?.id })),
    })),
  };
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
 * Instagram. Cada DM e eco é gravado na fila (inbound_events) ANTES de responder 200; se o banco
 * falhar, responde 5xx e a Meta reenvia. O tratamento vem logo depois (after).
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
  // "instagram" é o normal; "page" é o formato do Messenger, que a Meta às vezes usa para o Instagram
  if (body.object !== "instagram" && body.object !== "page") {
    console.log("instagram: webhook de outro tipo ignorado", shape(body));
    return new Response("ok");
  }

  const entries = (body.entry ?? []).map((e) => ({ ...e, messaging: messagingEvents(e) })).filter((e) => e.id && e.messaging.length);
  if (!entries.length) console.log("instagram: webhook sem mensagens", shape(body));
  if (!entries.length) return new Response("ok");

  const db = createAdminClient();
  const groups: Group[] = [];
  try {
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
        const echo = Boolean(ev.message?.is_echo);
        const mid = ev.message?.mid ?? ev.postback?.mid;
        // DM apagada e evento sem id não têm o que tratar
        if (!mid || ev.message?.is_deleted || (!echo && !ev.message && !ev.postback)) continue;
        const contact = echo ? ev.recipient?.id : ev.sender?.id;
        if (!contact) continue;
        const payload: IgPayload = { type: echo ? "echo" : "msg", igUserId: ch.ig_user_id, ev };
        const g = await acceptInbound(db, { key: `ig:${echo ? "echo" : "msg"}:${mid}`, source: "instagram", kind: echo ? "echo" : "msg", botId: ch.bot_id, contact, payload });
        if (g) groups.push(g);
        else console.log("instagram: evento repetido ignorado", mid);
      }
    }
  } catch (e) {
    console.error("instagram: evento não gravado na fila", e);
    return new Response("retry", { status: 503 });
  }
  if (groups.length) {
    const hasTime = deadline(50_000);
    after(() => processAfterWebhook(createAdminClient(), groups, hasTime));
  }
  return new Response("ok");
}
