"use server";

import { revalidatePath } from "next/cache";
import { requireAgency } from "@/lib/agency";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit, requestMeta } from "@/lib/audit";
import { can } from "@/lib/team";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { hasPack } from "@/lib/entitlements";
import { markAnalysisDue } from "@/lib/bot-analysis";
import { ROUTINES_PER_BOT, routineInputFromJson, routineProblem, routineUsesActions } from "@/lib/routines";

/*
 * Roteiros (B2', parte 1): cadastro na aba Roteiros do chatbot. Quem configura o chatbot (dono,
 * administrador e editor) mexe; roteiro sem ação não precisa de desenvolvedor nem de pacote. Passo
 * com ação só com o pacote Integrações. Cada mudança vai para a auditoria e agenda de novo a análise
 * do bot (o roteiro também é instrução para a IA).
 */

const DENIED = "O seu papel na equipe não permite mexer nos roteiros. Fale com o dono ou com um administrador da agência.";

/** Chatbot no escopo de quem está logado (RLS). */
async function scopedBot(botId: string) {
  const { data } = await (await createClient()).from("bots").select("id, agency_id").eq("id", String(botId)).maybeSingle();
  return data as { id: string; agency_id: string } | null;
}

async function context() {
  const ctx = await requireAgency();
  if (!can(ctx.role, "config")) return null;
  return ctx;
}

async function auditRoutine(ctx: NonNullable<Awaited<ReturnType<typeof context>>>, action: string, botId: string, after: Record<string, unknown>) {
  await audit(createAdminClient(), { agencyId: ctx.agency.id, actorType: "user", actorId: ctx.userId, action, targetType: "bot", targetId: botId, after, ...(await requestMeta()) });
}

/** Roteiro de um chatbot do escopo de quem está logado. */
async function scopedRoutine(routineId: string) {
  const db = createAdminClient();
  const { data } = await db.from("routines").select("id, bot_id, name, steps, active").eq("id", String(routineId)).maybeSingle();
  if (!data || !(await scopedBot(data.bot_id as string))) return null;
  return data as { id: string; bot_id: string; name: string; steps: unknown[]; active: boolean };
}

/** Cria ou edita um roteiro (o editor manda o roteiro inteiro em JSON, no campo "routine"). */
export async function saveRoutine(botId: string, routineId: string | null, fd: FormData): Promise<ActionResult> {
  const ctx = await context();
  if (!ctx) return fail(DENIED);
  const bot = await scopedBot(botId);
  if (!bot) return fail("Chatbot não encontrado.");
  const input = routineInputFromJson(String(fd.get("routine") ?? ""));
  if ("error" in input) return fail(input.error);

  const db = createAdminClient();
  const [{ data: actions }, { data: others }, integrations] = await Promise.all([
    db.from("actions").select("name, outcomes").eq("bot_id", bot.id),
    db.from("routines").select("id, name, keywords").eq("bot_id", bot.id),
    hasPack(db, bot.agency_id, "integracoes"),
  ]);
  const all = (others ?? []) as Array<{ id: string; name: string; keywords: string[] }>;
  if (routineId && !all.some((o) => o.id === routineId)) return fail("Roteiro não encontrado.");
  const rest = all.filter((o) => o.id !== routineId);
  if (!routineId && rest.length >= ROUTINES_PER_BOT) return fail(`Até ${ROUTINES_PER_BOT} roteiros por chatbot.`);
  const problem = routineProblem(input, { actions: (actions ?? []) as Array<{ name: string; outcomes: string[] }>, others: rest, integrations });
  if (problem) return fail(problem);

  const row = { bot_id: bot.id, name: input.name, when_to_use: input.when_to_use, keywords: input.keywords, steps: input.steps, active: input.active, template: input.template, updated_at: new Date().toISOString() };
  const { error } = routineId ? await db.from("routines").update(row).eq("id", routineId).eq("bot_id", bot.id) : await db.from("routines").insert(row);
  if (error) return fail(/duplicate|unique/i.test(error.message) ? "Já existe um roteiro com esse nome neste chatbot." : "Não foi possível salvar. Tente de novo.");
  await auditRoutine(ctx, routineId ? "roteiros.editar" : "roteiros.criar", bot.id, { nome: input.name, passos: input.steps.length, palavras_chave: input.keywords, ativo: input.active, com_acao: routineUsesActions(input), modelo: input.template });
  await markAnalysisDue(db, bot.id);
  revalidatePath(`/painel/bots/${bot.id}`);
  return ok(routineId ? "Roteiro salvo." : "Roteiro criado.");
}

/** Liga ou desliga um roteiro sem mexer nos passos (desligado, a IA não recebe o roteiro). */
export async function setRoutineActive(routineId: string, active: boolean): Promise<ActionResult> {
  const ctx = await context();
  if (!ctx) return fail(DENIED);
  const routine = await scopedRoutine(routineId);
  if (!routine) return fail("Roteiro não encontrado.");
  const db = createAdminClient();
  const { error } = await db.from("routines").update({ active, updated_at: new Date().toISOString() }).eq("id", routine.id);
  if (error) return fail("Não foi possível salvar. Tente de novo.");
  await auditRoutine(ctx, active ? "roteiros.ativar" : "roteiros.desativar", routine.bot_id, { nome: routine.name });
  if (active) await markAnalysisDue(db, routine.bot_id);
  revalidatePath(`/painel/bots/${routine.bot_id}`);
  return ok(active ? "Roteiro ligado." : "Roteiro desligado: a IA não usa mais este roteiro.");
}

export async function deleteRoutine(routineId: string): Promise<ActionResult> {
  const ctx = await context();
  if (!ctx) return fail(DENIED);
  const routine = await scopedRoutine(routineId);
  if (!routine) return fail("Roteiro não encontrado.");
  const db = createAdminClient();
  const { error } = await db.from("routines").delete().eq("id", routine.id);
  if (error) return fail("Não foi possível apagar. Tente de novo.");
  await auditRoutine(ctx, "roteiros.apagar", routine.bot_id, { nome: routine.name });
  await markAnalysisDue(db, routine.bot_id);
  revalidatePath(`/painel/bots/${routine.bot_id}`);
  return ok("Roteiro apagado.");
}
