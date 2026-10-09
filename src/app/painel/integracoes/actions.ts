"use server";

import { revalidatePath } from "next/cache";
import { requireAgency } from "@/lib/agency";
import { hasMfa } from "@/lib/agency-mfa";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit, requestMeta } from "@/lib/audit";
import { can } from "@/lib/team";
import { text } from "@/lib/validation";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { planLimits } from "@/lib/plan-limits";
import { actionInputProblem, callAction, classifyCreatesOrder, rotateActionSecret, type ActionRow } from "@/lib/actions";
import { apiKeyProblem, createApiKey, isApiPermission, revokeApiKey, type ApiPermission } from "@/lib/api-keys";
import { createWebhook, sendWebhookTest } from "@/lib/webhooks";
import { actionInputFromForm, scopeFromForm, webhookInputFromForm } from "@/lib/integrations-input";
import { TRIAL_KEY_PERMISSIONS } from "@/lib/integrations-plan";

/*
 * Integrações no painel da agência (C pública, parte 1a): dono e administrador, com o segundo
 * fator, nos planos com Integrações (Agência, Escala e o teste grátis). As ações ficam na aba Ações
 * de cada chatbot; webhooks e chaves, na área Integrações da conta. Cada mudança vai para a
 * auditoria; chave, segredo, URL nova e webhook novo viram alerta de segurança ao dono.
 */

const DENIED = "Só o dono ou um administrador da agência mexe nas Integrações.";
const NOT_IN_PLAN = "Integrações fazem parte dos planos Agência e Escala.";
const NEED_MFA = "Confirme o segundo fator (app autenticador) para mexer nas Integrações: recarregue a página.";

async function integrationsContext() {
  const ctx = await requireAgency();
  if (!can(ctx.role, "integrations")) return { error: DENIED };
  if (!planLimits(ctx.plan.id).integrations) return { error: NOT_IN_PLAN };
  if (!(await hasMfa())) return { error: NEED_MFA };
  return { ctx, db: createAdminClient() };
}

type Ctx = Exclude<Awaited<ReturnType<typeof integrationsContext>>, { error: string }>["ctx"];

async function auditIntegration(ctx: Ctx, action: string, target: { type: string; id: string }, after: Record<string, unknown> = {}) {
  await audit(createAdminClient(), { agencyId: ctx.agency.id, actorType: "user", actorId: ctx.userId, action, targetType: target.type, targetId: target.id, after, ...(await requestMeta()) });
}

/** Chatbot da agência no escopo de quem está logado (RLS). */
async function scopedBot(botId: string) {
  const { data } = await (await createClient()).from("bots").select("id, agency_id, name").eq("id", String(botId)).eq("is_demo", false).maybeSingle();
  return data;
}

const done = (botId?: string) => {
  revalidatePath("/painel/integracoes");
  if (botId) revalidatePath(`/painel/bots/${botId}`);
};

/* ------------------------------------------------------------------ ações */

/** Gera ou troca o segredo de ações do chatbot: aparece uma vez só; o anterior vale mais 24 h (ou para na hora). */
export async function rotateBotActionSecret(botId: string, fd: FormData): Promise<ActionResult> {
  const c = await integrationsContext();
  if ("error" in c) return fail(c.error!);
  const bot = await scopedBot(botId);
  if (!bot) return fail("Chatbot não encontrado.");
  const invalidate = fd.get("invalidate") === "on";
  const secret = await rotateActionSecret(c.db, bot.id as string, { invalidatePrevious: invalidate });
  await auditIntegration(c.ctx, "acoes.segredo", { type: "bot", id: bot.id as string }, { invalidou_anterior: invalidate });
  done(bot.id as string);
  return ok(`${secret}\n\nCopie agora: ele não aparece de novo. ${invalidate ? "O anterior deixou de valer." : "O anterior (se havia) vale por mais 24 horas."}`);
}

/** Cria ou edita uma ação de consulta. Ação que parece criar pedido, reserva ou cobrança fica salva e desativada. */
export async function saveBotAction(botId: string, actionId: string | null, fd: FormData): Promise<ActionResult> {
  const c = await integrationsContext();
  if ("error" in c) return fail(c.error!);
  const bot = await scopedBot(botId);
  if (!bot) return fail("Chatbot não encontrado.");
  const input = actionInputFromForm(fd);
  if ("error" in input) return fail(input.error);
  const problem = actionInputProblem(input);
  if (problem) return fail(problem);
  // efeito classificado pela IA do BoaVoz: pedido, reserva ou cobrança só com confirmação por botão
  const createsOrder = await classifyCreatesOrder(c.db, c.ctx.agency.id, input);
  const row = { bot_id: bot.id, ...input, type: "query", active: input.active && !createsOrder, creates_order: createsOrder, updated_at: new Date().toISOString() };
  const { data, error } = actionId ? await c.db.from("actions").update(row).eq("id", String(actionId)).eq("bot_id", bot.id as string).select("id") : await c.db.from("actions").insert(row).select("id");
  if (error) return fail(/duplicate|unique/i.test(error.message) ? "Já existe uma ação com esse nome neste chatbot." : "Não foi possível salvar. Tente de novo.");
  if (!data?.length) return fail("Ação não encontrada.");
  await auditIntegration(c.ctx, actionId ? "acoes.editar" : "acoes.criar", { type: "bot", id: bot.id as string }, { name: input.name, url: input.url, creates_order: createsOrder });
  done(bot.id as string);
  return createsOrder
    ? ok("Ação salva e DESATIVADA: ela parece criar pedido, reserva ou cobrança, e isso precisa da confirmação por botão do contato (chega numa próxima parte das Integrações).")
    : ok(`Ação ${input.name} salva${input.active ? " e ativa" : " (desativada)"}.`);
}

/** Ação de um chatbot do escopo de quem está logado. */
async function scopedAction(db: ReturnType<typeof createAdminClient>, actionId: string) {
  const { data } = await db.from("actions").select("*").eq("id", String(actionId)).maybeSingle();
  if (!data || !(await scopedBot(data.bot_id as string))) return null;
  return data as unknown as ActionRow & { bot_id: string; name: string };
}

export async function deleteBotAction(actionId: string): Promise<ActionResult> {
  const c = await integrationsContext();
  if ("error" in c) return fail(c.error!);
  const action = await scopedAction(c.db, actionId);
  if (!action) return fail("Ação não encontrada.");
  await c.db.from("actions").delete().eq("id", action.id);
  await auditIntegration(c.ctx, "acoes.apagar", { type: "bot", id: action.bot_id }, { name: action.name });
  done(action.bot_id);
  return ok("Ação apagada.");
}

/** Testar: chama o endpoint de verdade com test: true e os parâmetros de exemplo. */
export async function testBotAction(actionId: string, fd: FormData): Promise<ActionResult> {
  const c = await integrationsContext();
  if ("error" in c) return fail(c.error!);
  const action = await scopedAction(c.db, actionId);
  if (!action) return fail("Ação não encontrada.");
  let params: Record<string, unknown>;
  try {
    params = JSON.parse(text(fd.get("params")) || "{}") as Record<string, unknown>;
  } catch {
    return fail("Os parâmetros de exemplo não são um JSON válido.");
  }
  const r = await callAction(c.db, action, { params, mode: "test" });
  const head = `${r.status.toUpperCase()}${r.httpStatus ? ` · HTTP ${r.httpStatus}` : ""} · ${r.durationMs} ms · ${r.callId}`;
  const lines = [head, ...r.warnings.map((w) => `aviso: ${w}`), ...(r.error ? [`erro: ${r.error}`] : [])];
  if (r.status === "ok" || r.status === "not_found") lines.push("", JSON.stringify({ data: r.data, internal: r.internal ?? undefined, reply: r.reply ?? undefined, attachments: r.attachments?.length ? r.attachments : undefined, outcome: r.outcome ?? undefined }, null, 2).slice(0, 6000));
  return r.status === "ok" || r.status === "not_found" ? ok(lines.join("\n")) : fail(lines.join("\n"));
}

/* ------------------------------------------------------------------ chaves de API */

/** Chave da API pública: aparece uma vez; o banco guarda o hash. No teste grátis, só leitura e pausa. */
export async function createAgencyApiKey(fd: FormData): Promise<ActionResult> {
  const c = await integrationsContext();
  if ("error" in c) return fail(c.error!);
  const permissions = fd.getAll("permission").map(String);
  if (c.ctx.plan.id === "trial" && permissions.some((p) => !(TRIAL_KEY_PERMISSIONS as readonly string[]).includes(p))) {
    return fail("No teste grátis, as chaves só leem e pausam a IA (conversas, contatos e pareamento). Enviar mensagens e campanhas pela API fica nos planos pagos.");
  }
  const scope = await scopeFromForm(c.db, c.ctx.agency.id, fd);
  if ("error" in scope) return fail(scope.error);
  const name = text(fd.get("name"));
  const problem = apiKeyProblem({ name, scope, permissions });
  if (problem) return fail(problem);
  const created = await createApiKey(c.db, { agencyId: c.ctx.agency.id, name, scope, permissions: permissions.filter(isApiPermission) as ApiPermission[], createdBy: c.ctx.email });
  await auditIntegration(c.ctx, "api.chave.criar", { type: "api_key", id: created.id }, { name, prefix: created.prefix, escopo: scope, permissoes: permissions });
  done();
  return ok(`${created.key}\n\nCopie agora: ela não aparece de novo. Use no cabeçalho Authorization: Bearer <chave>.`);
}

export async function revokeAgencyApiKey(keyId: string): Promise<ActionResult> {
  const c = await integrationsContext();
  if ("error" in c) return fail(c.error!);
  const key = await revokeApiKey(c.db, c.ctx.agency.id, String(keyId), c.ctx.email);
  if (!key) return fail("Chave não encontrada ou já revogada.");
  await auditIntegration(c.ctx, "api.chave.revogar", { type: "api_key", id: key.id }, { name: key.name, prefix: key.prefix });
  done();
  return ok(`Chave ${key.prefix}… revogada: a próxima requisição com ela já recebe 401.`);
}

/* ------------------------------------------------------------------ webhooks */

/** Webhook novo: o segredo (whsec_) aparece uma vez. Limite igual ao de chatbots do plano. */
export async function createAgencyWebhook(fd: FormData): Promise<ActionResult> {
  const c = await integrationsContext();
  if ("error" in c) return fail(c.error!);
  const limit = planLimits(c.ctx.plan.id).webhooks;
  const { count } = await c.db.from("webhooks").select("id", { count: "exact", head: true }).eq("agency_id", c.ctx.agency.id);
  if ((count ?? 0) >= limit) return fail(`O plano ${c.ctx.plan.name} permite ${limit} webhook${limit === 1 ? "" : "s"} (um por chatbot do plano).`);
  const w = webhookInputFromForm(fd);
  if ("error" in w) return fail(w.error);
  const scope = await scopeFromForm(c.db, c.ctx.agency.id, fd);
  if ("error" in scope) return fail(scope.error);
  const created = await createWebhook(c.db, { agencyId: c.ctx.agency.id, ...w, scope, createdBy: c.ctx.email });
  await auditIntegration(c.ctx, "webhook.criar", { type: "webhook", id: created.id }, { name: w.name, url: w.url, events: w.events, escopo: scope });
  done();
  return ok(`${created.secret}\n\nCopie o segredo agora: ele não aparece de novo. As entregas vão assinadas no padrão Standard Webhooks.`);
}

export async function setAgencyWebhookActive(id: string, active: boolean): Promise<ActionResult> {
  const c = await integrationsContext();
  if ("error" in c) return fail(c.error!);
  const { data } = await c.db
    .from("webhooks")
    .update(active ? { active: true, disabled_at: null, disabled_reason: null, failing_since: null } : { active: false, disabled_at: new Date().toISOString(), disabled_reason: `desativado por ${c.ctx.email}` })
    .eq("id", String(id))
    .eq("agency_id", c.ctx.agency.id)
    .select("id");
  if (!data?.length) return fail("Webhook não encontrado.");
  await auditIntegration(c.ctx, active ? "webhook.reativar" : "webhook.desativar", { type: "webhook", id: String(id) });
  done();
  return ok(active ? "Webhook reativado." : "Webhook desativado: novos eventos não são entregues nem acumulam.");
}

export async function deleteAgencyWebhook(id: string): Promise<ActionResult> {
  const c = await integrationsContext();
  if ("error" in c) return fail(c.error!);
  const { data } = await c.db.from("webhooks").delete().eq("id", String(id)).eq("agency_id", c.ctx.agency.id).select("name");
  if (!data?.length) return fail("Webhook não encontrado.");
  await auditIntegration(c.ctx, "webhook.apagar", { type: "webhook", id: String(id) }, { name: data[0].name });
  done();
  return ok("Webhook apagado (as entregas dele também).");
}

/** "Enviar teste": webhook.test com a mesma assinatura, fora das novas tentativas e da contagem para desativar. */
export async function testAgencyWebhook(id: string): Promise<ActionResult> {
  const c = await integrationsContext();
  if ("error" in c) return fail(c.error!);
  const r = await sendWebhookTest(c.db, String(id), c.ctx.agency.id);
  if (!r) return fail("Webhook não encontrado.");
  const delivered = r.status !== null && r.status >= 200 && r.status < 300 && !r.error;
  return delivered ? ok(`Entregue: HTTP ${r.status}.`) : fail(`Não entregue: ${r.error ?? `HTTP ${r.status}`}.`);
}
