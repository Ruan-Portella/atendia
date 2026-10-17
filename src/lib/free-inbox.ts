import type { SupabaseClient } from "@supabase/supabase-js";
import { TEST_ANSWERS_FREE, UNSIZED_GRACE_DAYS } from "./plans";
import { disconnectInstagramChannel, disconnectWhatsAppChannel } from "./channel-disconnect";
import { notifyAgencyOwner } from "./notify";
import { audit } from "./audit";
import { appUrl } from "./utils";

/*
 * Conta grátis (revisão de preços, parte 5b; 17/10/2026).
 * - Sem assinatura, o teste ao vivo do painel e as demos usam até 50 respostas da IA (a vitrine
 *   do site fica de fora). Com assinatura, são livres.
 * - Cada conta tem uma caixa de entrada grátis: um chatbot sem tamanho com WhatsApp e Instagram,
 *   sem IA, que envia até 100 mensagens de campanha e lembrete por mês (o teto fica em
 *   campaigns.ts). Para mais caixas de entrada sem IA, o tamanho Atendimento.
 * - Os outros chatbots sem tamanho com canal (perderam o tamanho no dia 1º) seguem recebendo para
 *   a equipe por 30 dias e depois são desconectados (tarefa diária), sem apagar nada.
 */

export const TEST_ANSWERS_DONE = `Você usou as ${TEST_ANSWERS_FREE} respostas de teste da conta grátis. Para continuar testando, escolha um tamanho para um chatbot em Cobrança → Assinatura.`;

/** Reserva uma resposta de teste da IA (conta sem assinatura). false = acabaram. Falha nossa não trava o teste. */
export async function takeTestAnswer(db: SupabaseClient, agencyId: string): Promise<boolean> {
  const { data, error } = await db.rpc("use_test_answer", { p_agency_id: agencyId, p_limit: TEST_ANSWERS_FREE });
  if (error) {
    console.error("conta grátis: resposta de teste não conferida", error.message);
    return true;
  }
  return Boolean(data);
}

export interface ConnectedUnsized {
  botId: string;
  name: string;
  agencyId: string;
  /** Quando o primeiro canal dele foi conectado. */
  connectedAt: string;
  graceUntil: string | null;
}

/**
 * A caixa de entrada grátis da conta é o chatbot sem tamanho conectado há mais tempo; os outros
 * entram no prazo. Função pura (por conta).
 */
export function pickFreeInbox(list: ConnectedUnsized[]): { holder: ConnectedUnsized | null; others: ConnectedUnsized[] } {
  const sorted = [...list].sort((a, b) => a.connectedAt.localeCompare(b.connectedAt) || a.botId.localeCompare(b.botId));
  return { holder: sorted[0] ?? null, others: sorted.slice(1) };
}

type ChannelRow = { bot_id: string; created_at: string; bots: BotJoin | BotJoin[] | null };
type BotJoin = { id: string; agency_id: string; name: string; grace_until: string | null };

/** Chatbots sem tamanho (e sem cota sob medida) com WhatsApp ou Instagram conectado. */
export async function connectedUnsized(db: SupabaseClient, agencyId?: string): Promise<ConnectedUnsized[]> {
  const sel = "bot_id, created_at, bots!inner(id, agency_id, name, size, quota_override, is_demo, grace_until)";
  const query = (table: "whatsapp_channels" | "instagram_channels") => {
    const q = db.from(table).select(sel).is("disconnected_at", null).is("bots.size", null).is("bots.quota_override", null).eq("bots.is_demo", false);
    return agencyId ? q.eq("bots.agency_id", agencyId) : q;
  };
  const [wa, ig] = await Promise.all([query("whatsapp_channels"), query("instagram_channels")]);
  if (wa.error || ig.error) throw new Error(`caixa de entrada grátis: ${(wa.error ?? ig.error)!.message}`);
  const byBot = new Map<string, ConnectedUnsized>();
  for (const r of [...((wa.data ?? []) as unknown as ChannelRow[]), ...((ig.data ?? []) as unknown as ChannelRow[])]) {
    const b = Array.isArray(r.bots) ? r.bots[0] : r.bots;
    if (!b) continue;
    const cur = byBot.get(r.bot_id);
    if (!cur || r.created_at < cur.connectedAt) byBot.set(r.bot_id, { botId: r.bot_id, name: b.name, agencyId: b.agency_id, connectedAt: r.created_at, graceUntil: b.grace_until ?? null });
  }
  return [...byBot.values()];
}

/**
 * Conectar WhatsApp ou Instagram neste chatbot: com tamanho (ou cota sob medida), sempre pode; sem
 * tamanho, só se a caixa de entrada grátis da conta estiver livre (ou já for ele). null = pode.
 */
export async function inboxSlotBlock(db: SupabaseClient, agencyId: string, botId: string): Promise<string | null> {
  const { data: bot } = await db.from("bots").select("size, quota_override").eq("id", botId).maybeSingle();
  if (!bot || bot.size || bot.quota_override !== null) return null;
  const other = (await connectedUnsized(db, agencyId)).find((b) => b.botId !== botId);
  if (!other) return null;
  return `A caixa de entrada grátis da conta já está no chatbot ${other.name}. Para conectar este, escolha um tamanho em Cobrança → Assinatura: Atendimento (sem IA) ou um tamanho com IA.`;
}

const dayBR = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

/** E-mails do prazo do chatbot sem tamanho. Função pura. */
export function graceEmail(kind: "inicio" | "desconectado", botName: string, until: Date | null, billingUrl: string): [string, string[]] {
  if (kind === "inicio") {
    return [
      `${botName}: sem tamanho, os canais desconectam em ${dayBR(until!)}`,
      [
        `O chatbot ${botName} está sem tamanho e a caixa de entrada grátis da conta já é de outro chatbot. Até ${dayBR(until!)}, as mensagens do WhatsApp e do Instagram dele continuam chegando em Conversas para a sua equipe, sem IA.`,
        "",
        `Depois disso, o WhatsApp e o Instagram dele são desconectados (nada é apagado: as conversas ficam no painel). Para manter, escolha um tamanho: Atendimento (sem IA) ou um tamanho com IA: ${billingUrl}`,
      ],
    ];
  }
  return [
    `${botName}: WhatsApp e Instagram desconectados`,
    [
      `O chatbot ${botName} ficou ${UNSIZED_GRACE_DAYS} dias sem tamanho, então o WhatsApp e o Instagram dele foram desconectados. As conversas continuam no painel.`,
      "",
      `Para voltar, escolha um tamanho e conecte de novo: ${billingUrl}`,
    ],
  ];
}

/**
 * Tarefa diária (e o botão do backoffice): em cada conta, a caixa grátis fica; os outros chatbots
 * sem tamanho com canal ganham o prazo de 30 dias (com aviso) e, vencido, são desconectados.
 */
export async function retireUnsizedChannels(db: SupabaseClient, o: { agencyId?: string; now?: Date } = {}): Promise<{ warned: number; disconnected: number }> {
  const now = o.now ?? new Date();
  const billingUrl = appUrl("/painel/cobranca");
  const byAgency = new Map<string, ConnectedUnsized[]>();
  for (const b of await connectedUnsized(db, o.agencyId)) byAgency.set(b.agencyId, [...(byAgency.get(b.agencyId) ?? []), b]);
  let warned = 0;
  let disconnected = 0;
  for (const [agencyId, list] of byAgency) {
    const { holder, others } = pickFreeInbox(list);
    // a caixa grátis não tem prazo (a outra que estava na frente saiu)
    if (holder?.graceUntil) await db.from("bots").update({ grace_until: null }).eq("id", holder.botId);
    for (const b of others) {
      if (!b.graceUntil) {
        const until = new Date(now.getTime() + UNSIZED_GRACE_DAYS * 86_400_000);
        const { data } = await db.from("bots").update({ grace_until: until.toISOString() }).eq("id", b.botId).is("grace_until", null).select("id");
        if (!data?.length) continue;
        const [subject, lines] = graceEmail("inicio", b.name, until, billingUrl);
        await notifyAgencyOwner(db, agencyId, subject, lines).catch(() => false);
        warned++;
      } else if (Date.parse(b.graceUntil) <= now.getTime()) {
        await disconnectWhatsAppChannel(db, b.botId, "sem_tamanho");
        await disconnectInstagramChannel(db, b.botId, "sem_tamanho");
        await db.from("bots").update({ grace_until: null }).eq("id", b.botId);
        await audit(db, { agencyId, actorType: "system", actorId: null, action: "canal.desconectar_sem_tamanho", targetType: "bot", targetId: b.botId, after: { dias: UNSIZED_GRACE_DAYS } });
        const [subject, lines] = graceEmail("desconectado", b.name, null, billingUrl);
        await notifyAgencyOwner(db, agencyId, subject, lines).catch(() => false);
        disconnected++;
      }
    }
  }
  return { warned, disconnected };
}
