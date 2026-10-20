import type { SupabaseClient } from "@supabase/supabase-js";
import { ingestSource, type SourceRow } from "./ingest";
import { daysAgoIso } from "./utils";
import { applyRetentionTerms } from "./retention";
import { purgeCampaignData } from "./campaigns";
import { deleteExpiredRefs } from "./button-refs";
import { sweepRoutineTimeouts } from "./routine-engine";
import { purgeOldComments } from "./instagram-comments";

/**
 * Tarefas diárias (rodam juntas em /api/cron/daily: o plano Hobby da Vercel só permite 2 crons).
 * Cada uma é idempotente: rodar duas vezes no mesmo dia não duplica e-mail nem apaga a mais.
 */

/**
 * LGPD: registros técnicos com prazo fixo e, depois, o prazo de cada chatbot (retention.ts: modo
 * dados sensíveis, cliente ou agência), que apaga conversas, leads, perguntas e contatos.
 */
export async function applyRetention(db: SupabaseClient, hasTime: () => boolean = () => true) {
  // ids de mensagens do WhatsApp já tratadas: só servem contra reentrega, que vem em minutos
  await db.from("whatsapp_inbound").delete().lt("created_at", daysAgoIso(7));
  // fila de entrada: 8 dias seguram os reenvios do WhatsApp (até 7 dias)
  await db.from("inbound_events").delete().lt("created_at", daysAgoIso(8));
  // registro de exclusões: 60 dias (passa do prazo dos backups); pedidos da Meta: 1 ano
  await db.from("deletion_log").delete().lt("created_at", daysAgoIso(60));
  await db.from("deletion_requests").delete().lt("created_at", daysAgoIso(365));
  // classificação do portão (sem conteúdo): 1 ano, como diz a Política de Privacidade
  await db.from("gate_detections").delete().lt("created_at", daysAgoIso(365));
  // lista de supressão: 5 anos, só com o hash do número, como prova (LGPD, art. 16, I)
  await db.from("suppressions").delete().lt("created_at", daysAgoIso(5 * 365 + 1));
  // consentimento de novidades (leva B3): a prova fica 5 anos depois da revogação ou da recusa;
  // o sim ativo fica enquanto valer
  await db.from("marketing_consents").delete().lt("revoked_at", daysAgoIso(5 * 365 + 1));
  await db.from("marketing_consents").delete().eq("granted", false).lt("collected_at", daysAgoIso(5 * 365 + 1));
  // campanhas (leva B3): variáveis dos envios saem em 30 dias; campanhas e envios, em 13 meses
  await purgeCampaignData(db);
  // consumo do WhatsApp: 13 meses bastam para comparar com o mesmo mês do ano anterior
  await db.from("whatsapp_usage").delete().lt("created_at", daysAgoIso(400));
  // pareamento: código vencido ou usado sai depois de 1 dia; Idempotency-Key, depois de 24 h
  await db.from("pairing_codes").delete().lt("created_at", daysAgoIso(1));
  await db.from("idempotency_keys").delete().lt("created_at", daysAgoIso(1));
  // entregas de webhook: 30 dias
  await db.from("webhook_deliveries").delete().lt("created_at", daysAgoIso(30));
  // registro das chamadas de ações (Integrações): 30 dias
  await db.from("action_calls").delete().lt("created_at", daysAgoIso(30));
  // stories e posts da loja lidos na hora no direct (E1): 30 dias; comentários do Instagram: 90 dias
  await db.from("instagram_media_notes").delete().lt("created_at", daysAgoIso(30));
  await purgeOldComments(db);
  // roteiros (B2'): o que está sem mensagem do contato há 24 horas acaba (as variáveis saem); os
  // encerrados, só com o passo e o motivo, ficam 13 meses para os números por roteiro
  await sweepRoutineTimeouts(db);
  await db.from("routine_runs").delete().lt("ended_at", daysAgoIso(400));
  // Confirmar / Cancelar das ações "executa": a referência vencida sai depois de 7 dias
  await deleteExpiredRefs(db, daysAgoIso(7));
  // análise do bot: o resumo escrito pela IA sai em 30 dias (os rótulos ficam 1 ano)
  await db.from("compliance_checks").update({ summary_enc: null }).lt("summary_expires_at", new Date().toISOString()).not("summary_enc", "is", null);
  await db.from("compliance_checks").delete().lt("created_at", daysAgoIso(365)).neq("review_state", "pending");
  return applyRetentionTerms(db, hasTime);
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
