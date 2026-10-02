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
