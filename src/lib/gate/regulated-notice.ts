import type { SupabaseClient } from "@supabase/supabase-js";
import { CATEGORIES, type GateCategory } from "./rules";
import { notifyAgencyOwner } from "../notify";
import { appUrl } from "../utils";

/*
 * O primeiro item 18+ num chatbot sem canal para esses pedidos (itens menores da conferência de
 * 20/10, parte 3). No WhatsApp e no Instagram, a compra de bebida e de remédio nunca fecha no chat:
 * o assistente manda para o site, o app ou o telefone do chatbot. Sem nenhum deles, ele só diz que
 * não vende por ali; o dono fica sabendo uma vez, com o caminho para configurar.
 */

/** O e-mail ao dono. Pura. */
export function regulatedNoticeEmail(bot: { name: string; client_name?: string | null }, categories: GateCategory[], url: string): [string, string[]] {
  const who = bot.client_name ? `${bot.name} (${bot.client_name})` : bot.name;
  const items = [...new Set(categories.map((c) => CATEGORIES[c]?.label ?? c))].join(" e ");
  return [
    `O chatbot ${who} recebeu um pedido de ${items} e não tem onde fechar esses pedidos`,
    [
      `Um contato pediu ${items} ao chatbot ${who}. No WhatsApp e no Instagram, a compra desses itens nunca fecha no chat: o assistente manda a pessoa para o site, o app de delivery ou o telefone do negócio.`,
      "",
      "Este chatbot ainda não tem nenhum desses: por enquanto, o assistente só diz que não consegue vender o item por ali.",
      "",
      `Configure em Atendimento humano → Bebida alcoólica e remédio: ${url}`,
    ],
  ];
}

/** Avisa o dono uma vez por chatbot (a marca fica no chatbot). */
export async function noticeRegulatedWithoutChannel(db: SupabaseClient, bot: { id: string; agency_id: string; name: string; client_name?: string | null }, categories: GateCategory[], now = new Date()): Promise<boolean> {
  const { data } = await db.from("bots").update({ regulated_notice_at: now.toISOString() }).eq("id", bot.id).is("regulated_notice_at", null).select("id");
  if (!data?.length) return false;
  const [subject, lines] = regulatedNoticeEmail(bot, categories, appUrl(`/painel/bots/${bot.id}?tab=atendimento`));
  await notifyAgencyOwner(db, bot.agency_id, subject, lines).catch(() => false);
  return true;
}
