"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/platform-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { text } from "@/lib/validation";
import { extendedTrialEnd } from "@/lib/backoffice";
import { fail, ok, type ActionResult } from "@/lib/action-result";

/*
 * Ações do backoffice que mudam o funcionamento: pausar a IA (de uma agência ou de todas, a
 * chave geral) e estender o teste. Cada uma fica no registro de acesso, com o que foi feito.
 */

/** Dias que dá para estender o teste de uma vez. */
const TRIAL_DAYS = new Set([3, 7, 14, 30]);

function reasonOf(fd: FormData): string | { error: string } {
  const reason = text(fd.get("reason"));
  if (reason.length < 3) return { error: "Escreva o motivo (fica registrado)." };
  return reason.slice(0, 200);
}

export async function pauseAllAi(fd: FormData): Promise<ActionResult> {
  const reason = reasonOf(fd);
  if (typeof reason !== "string") return fail(reason.error);
  if (fd.get("confirm") !== "on") return fail("Marque a confirmação: todos os bots param de responder com IA.");
  const s = await requireAdmin(`/admin (CHAVE GERAL: pausou a IA de todos: ${reason})`);
  const { error } = await createAdminClient().from("platform_flags").update({ ai_paused_at: new Date().toISOString(), ai_paused_reason: reason, updated_by: s.email, updated_at: new Date().toISOString() }).eq("id", 1);
  if (error) return fail("Não foi possível pausar. Tente de novo.");
  revalidatePath("/admin", "layout");
  return ok("IA de todos pausada.");
}

export async function resumeAllAi(): Promise<ActionResult> {
  const s = await requireAdmin("/admin (CHAVE GERAL: religou a IA de todos)");
  const { error } = await createAdminClient().from("platform_flags").update({ ai_paused_at: null, ai_paused_reason: null, updated_by: s.email, updated_at: new Date().toISOString() }).eq("id", 1);
  if (error) return fail("Não foi possível religar. Tente de novo.");
  revalidatePath("/admin", "layout");
  return ok("IA de todos religada.");
}

export async function pauseAgencyAi(agencyId: string, fd: FormData): Promise<ActionResult> {
  const reason = reasonOf(fd);
  if (typeof reason !== "string") return fail(reason.error);
  await requireAdmin(`/admin/clientes/${agencyId} (pausou a IA: ${reason})`);
  const { error } = await createAdminClient().from("agencies").update({ ai_paused_at: new Date().toISOString(), ai_paused_reason: reason }).eq("id", agencyId);
  if (error) return fail("Não foi possível pausar. Tente de novo.");
  revalidatePath("/admin", "layout");
  return ok("IA da agência pausada.");
}

export async function resumeAgencyAi(agencyId: string): Promise<ActionResult> {
  await requireAdmin(`/admin/clientes/${agencyId} (religou a IA)`);
  const { error } = await createAdminClient().from("agencies").update({ ai_paused_at: null, ai_paused_reason: null }).eq("id", agencyId);
  if (error) return fail("Não foi possível religar. Tente de novo.");
  revalidatePath("/admin", "layout");
  return ok("IA da agência religada.");
}

/** Estende o teste a partir de hoje ou do fim atual (o que vier depois); os avisos de fim voltam a valer. */
export async function extendTrial(agencyId: string, fd: FormData): Promise<ActionResult> {
  const days = Number(fd.get("days"));
  if (!TRIAL_DAYS.has(days)) return fail("Escolha quantos dias.");
  await requireAdmin(`/admin/clientes/${agencyId} (estendeu o teste em ${days} dias)`);
  const db = createAdminClient();
  const { data: agency } = await db.from("agencies").select("plan, trial_ends_at").eq("id", agencyId).maybeSingle();
  if (!agency) return fail("Agência não encontrada.");
  if (agency.plan !== "trial") return fail("Só dá para estender o teste de quem ainda está no plano de teste.");
  const until = extendedTrialEnd(agency.trial_ends_at as string, days);
  const { error } = await db.from("agencies").update({ trial_ends_at: until, trial_reminder_sent_at: null, trial_expired_notified_at: null }).eq("id", agencyId);
  if (error) return fail("Não foi possível estender. Tente de novo.");
  revalidatePath("/admin", "layout");
  return ok(`Teste estendido até ${new Date(until).toLocaleDateString("pt-BR")}.`);
}

/* ------------------------------------------------------------------ envio (regra de estado, degraus 1 e 2) */

/**
 * Desligamento geral do WhatsApp (plano B se a Meta mandar parar a plataforma): nada entra nem
 * sai pela Cloud API, nem a resposta da equipe pelo painel. Instagram e site seguem normais.
 */
export async function disableWhatsAppAll(fd: FormData): Promise<ActionResult> {
  const reason = reasonOf(fd);
  if (typeof reason !== "string") return fail(reason.error);
  if (fd.get("confirm") !== "on") return fail("Marque a confirmação: nenhum WhatsApp recebe nem envia até religar.");
  const s = await requireAdmin(`/admin (DESLIGOU O WHATSAPP DE TODOS: ${reason})`);
  const { error } = await createAdminClient().from("platform_flags").update({ whatsapp_disabled_at: new Date().toISOString(), whatsapp_disabled_reason: reason, updated_by: s.email, updated_at: new Date().toISOString() }).eq("id", 1);
  if (error) return fail("Não foi possível desligar. Tente de novo.");
  revalidatePath("/admin", "layout");
  return ok("WhatsApp de todos desligado.");
}

export async function enableWhatsAppAll(): Promise<ActionResult> {
  const s = await requireAdmin("/admin (religou o WhatsApp de todos)");
  const { error } = await createAdminClient().from("platform_flags").update({ whatsapp_disabled_at: null, whatsapp_disabled_reason: null, updated_by: s.email, updated_at: new Date().toISOString() }).eq("id", 1);
  if (error) return fail("Não foi possível religar. Tente de novo.");
  revalidatePath("/admin", "layout");
  return ok("WhatsApp de todos religado.");
}

const SUSPEND_CHANNELS = new Set(["all", "whatsapp", "instagram", "widget"]);

/**
 * Suspende um canal de uma agência (ou de um chatbot dela) pela BoaVoz: nada sai, nem resposta
 * da equipe; o contato recebe uma vez o aviso de canal indisponível (fora da coexistência).
 */
export async function suspendChannel(agencyId: string, fd: FormData): Promise<ActionResult> {
  const reason = reasonOf(fd);
  if (typeof reason !== "string") return fail(reason.error);
  const channel = text(fd.get("channel")) || "all";
  if (!SUSPEND_CHANNELS.has(channel)) return fail("Escolha o canal.");
  const botId = text(fd.get("bot_id")) || null;
  const s = await requireAdmin(`/admin/clientes/${agencyId} (suspendeu ${channel}${botId ? ` do bot ${botId}` : ""}: ${reason})`);
  const db = createAdminClient();
  if (botId) {
    const { data: bot } = await db.from("bots").select("id").eq("id", botId).eq("agency_id", agencyId).maybeSingle();
    if (!bot) return fail("Chatbot não encontrado nesta agência.");
  }
  const { error } = await db.from("enforcement_actions").insert({ source: "boavoz", feature: "channel", channel, agency_id: agencyId, bot_id: botId, reason, created_by: s.email });
  if (error) return fail("Não foi possível suspender. Tente de novo.");
  revalidatePath("/admin", "layout");
  return ok("Canal suspenso.");
}

/** Levanta uma medida (da BoaVoz ou registrada da Meta): o canal volta a funcionar se nada mais o bloqueia. */
export async function liftMeasure(id: number): Promise<ActionResult> {
  const s = await requireAdmin(`/admin (levantou a medida ${id})`);
  const { error } = await createAdminClient().from("enforcement_actions").update({ lifted_at: new Date().toISOString(), lifted_by: s.email }).eq("id", id).is("lifted_at", null);
  if (error) return fail("Não foi possível levantar. Tente de novo.");
  revalidatePath("/admin", "layout");
  return ok("Medida levantada.");
}

/* ------------------------------------------------------------------ revisão do negócio (tela de aceite) */

/** Aprova o negócio: vira ativo (o WhatsApp pode conectar) e levanta as suspensões criadas pelo bloqueio. */
export async function approveBusiness(clientId: string): Promise<ActionResult> {
  const s = await requireAdmin(`/admin/conformidade (aprovou o negócio ${clientId})`);
  const db = createAdminClient();
  const now = new Date().toISOString();
  const { error } = await db.from("business_compliance").update({ status: "ativo", reviewed_at: now, reviewed_by: s.email, review_note: null }).eq("client_id", clientId);
  if (error) return fail("Não foi possível aprovar. Tente de novo.");
  await db.from("enforcement_actions").update({ lifted_at: now, lifted_by: s.email }).eq("source", "boavoz").eq("detail->>client_id", clientId).is("lifted_at", null);
  revalidatePath("/admin", "layout");
  return ok("Negócio aprovado.");
}

/**
 * Bloqueia o negócio na revisão: não conecta WhatsApp nem Instagram e os canais já ligados dos
 * chatbots dele ficam suspensos (medida da BoaVoz, levantada se ele for aprovado depois).
 */
export async function blockBusiness(clientId: string, fd: FormData): Promise<ActionResult> {
  const reason = reasonOf(fd);
  if (typeof reason !== "string") return fail(reason.error);
  const s = await requireAdmin(`/admin/conformidade (bloqueou o negócio ${clientId}: ${reason})`);
  const db = createAdminClient();
  const { data: row } = await db.from("business_compliance").select("agency_id").eq("client_id", clientId).maybeSingle();
  if (!row) return fail("Negócio não encontrado.");
  const { error } = await db.from("business_compliance").update({ status: "bloqueado", reviewed_at: new Date().toISOString(), reviewed_by: s.email, review_note: reason }).eq("client_id", clientId);
  if (error) return fail("Não foi possível bloquear. Tente de novo.");
  const { data: bots } = await db.from("bots").select("id").eq("client_id", clientId).eq("is_demo", false);
  const measures = (bots ?? []).flatMap((b) =>
    (["whatsapp", "instagram"] as const).map((channel) => ({ source: "boavoz", feature: "channel", channel, agency_id: row.agency_id, bot_id: b.id, reason: `negócio bloqueado na revisão: ${reason}`, detail: { client_id: clientId }, created_by: s.email })),
  );
  if (measures.length) await db.from("enforcement_actions").insert(measures);
  revalidatePath("/admin", "layout");
  return ok("Negócio bloqueado.");
}
