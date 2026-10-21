import type { SupabaseClient } from "@supabase/supabase-js";
import { queueChannelEvent } from "./platform-events";
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
  const at = new Date().toISOString();
  const { data: rows } = await db
    .from("whatsapp_channels")
    .update({ payment_issue_at: at })
    .eq(where.column, where.value)
    .is("payment_issue_at", null)
    .select("bot_id, display_phone, phone_number_id, bots(name, client_name, agency_id)");
  // já marcado: a regra de estado tentou de novo depois de 1 hora e falhou, segura por mais 1 hora (sem novo aviso)
  if (!rows?.length) {
    await db
      .from("whatsapp_channels")
      .update({ payment_issue_at: new Date().toISOString() })
      .eq(where.column, where.value)
      .lt("payment_issue_at", new Date(Date.now() - 60 * 60_000).toISOString());
    return;
  }
  for (const r of rows) {
    const bot = (Array.isArray(r.bots) ? r.bots[0] : r.bots) as { name: string; client_name: string; agency_id: string } | null;
    console.warn("whatsapp: mensagens recusadas por pagamento", r.phone_number_id);
    if (!bot) continue;
    // webhooks: channel.issue (conectado, mas a Meta não entrega)
    await queueChannelEvent(db, r.bot_id, "issue", { type: "whatsapp", phoneNumberId: r.phone_number_id, display: r.display_phone ?? null }, { at, issue: { code: String(PAYMENT_ISSUE_CODE), message: "a conta do WhatsApp está sem forma de pagamento na Meta" } });
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
export async function markDisconnected(db: SupabaseClient, where: { column: "bot_id" | "phone_number_id" | "waba_id"; value: string }, reason: string, code = reason === TOKEN_REJECTED ? "token_rejected" : "access_lost", o: { keepToken?: boolean } = {}): Promise<number> {
  const at = new Date().toISOString();
  // na inatividade da coexistência, o acesso fica guardado (cifrado): o ACCOUNT_RECONNECTED volta o número
  const { data: rows } = await db
    .from("whatsapp_channels")
    .update({ disconnected_at: at, disconnect_reason: reason, ...(o.keepToken ? {} : { access_token_enc: null }) })
    .eq(where.column, where.value)
    .is("disconnected_at", null)
    .select("bot_id, display_phone, phone_number_id, bots(name, client_name, agency_id, client_id)");

  for (const r of rows ?? []) {
    const bot = (Array.isArray(r.bots) ? r.bots[0] : r.bots) as { name: string; client_name: string; agency_id: string; client_id?: string | null } | null;
    console.warn("whatsapp: número desconectado", r.phone_number_id, reason);
    if (!bot) continue;
    // webhooks: channel.disconnected com o motivo
    await queueChannelEvent(db, r.bot_id, "disconnected", { type: "whatsapp", phoneNumberId: r.phone_number_id, display: r.display_phone ?? null }, { at, reason: { code, message: reason } });
    await notifyAgencyOwner(db, bot.agency_id, `O WhatsApp de ${bot.client_name} foi desconectado`, [
      `O número ${r.display_phone ?? r.phone_number_id} do chatbot ${bot.name} (${bot.client_name}) foi desconectado: ${reason}.`,
      "",
      "O assistente parou de responder por esse número. As conversas antigas continuam no painel.",
      "",
      `Para voltar, conecte o WhatsApp de novo: ${appUrl(`/painel/bots/${r.bot_id}?tab=whatsapp`)}`,
    ]).catch(() => false);
    // aviso no WhatsApp de quem configura o chatbot, pelo assistente da BoaVoz
    const { botTitle, sendTeamNotice } = await import("./team-notices");
    await sendTeamNotice(db, { kind: "canal", agencyId: bot.agency_id, botId: r.bot_id, clientId: bot.client_id ?? null, vars: [botTitle(bot)], path: `painel/bots/${r.bot_id}?tab=whatsapp`, ref: r.bot_id });
  }
  return rows?.length ?? 0;
}

/**
 * ACCOUNT_RECONNECTED (spec, Peça 10): a conta voltou depois da inatividade da coexistência (o app
 * do celular ficou uns 14 dias sem ser aberto). O número volta ao normal sozinho: a inscrição do app
 * é refeita, sai channel.connected e o dono é avisado. Só para quem caiu por inatividade (o acesso
 * ficou guardado) e ainda tem tamanho; nas outras desconexões, o caminho é conectar de novo. Se a
 * Meta recusar o acesso guardado, ele sai e o dono é avisado para conectar de novo.
 */
export async function markReconnected(db: SupabaseClient, wabaId: string, deps: { subscribe?: (wabaId: string, token: string) => Promise<void> } = {}): Promise<number> {
  const { PRIMARY_INACTIVITY_TEXT } = await import("./platform-events");
  const { data: rows } = await db
    .from("whatsapp_channels")
    .select("bot_id, display_phone, phone_number_id, access_token_enc, bots(name, client_name, agency_id, size, quota_override)")
    .eq("waba_id", wabaId)
    .eq("disconnect_reason", PRIMARY_INACTIVITY_TEXT)
    .not("disconnected_at", "is", null)
    .not("access_token_enc", "is", null);
  const subscribe = deps.subscribe ?? (async (w: string, token: string) => (await import("./whatsapp")).subscribeApp(w, token));
  const { unseal } = await import("./secret-box");
  let back = 0;
  for (const r of rows ?? []) {
    const bot = (Array.isArray(r.bots) ? r.bots[0] : r.bots) as { name: string; client_name: string; agency_id: string; size: string | null; quota_override: number | null } | null;
    if (!bot) continue;
    // sem tamanho, sem canal: fica desconectado (a configuração continua guardada)
    if (!bot.size && bot.quota_override === null) continue;
    try {
      await subscribe(wabaId, unseal(r.access_token_enc as string));
    } catch (e) {
      console.warn("whatsapp: o acesso guardado não voltou", r.phone_number_id, (e as Error).message);
      await db.from("whatsapp_channels").update({ access_token_enc: null }).eq("bot_id", r.bot_id);
      await notifyAgencyOwner(db, bot.agency_id, `O WhatsApp de ${bot.client_name} precisa ser conectado de novo`, [
        `A Meta avisou que a conta do número ${r.display_phone ?? r.phone_number_id} voltou, mas não aceitou o acesso que o BoaVoz tinha.`,
        "",
        `Conecte o WhatsApp de novo: ${appUrl(`/painel/bots/${r.bot_id}?tab=whatsapp`)}`,
      ]).catch(() => false);
      continue;
    }
    const at = new Date().toISOString();
    await db.from("whatsapp_channels").update({ disconnected_at: null, disconnect_reason: null }).eq("bot_id", r.bot_id);
    await queueChannelEvent(db, r.bot_id as string, "connected", { type: "whatsapp", phoneNumberId: r.phone_number_id as string, display: (r.display_phone as string | null) ?? null }, { at });
    await notifyAgencyOwner(db, bot.agency_id, `O WhatsApp de ${bot.client_name} voltou`, [
      `O número ${r.display_phone ?? r.phone_number_id} do chatbot ${bot.name} (${bot.client_name}) voltou a funcionar: o app WhatsApp Business foi aberto no celular de novo.`,
      "",
      "O assistente voltou a responder por esse número. Para não cair de novo, abra o app do celular pelo menos uma vez a cada 14 dias.",
    ]).catch(() => false);
    back++;
  }
  return back;
}
