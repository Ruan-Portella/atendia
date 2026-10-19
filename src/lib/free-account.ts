import type { SupabaseClient } from "@supabase/supabase-js";
import { DEMOS_PER_MONTH, DEMOS_PER_MONTH_FREE, DEMO_ANSWERS, DEMO_ANSWERS_SHOWCASE, DEMO_DAYS, TEST_ANSWERS_FREE } from "./plans";
import { disconnectInstagramChannel, disconnectWhatsAppChannel } from "./channel-disconnect";
import { notifyAgencyOwner } from "./notify";
import { audit } from "./audit";
import { appUrl } from "./utils";

/*
 * Conta grátis (revisão de preços, parte 5b; 17/10/2026, revista em 18/10).
 * - Sem assinatura, o teste ao vivo do painel e as demos usam até 50 respostas da IA (a vitrine
 *   do site fica de fora). Com assinatura, o teste ao vivo é livre. O Atendimento não tem IA, nem
 *   no teste.
 * - Cada demo vale 14 dias e responde até 50 vezes, com ou sem assinatura (a da vitrine do site,
 *   até 20): a demo é para mostrar, não para atender. A conta gera até 3 demos por mês na conta
 *   grátis e até 20 com assinatura (contadas na criação).
 * - WhatsApp, Instagram e o chat do site só ligam com tamanho (Atendimento, sem IA, ou um tamanho
 *   com IA): não há caixa de entrada grátis. O chatbot que perde o tamanho (no dia 1º ou no fim da
 *   assinatura) tem o WhatsApp e o Instagram desconectados na hora, sem apagar nada.
 */

export const TEST_ANSWERS_DONE = `Você usou as ${TEST_ANSWERS_FREE} respostas de teste da conta grátis. Para continuar testando, escolha um tamanho para um chatbot em Cobrança → Assinatura.`;

/** Teste ao vivo de um chatbot Atendimento: ele não tem IA. */
export const ATENDIMENTO_TEST_OFF = "Este chatbot é Atendimento, sem IA: o teste ao vivo não responde. Para testar a IA, escolha um tamanho com IA em Cobrança → Assinatura.";

/** Teste ao vivo de uma demo que terminou. */
export const DEMO_ENDED_PANEL = `Esta demo terminou: cada demo vale ${DEMO_DAYS} dias e responde até ${DEMO_ANSWERS} vezes. Gere outra em Demos ou transforme esta em chatbot.`;

/** O que a demo que terminou diz a quem conversa com ela. Função pura. */
export function demoEndedText(agencyName: string | null, showcase: boolean): string {
  if (showcase) return "Esta demonstração terminou. Para montar o assistente do seu negócio, crie sua conta grátis no BoaVoz.";
  return `Esta demonstração terminou. Para continuar, fale com ${agencyName ?? "quem enviou o link"}.`;
}

/** Resposta de teste: ok, a demo venceu ou chegou ao limite, ou a conta grátis usou as dela. */
export type TestAnswer = "ok" | "demo_vencida" | "demo_limite" | "conta";

/** Reserva uma resposta de teste da IA (teste ao vivo e demos). Falha nossa não trava o teste. */
export async function takeTestAnswer(db: SupabaseClient, botId: string): Promise<TestAnswer> {
  const { data, error } = await db.rpc("use_test_answer", { p_bot_id: botId, p_limit: TEST_ANSWERS_FREE, p_demo_limit: DEMO_ANSWERS, p_showcase_demo_limit: DEMO_ANSWERS_SHOWCASE });
  if (error) {
    console.error("conta grátis: resposta de teste não conferida", error.message);
    return "ok";
  }
  return data === "demo_vencida" || data === "demo_limite" || data === "conta" ? data : "ok";
}

/** Recusa de demo nova: o limite do mês (contado na criação). */
export function demosMonthText(subscribed: boolean): string {
  return subscribed
    ? `A conta já gerou as ${DEMOS_PER_MONTH} demos deste mês. O limite volta no dia 1º; enquanto isso, dá para transformar uma demo em chatbot.`
    : `A conta grátis gera até ${DEMOS_PER_MONTH_FREE} demos por mês. Com assinatura, são até ${DEMOS_PER_MONTH}.`;
}

/** Reserva a criação de uma demo neste mês (a vitrine do site fica de fora). false = chegou ao limite. Falha nossa não trava. */
export async function claimDemo(db: SupabaseClient, agencyId: string): Promise<boolean> {
  const { data, error } = await db.rpc("claim_demo", { p_agency_id: agencyId, p_free_limit: DEMOS_PER_MONTH_FREE, p_paid_limit: DEMOS_PER_MONTH });
  if (error) {
    console.error("demos: vaga do mês não conferida", error.message);
    return true;
  }
  return Boolean(data);
}

/** A demo não chegou a existir (site que não deu para ler): a vaga do mês volta. */
export async function releaseDemo(db: SupabaseClient, agencyId: string): Promise<void> {
  const { error } = await db.rpc("release_demo", { p_agency_id: agencyId });
  if (error) console.error("demos: vaga do mês não devolvida", error.message);
}

export const SIZE_REQUIRED = "Para conectar o WhatsApp e o Instagram, este chatbot precisa de um tamanho. Escolha em Cobrança → Assinatura: Atendimento (sem IA) ou um tamanho com IA.";

/** Pela API: chatbot sem tamanho não envia campanha, lembrete nem modelo (422 bot_without_size). */
export const UNSIZED_API_SENDS = "O chatbot está sem tamanho: campanhas, lembretes e modelos só saem de chatbot com tamanho. Escolha um em Cobrança → Assinatura (Atendimento, sem IA, ou com IA).";

/** Chatbot sem tamanho e sem cota sob medida (não encontrado: false). */
export async function isUnsized(db: SupabaseClient, botId: string): Promise<boolean> {
  const { data: bot } = await db.from("bots").select("size, quota_override").eq("id", botId).maybeSingle();
  return Boolean(bot && !bot.size && bot.quota_override === null);
}

/** Conectar WhatsApp ou Instagram: só com tamanho (ou cota sob medida). null = pode. */
export async function sizeRequiredBlock(db: SupabaseClient, botId: string): Promise<string | null> {
  return (await isUnsized(db, botId)) ? SIZE_REQUIRED : null;
}

export interface ConnectedUnsized {
  botId: string;
  name: string;
  agencyId: string;
}

type ChannelRow = { bot_id: string; bots: BotJoin | BotJoin[] | null };
type BotJoin = { id: string; agency_id: string; name: string };

/** Chatbots sem tamanho (e sem cota sob medida) com WhatsApp ou Instagram conectado. */
export async function connectedUnsized(db: SupabaseClient, agencyId?: string): Promise<ConnectedUnsized[]> {
  const sel = "bot_id, bots!inner(id, agency_id, name, size, quota_override, is_demo)";
  const query = (table: "whatsapp_channels" | "instagram_channels") => {
    const q = db.from(table).select(sel).is("disconnected_at", null).is("bots.size", null).is("bots.quota_override", null).eq("bots.is_demo", false);
    return agencyId ? q.eq("bots.agency_id", agencyId) : q;
  };
  const [wa, ig] = await Promise.all([query("whatsapp_channels"), query("instagram_channels")]);
  if (wa.error || ig.error) throw new Error(`chatbots sem tamanho: ${(wa.error ?? ig.error)!.message}`);
  const byBot = new Map<string, ConnectedUnsized>();
  for (const r of [...((wa.data ?? []) as unknown as ChannelRow[]), ...((ig.data ?? []) as unknown as ChannelRow[])]) {
    const b = Array.isArray(r.bots) ? r.bots[0] : r.bots;
    if (b) byBot.set(r.bot_id, { botId: r.bot_id, name: b.name, agencyId: b.agency_id });
  }
  return [...byBot.values()];
}

/** E-mail do chatbot que ficou sem tamanho e teve os canais desconectados. Função pura. */
export function unsizedEmail(botName: string, billingUrl: string): [string, string[]] {
  return [
    `${botName}: WhatsApp e Instagram desconectados`,
    [
      `O chatbot ${botName} ficou sem tamanho, então o WhatsApp e o Instagram dele foram desconectados. Nada foi apagado: as conversas e a configuração continuam no painel.`,
      "",
      `Para voltar, escolha um tamanho (Atendimento, sem IA, ou um tamanho com IA) e conecte de novo: ${billingUrl}`,
    ],
  ];
}

/**
 * Chatbot sem tamanho não fica com canal: desconecta o WhatsApp e o Instagram (sem apagar nada) e
 * avisa o dono. Roda logo que o tamanho acaba (virada do mês e fim da assinatura, no webhook da
 * Stripe), na tarefa diária e no botão do backoffice. Falha num chatbot não para os outros.
 */
export async function disconnectUnsized(db: SupabaseClient, o: { agencyId?: string } = {}): Promise<{ disconnected: number; failed: number }> {
  const billingUrl = appUrl("/painel/cobranca");
  let disconnected = 0;
  let failed = 0;
  for (const b of await connectedUnsized(db, o.agencyId)) {
    try {
      await disconnectWhatsAppChannel(db, b.botId, "sem_tamanho");
      await disconnectInstagramChannel(db, b.botId, "sem_tamanho");
      await audit(db, { agencyId: b.agencyId, actorType: "system", actorId: null, action: "canal.desconectar_sem_tamanho", targetType: "bot", targetId: b.botId });
      const [subject, lines] = unsizedEmail(b.name, billingUrl);
      await notifyAgencyOwner(db, b.agencyId, subject, lines).catch(() => false);
      disconnected++;
    } catch (e) {
      failed++;
      console.error("chatbot sem tamanho: canal não desconectado", b.botId, (e as Error).message);
    }
  }
  return { disconnected, failed };
}
