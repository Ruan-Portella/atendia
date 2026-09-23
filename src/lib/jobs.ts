import type { SupabaseClient } from "@supabase/supabase-js";
import { ingestSource, type SourceRow } from "./ingest";
import { notifyAgencyOwner } from "./notify";
import { appUrl, daysAgoIso } from "./utils";

/**
 * Tarefas diárias (rodam juntas em /api/cron/daily: o plano Hobby da Vercel só permite 2 crons).
 * Cada uma é idempotente: rodar duas vezes no mesmo dia não duplica e-mail nem apaga a mais.
 */

/** "Seu teste acaba em 3 dias" e "seu teste acabou", uma vez cada por agência. */
export async function trialReminders(db: SupabaseClient) {
  const now = new Date();
  const in3days = new Date(now.getTime() + 3 * 86_400_000).toISOString();
  const billing = appUrl("/painel/cobranca");
  let sent = 0;

  const { data: ending } = await db.from("agencies").select("id, trial_ends_at").eq("plan", "trial").is("trial_reminder_sent_at", null).gt("trial_ends_at", now.toISOString()).lte("trial_ends_at", in3days).limit(200);
  for (const a of ending ?? []) {
    const days = Math.max(1, Math.ceil((new Date(a.trial_ends_at).getTime() - now.getTime()) / 86_400_000));
    await notifyAgencyOwner(db, a.id, `Seu teste grátis acaba em ${days} dia${days === 1 ? "" : "s"}`, [
      `Seu teste grátis termina em ${days} dia${days === 1 ? "" : "s"}.`,
      "",
      "Depois disso, o chat nos sites dos seus clientes passa a mostrar só um formulário de contato, e o assistente para de responder.",
      "",
      `Escolha um plano para não parar: ${billing}`,
    ]);
    await db.from("agencies").update({ trial_reminder_sent_at: now.toISOString() }).eq("id", a.id);
    sent++;
  }

  const { data: expired } = await db.from("agencies").select("id").eq("plan", "trial").is("trial_expired_notified_at", null).lte("trial_ends_at", now.toISOString()).not("owner_id", "is", null).limit(200);
  for (const a of expired ?? []) {
    await notifyAgencyOwner(db, a.id, "Seu teste grátis acabou", [
      "Seu teste grátis terminou.",
      "",
      "Os chats nos sites dos seus clientes estão mostrando um formulário de contato no lugar do assistente. Os contatos continuam chegando no painel.",
      "",
      `Assine um plano para o assistente voltar a responder na hora: ${billing}`,
    ]);
    await db.from("agencies").update({ trial_expired_notified_at: now.toISOString() }).eq("id", a.id);
    sent++;
  }
  return { sent };
}

/**
 * LGPD: agências com prazo de guarda (6, 12 ou 24 meses) têm conversas, contatos e perguntas
 * sem resposta mais antigos que isso apagados. Mensagens vão junto com a conversa.
 */
export async function applyRetention(db: SupabaseClient) {
  // ids de mensagens do WhatsApp já tratadas: só servem contra reentrega, que vem em minutos
  await db.from("whatsapp_inbound").delete().lt("created_at", daysAgoIso(7));
  const { data: agencies } = await db.from("agencies").select("id, retention_months").not("retention_months", "is", null);
  let conversations = 0;
  let leads = 0;
  for (const a of agencies ?? []) {
    const cutoff = daysAgoIso(Number(a.retention_months) * 30);
    const { data: bots } = await db.from("bots").select("id").eq("agency_id", a.id);
    const ids = (bots ?? []).map((b) => b.id);
    if (!ids.length) continue;
    const c = await db.from("leads").delete({ count: "exact" }).in("bot_id", ids).lt("created_at", cutoff);
    leads += c.count ?? 0;
    const d = await db.from("conversations").delete({ count: "exact" }).in("bot_id", ids).lt("last_message_at", cutoff);
    conversations += d.count ?? 0;
    await db.from("unanswered").delete().in("bot_id", ids).lt("created_at", cutoff);
  }
  return { conversations, leads };
}

/**
 * Relê sites e páginas de chatbots no ar que não são lidos há 7 dias. Sem mudança no texto,
 * só marca a data (sem custo de embedding); com erro, a fonte segue com o conteúdo anterior.
 * Mais antigas primeiro, enquanto houver tempo; o resto fica para o dia seguinte.
 */
export async function refreshSources(db: SupabaseClient, hasTime: () => boolean) {
  const { data: sources } = await db
    .from("sources")
    .select("id, bot_id, kind, title, url, content, content_hash, bots!inner(status, is_demo, auto_refresh)")
    .in("kind", ["site", "page"])
    .eq("status", "ready")
    .eq("bots.status", "live")
    .eq("bots.is_demo", false)
    .eq("bots.auto_refresh", true)
    .lt("last_refreshed_at", daysAgoIso(7))
    .order("last_refreshed_at", { ascending: true })
    .limit(30);
  const result = { refreshed: 0, unchanged: 0, failed: 0, left: 0 };
  for (const s of sources ?? []) {
    if (!hasTime()) {
      result.left++;
      continue;
    }
    try {
      const r = await ingestSource(db, s as unknown as SourceRow, undefined, { background: true, previousHash: s.content_hash as string | null });
      if (r.unchanged) result.unchanged++;
      else result.refreshed++;
    } catch {
      result.failed++;
    }
  }
  return result;
}
