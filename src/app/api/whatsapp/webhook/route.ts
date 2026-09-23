import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validSignature } from "@/lib/whatsapp";
import { handleEcho, handleInbound, type ChannelRow, type EchoMessage, type InboundMessage } from "@/lib/whatsapp-inbound";
import { ACCESS_LOST_EVENTS, TOKEN_REJECTED, isAccessError, markDisconnected } from "@/lib/whatsapp-access";

export const maxDuration = 60;

interface WebhookBody {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string };
        contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
        messages?: InboundMessage[];
        // coexistência: o que o negócio mandou pelo app do celular
        message_echoes?: EchoMessage[];
        statuses?: Array<{ status?: string; recipient_id?: string; errors?: Array<{ code?: number; title?: string }> }>;
        // account_update
        event?: string;
        waba_info?: { waba_id?: string };
      };
    }>;
  }>;
}

type Change = NonNullable<NonNullable<WebhookBody["entry"]>[number]["changes"]>[number] & { entryId?: string };

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
 * Eventos do WhatsApp: mensagens recebidas, status de entrega, mudanças na conta (account_update,
 * ex.: o cliente removeu o app) e, na coexistência, as respostas mandadas pelo app do celular
 * (smb_message_echoes). Responde 200 na hora e trata depois (after): a Meta reenvia o evento se
 * a resposta demora. Histórico e contatos sincronizados do celular (history, smb_app_state_sync)
 * só são confirmados: o Boavoz não guarda conversas antigas do aparelho.
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

  const changes: Change[] = (body.entry ?? []).flatMap((e) => (e.changes ?? []).map((c) => ({ ...c, entryId: e.id }))).filter((c) => c.value && (c.field === "messages" || c.field === "account_update" || c.field === "smb_message_echoes"));
  if (changes.length) {
    after(async () => {
      const db = createAdminClient();
      for (const change of changes) {
        if (change.field === "account_update") await accountUpdate(db, change);
        else if (change.field === "smb_message_echoes") await echoes(db, change);
        else await messages(db, change);
      }
    });
  }
  return new Response("ok");
}

/** A conta do cliente deixou de ser nossa: desliga os números dela e avisa a agência. */
async function accountUpdate(db: ReturnType<typeof createAdminClient>, change: Change) {
  const reason = ACCESS_LOST_EVENTS[change.value?.event ?? ""];
  if (!reason) return;
  // a Meta manda o id da conta em waba_info; o id da entrada fica de reserva
  for (const wabaId of new Set([change.value?.waba_info?.waba_id, change.entryId].filter(Boolean) as string[])) {
    await markDisconnected(db, { column: "waba_id", value: wabaId }, reason);
  }
}

/** Número ligado e com acesso, ou null (sem chatbot, ou desconectado: não dá nem para responder). */
async function activeChannel(db: ReturnType<typeof createAdminClient>, phoneNumberId: string) {
  const { data: channel } = await db.from("whatsapp_channels").select("bot_id, phone_number_id, access_token_enc, disconnected_at").eq("phone_number_id", phoneNumberId).maybeSingle<ChannelRow & { disconnected_at: string | null }>();
  if (!channel) console.warn("whatsapp: número sem chatbot ligado", phoneNumberId);
  return channel && !channel.disconnected_at ? channel : null;
}

async function echoes(db: ReturnType<typeof createAdminClient>, { value }: Change) {
  const phoneNumberId = value?.metadata?.phone_number_id;
  if (!phoneNumberId || !value?.message_echoes?.length) return;
  const channel = await activeChannel(db, phoneNumberId);
  if (!channel) return;
  for (const echo of value.message_echoes) {
    await handleEcho(db, channel, echo).catch((e) => console.error("whatsapp: erro no eco do celular", echo.id, e));
  }
}

async function messages(db: ReturnType<typeof createAdminClient>, { value }: Change) {
  const phoneNumberId = value?.metadata?.phone_number_id;
  for (const s of value?.statuses ?? []) {
    if (s.status === "failed") console.warn("whatsapp: mensagem não entregue", phoneNumberId, s.errors?.[0]);
  }
  if (!phoneNumberId || !value?.messages?.length) return;
  const channel = await activeChannel(db, phoneNumberId);
  if (!channel) return;
  for (const msg of value.messages) {
    const profileName = value.contacts?.find((c) => c.wa_id === msg.from)?.profile?.name ?? null;
    try {
      await handleInbound(db, channel, msg, profileName);
    } catch (e) {
      if (isAccessError(e)) {
        await markDisconnected(db, { column: "phone_number_id", value: phoneNumberId }, TOKEN_REJECTED);
        return;
      }
      console.error("whatsapp: erro na mensagem", msg.id, e);
    }
  }
}
