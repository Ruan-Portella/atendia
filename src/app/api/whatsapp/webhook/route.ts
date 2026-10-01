import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validSignature } from "@/lib/whatsapp";
import type { EchoMessage, InboundMessage } from "@/lib/whatsapp-inbound";
import { acceptInbound, sha256, type Group, type InboundInput } from "@/lib/inbound-queue";
import { processAfterWebhook, type WaPayload, type WaStatus } from "@/lib/inbound-process";
import { deadline } from "@/lib/cron";

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
        statuses?: WaStatus[];
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
 * (smb_message_echoes). Cada evento é gravado na fila (inbound_events) ANTES de responder 200:
 * se o banco falhar, responde 5xx e a Meta reenvia. O tratamento vem logo depois (after).
 * Histórico e contatos sincronizados do celular (history, smb_app_state_sync) só são confirmados.
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
  if (!changes.length) return new Response("ok");

  const db = createAdminClient();
  const groups: Group[] = [];
  try {
    for (const input of await toEvents(db, changes)) {
      const g = await acceptInbound(db, input);
      if (g) groups.push(g);
    }
  } catch (e) {
    console.error("whatsapp: evento não gravado na fila", e);
    return new Response("retry", { status: 503 });
  }
  if (groups.length) {
    const hasTime = deadline(50_000);
    after(() => processAfterWebhook(createAdminClient(), groups, hasTime));
  }
  return new Response("ok");
}

/** Um evento da fila por mensagem, eco, status ou mudança de conta. */
async function toEvents(db: ReturnType<typeof createAdminClient>, changes: Change[]): Promise<InboundInput[]> {
  const out: InboundInput[] = [];
  const botOf = new Map<string, string | null>();
  const bot = async (phoneNumberId: string) => {
    if (!botOf.has(phoneNumberId)) {
      const { data, error } = await db.from("whatsapp_channels").select("bot_id").eq("phone_number_id", phoneNumberId).maybeSingle();
      if (error) throw error;
      if (!data) console.warn("whatsapp: número sem chatbot ligado", phoneNumberId);
      botOf.set(phoneNumberId, data?.bot_id ?? null);
    }
    return botOf.get(phoneNumberId)!;
  };
  for (const change of changes) {
    const v = change.value!;
    if (change.field === "account_update") {
      const payload: WaPayload = { type: "account_update", entryId: change.entryId, event: v.event, wabaId: v.waba_info?.waba_id };
      out.push({ key: `account_update:${sha256(JSON.stringify(v))}`, source: "whatsapp", kind: "account_update", botId: null, payload });
      continue;
    }
    const phoneNumberId = v.metadata?.phone_number_id;
    if (!phoneNumberId) continue;
    const botId = await bot(phoneNumberId);
    if (!botId) continue;
    for (const echo of (v.message_echoes ?? []) as EchoMessage[]) {
      const payload: WaPayload = { type: "echo", phoneNumberId, echo };
      out.push({ key: `wa:echo:${echo.id}`, source: "whatsapp", kind: "echo", botId, contact: echo.to, payload });
    }
    for (const status of v.statuses ?? []) {
      const payload: WaPayload = { type: "status", phoneNumberId, status };
      out.push({ key: `wa:st:${status.id}:${status.status}`, source: "whatsapp", kind: "status", botId, payload });
    }
    for (const msg of (v.messages ?? []) as InboundMessage[]) {
      const profileName = v.contacts?.find((c) => c.wa_id === msg.from)?.profile?.name ?? null;
      const payload: WaPayload = { type: "msg", phoneNumberId, msg, profileName };
      out.push({ key: `wa:msg:${msg.id}`, source: "whatsapp", kind: "msg", botId, contact: msg.from, payload });
    }
  }
  return out;
}
