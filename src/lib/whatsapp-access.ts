import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyAgencyOwner } from "./notify";
import { PAYMENT_ISSUE_CODE, WHATSAPP_BILLING_URL, WhatsAppError } from "./whatsapp";
import { appUrl } from "./utils";

/**
 * Número do WhatsApp que perdeu o acesso: o cliente removeu o app do Boavoz no Facebook, tirou
 * o compartilhamento da conta ou a conta foi excluída. Sem isso o assistente pararia em silêncio.
 */

/** Erros da Graph API que querem dizer "este token não vale mais para esta conta". */
const ACCESS_CODES = new Set([190, 10, 200]);

export function isAccessError(e: unknown): boolean {
  return e instanceof WhatsAppError && e.code !== undefined && ACCESS_CODES.has(e.code);
}

/** Eventos do webhook account_update em que o Boavoz deixa de ter acesso à conta do cliente. */
export const ACCESS_LOST_EVENTS: Record<string, string> = {
  PARTNER_APP_UNINSTALLED: "o cliente removeu o app do Boavoz da conta do WhatsApp",
  PARTNER_REMOVED: "a conta do WhatsApp deixou de ser compartilhada com o Boavoz",
  ACCOUNT_DELETED: "a conta do WhatsApp foi excluída",
  ACCOUNT_OFFBOARDED: "a conta do WhatsApp saiu da API",
};

export function isPaymentError(e: unknown): boolean {
  return e instanceof WhatsAppError && e.code === PAYMENT_ISSUE_CODE;
}

/**
 * A Meta recusou mensagens por falta de pagamento (o cliente não cadastrou cartão, ou ele foi
 * recusado): marca o número e avisa a agência, uma vez só até ser resolvido. O número continua
 * conectado; volta a funcionar sozinho quando o cartão entrar.
 */
export async function markPaymentIssue(db: SupabaseClient, where: { column: "bot_id" | "phone_number_id"; value: string }): Promise<void> {
  const { data: rows } = await db
    .from("whatsapp_channels")
    .update({ payment_issue_at: new Date().toISOString() })
    .eq(where.column, where.value)
    .is("payment_issue_at", null)
    .select("bot_id, display_phone, phone_number_id, bots(name, client_name, agency_id)");
  for (const r of rows ?? []) {
    const bot = (Array.isArray(r.bots) ? r.bots[0] : r.bots) as { name: string; client_name: string; agency_id: string } | null;
    console.warn("whatsapp: mensagens recusadas por pagamento", r.phone_number_id);
    if (!bot) continue;
    await notifyAgencyOwner(db, bot.agency_id, `WhatsApp de ${bot.client_name}: a Meta está recusando mensagens`, [
      `A Meta recusou mensagens do número ${r.display_phone ?? r.phone_number_id} (${bot.name} · ${bot.client_name}) por falta de forma de pagamento.`,
      "",
      "Enquanto isso, o assistente não consegue responder por WhatsApp. As mensagens do WhatsApp são cobradas pela Meta direto do cliente.",
      "",
      `Peça ao cliente para cadastrar ou atualizar o cartão no Gerenciador do WhatsApp (Configurações de pagamento): ${WHATSAPP_BILLING_URL}`,
      "",
      `Painel: ${appUrl(`/painel/bots/${r.bot_id}?tab=whatsapp`)}`,
    ]).catch(() => false);
  }
}

export const TOKEN_REJECTED = "a Meta recusou o acesso (o app foi removido ou a permissão foi revogada)";

/**
 * Marca como desconectado(s) o(s) número(s) que batem com o filtro, apaga o token (não vale mais
 * e a política diz que ele sai ao desconectar) e avisa o dono de cada agência, uma vez só.
 * Service role. Devolve quantos números foram marcados agora.
 */
export async function markDisconnected(db: SupabaseClient, where: { column: "bot_id" | "phone_number_id" | "waba_id"; value: string }, reason: string): Promise<number> {
  const { data: rows } = await db
    .from("whatsapp_channels")
    .update({ disconnected_at: new Date().toISOString(), disconnect_reason: reason, access_token_enc: null })
    .eq(where.column, where.value)
    .is("disconnected_at", null)
    .select("bot_id, display_phone, phone_number_id, bots(name, client_name, agency_id)");

  for (const r of rows ?? []) {
    const bot = (Array.isArray(r.bots) ? r.bots[0] : r.bots) as { name: string; client_name: string; agency_id: string } | null;
    console.warn("whatsapp: número desconectado", r.phone_number_id, reason);
    if (!bot) continue;
    await notifyAgencyOwner(db, bot.agency_id, `O WhatsApp de ${bot.client_name} foi desconectado`, [
      `O número ${r.display_phone ?? r.phone_number_id} do chatbot ${bot.name} (${bot.client_name}) foi desconectado: ${reason}.`,
      "",
      "O assistente parou de responder por esse número. As conversas antigas continuam no painel.",
      "",
      `Para voltar, conecte o WhatsApp de novo: ${appUrl(`/painel/bots/${r.bot_id}?tab=whatsapp`)}`,
    ]).catch(() => false);
  }
  return rows?.length ?? 0;
}
