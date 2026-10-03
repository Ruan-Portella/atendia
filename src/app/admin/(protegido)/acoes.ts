"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/platform-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { text } from "@/lib/validation";
import { extendedTrialEnd } from "@/lib/backoffice";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { reviewDecisionEmail, type ComplianceStatus } from "@/lib/acceptance";
import { notifyAgencyOwner, notifyPlatform } from "@/lib/notify";
import { company } from "@/lib/company";
import { appUrl } from "@/lib/utils";
import { audit, requestMeta } from "@/lib/audit";
import { FEATURES, isFeature, type Feature } from "@/lib/features";
import { CATEGORIES, type GateCategory } from "@/lib/gate/rules";
import { analyzeBot, runDueAnalyses } from "@/lib/bot-analysis";
import { actionInputProblem, callAction, classifyCreatesOrder, rotateActionSecret, type ActionRow } from "@/lib/actions";

/** Auditoria das ações do backoffice (a agência afetada vê na tela de Segurança, leva S). */
async function auditAdmin(email: string, action: string, o: { agencyId?: string | null; targetType?: string; targetId?: string; after?: Record<string, unknown> } = {}) {
  await audit(createAdminClient(), { agencyId: o.agencyId ?? null, actorType: "support", actorId: email, action, targetType: o.targetType ?? null, targetId: o.targetId ?? null, after: o.after ?? null, ...(await requestMeta()) });
}

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
  await auditAdmin(s.email, "plataforma.pausar_ia", { after: { reason } });
  revalidatePath("/admin", "layout");
  return ok("IA de todos pausada.");
}

export async function resumeAllAi(): Promise<ActionResult> {
  const s = await requireAdmin("/admin (CHAVE GERAL: religou a IA de todos)");
  const { error } = await createAdminClient().from("platform_flags").update({ ai_paused_at: null, ai_paused_reason: null, updated_by: s.email, updated_at: new Date().toISOString() }).eq("id", 1);
  if (error) return fail("Não foi possível religar. Tente de novo.");
  await auditAdmin(s.email, "plataforma.religar_ia");
  revalidatePath("/admin", "layout");
  return ok("IA de todos religada.");
}

export async function pauseAgencyAi(agencyId: string, fd: FormData): Promise<ActionResult> {
  const reason = reasonOf(fd);
  if (typeof reason !== "string") return fail(reason.error);
  const s = await requireAdmin(`/admin/clientes/${agencyId} (pausou a IA: ${reason})`);
  const { error } = await createAdminClient().from("agencies").update({ ai_paused_at: new Date().toISOString(), ai_paused_reason: reason }).eq("id", agencyId);
  if (error) return fail("Não foi possível pausar. Tente de novo.");
  await auditAdmin(s.email, "agencia.pausar_ia", { agencyId, targetType: "agency", targetId: agencyId, after: { reason } });
  revalidatePath("/admin", "layout");
  return ok("IA da agência pausada.");
}

export async function resumeAgencyAi(agencyId: string): Promise<ActionResult> {
  const s = await requireAdmin(`/admin/clientes/${agencyId} (religou a IA)`);
  const { error } = await createAdminClient().from("agencies").update({ ai_paused_at: null, ai_paused_reason: null }).eq("id", agencyId);
  if (error) return fail("Não foi possível religar. Tente de novo.");
  await auditAdmin(s.email, "agencia.religar_ia", { agencyId, targetType: "agency", targetId: agencyId });
  revalidatePath("/admin", "layout");
  return ok("IA da agência religada.");
}

/** Estende o teste a partir de hoje ou do fim atual (o que vier depois); os avisos de fim voltam a valer. */
export async function extendTrial(agencyId: string, fd: FormData): Promise<ActionResult> {
  const days = Number(fd.get("days"));
  if (!TRIAL_DAYS.has(days)) return fail("Escolha quantos dias.");
  const s = await requireAdmin(`/admin/clientes/${agencyId} (estendeu o teste em ${days} dias)`);
  const db = createAdminClient();
  const { data: agency } = await db.from("agencies").select("plan, trial_ends_at").eq("id", agencyId).maybeSingle();
  if (!agency) return fail("Agência não encontrada.");
  if (agency.plan !== "trial") return fail("Só dá para estender o teste de quem ainda está no plano de teste.");
  const until = extendedTrialEnd(agency.trial_ends_at as string, days);
  const { error } = await db.from("agencies").update({ trial_ends_at: until, trial_reminder_sent_at: null, trial_expired_notified_at: null }).eq("id", agencyId);
  if (error) return fail("Não foi possível estender. Tente de novo.");
  await auditAdmin(s.email, "agencia.estender_teste", { agencyId, targetType: "agency", targetId: agencyId, after: { days, until } });
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
  await auditAdmin(s.email, "plataforma.desligar_whatsapp", { after: { reason } });
  revalidatePath("/admin", "layout");
  return ok("WhatsApp de todos desligado.");
}

export async function enableWhatsAppAll(): Promise<ActionResult> {
  const s = await requireAdmin("/admin (religou o WhatsApp de todos)");
  const { error } = await createAdminClient().from("platform_flags").update({ whatsapp_disabled_at: null, whatsapp_disabled_reason: null, updated_by: s.email, updated_at: new Date().toISOString() }).eq("id", 1);
  if (error) return fail("Não foi possível religar. Tente de novo.");
  await auditAdmin(s.email, "plataforma.religar_whatsapp");
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
  await auditAdmin(s.email, "canal.suspender", { agencyId, targetType: botId ? "bot" : "agency", targetId: botId ?? agencyId, after: { channel, reason } });
  revalidatePath("/admin", "layout");
  return ok("Canal suspenso.");
}

/** Levanta uma medida (da BoaVoz ou registrada da Meta): o canal volta a funcionar se nada mais o bloqueia. */
export async function liftMeasure(id: number): Promise<ActionResult> {
  const s = await requireAdmin(`/admin (levantou a medida ${id})`);
  const { data: lifted, error } = await createAdminClient().from("enforcement_actions").update({ lifted_at: new Date().toISOString(), lifted_by: s.email }).eq("id", id).is("lifted_at", null).select("agency_id, source, channel");
  if (error) return fail("Não foi possível levantar. Tente de novo.");
  if (lifted?.[0]) await auditAdmin(s.email, "medida.levantar", { agencyId: lifted[0].agency_id as string | null, targetType: "measure", targetId: String(id), after: { source: lifted[0].source, channel: lifted[0].channel } });
  revalidatePath("/admin", "layout");
  return ok("Medida levantada.");
}

/* ------------------------------------------------------------------ revisão do negócio (tela de aceite) */

/** Aprova o negócio: vira ativo (o WhatsApp pode conectar) e levanta as suspensões criadas pelo bloqueio. */
export async function approveBusiness(clientId: string): Promise<ActionResult> {
  const s = await requireAdmin(`/admin/conformidade (aprovou o negócio ${clientId})`);
  const db = createAdminClient();
  const row = await reviewedBusiness(clientId);
  if (!row) return fail("Negócio não encontrado.");
  const now = new Date().toISOString();
  const { error } = await db.from("business_compliance").update({ status: "ativo", reviewed_at: now, reviewed_by: s.email, review_note: null }).eq("client_id", clientId);
  if (error) return fail("Não foi possível aprovar. Tente de novo.");
  await db.from("enforcement_actions").update({ lifted_at: now, lifted_by: s.email }).eq("source", "boavoz").eq("detail->>client_id", clientId).is("lifted_at", null);
  const sent = await tellAgency(row, { decision: "aprovado" });
  await auditAdmin(s.email, "negocio.aprovar", { agencyId: row.agencyId, targetType: "client", targetId: clientId, after: { previous: row.previous } });
  revalidatePath("/admin", "layout");
  return ok(`Negócio aprovado.${sent}`);
}

/** O negócio em revisão: estado atual, agência e nome (para o e-mail da decisão). */
async function reviewedBusiness(clientId: string) {
  const { data } = await createAdminClient().from("business_compliance").select("status, agency_id, clients(name)").eq("client_id", clientId).maybeSingle();
  if (!data) return null;
  const client = (Array.isArray(data.clients) ? data.clients[0] : data.clients) as { name: string } | null;
  return { clientId, agencyId: data.agency_id as string, previous: data.status as ComplianceStatus, clientName: client?.name ?? "Cliente" };
}

/** Avisa o dono da agência da decisão; devolve o complemento da mensagem do backoffice. */
async function tellAgency(row: NonNullable<Awaited<ReturnType<typeof reviewedBusiness>>>, o: { decision: "aprovado" | "bloqueado"; reason?: string }): Promise<string> {
  const mail = reviewDecisionEmail({ ...o, clientName: row.clientName, previous: row.previous, link: appUrl(`/painel/clientes/${row.clientId}?tab=conformidade`), supportEmail: company.email });
  const sent = await notifyAgencyOwner(createAdminClient(), row.agencyId, mail.subject, mail.lines).catch(() => false);
  return sent ? " A agência foi avisada por e-mail." : " O e-mail para a agência não saiu (sem Resend neste ambiente ou sem e-mail do dono).";
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
  const row = await reviewedBusiness(clientId);
  if (!row) return fail("Negócio não encontrado.");
  const { error } = await db.from("business_compliance").update({ status: "bloqueado", reviewed_at: new Date().toISOString(), reviewed_by: s.email, review_note: reason }).eq("client_id", clientId);
  if (error) return fail("Não foi possível bloquear. Tente de novo.");
  const { data: bots } = await db.from("bots").select("id").eq("client_id", clientId).eq("is_demo", false);
  const measures = (bots ?? []).flatMap((b) =>
    (["whatsapp", "instagram"] as const).map((channel) => ({ source: "boavoz", feature: "channel", channel, agency_id: row.agencyId, bot_id: b.id, reason: `negócio bloqueado na revisão: ${reason}`, detail: { client_id: clientId }, created_by: s.email })),
  );
  if (measures.length) await db.from("enforcement_actions").insert(measures);
  const sent = await tellAgency(row, { decision: "bloqueado", reason });
  await auditAdmin(s.email, "negocio.bloquear", { agencyId: row.agencyId, targetType: "client", targetId: clientId, after: { previous: row.previous, reason } });
  revalidatePath("/admin", "layout");
  return ok(`Negócio bloqueado.${sent}`);
}

/* ------------------------------------------------------------------ incidentes de segurança (docs/incidentes.md) */

const SEVERITIES = new Set(["baixo", "medio", "alto"]);
const INCIDENT_STATUS = new Set(["aberto", "contido", "encerrado"]);
const longText = (fd: FormData, name: string) => String(fd.get(name) ?? "").trim().slice(0, 4000) || null;

/** Abre o registro de um incidente (sem dado pessoal no texto: contagens e tipos). */
export async function createIncident(fd: FormData): Promise<ActionResult> {
  const title = text(fd.get("title")).slice(0, 200);
  if (title.length < 3) return fail("Dê um título ao incidente.");
  const severity = text(fd.get("severity"));
  if (!SEVERITIES.has(severity)) return fail("Escolha a severidade.");
  const detectedRaw = text(fd.get("detected_at"));
  const detected = detectedRaw ? new Date(`${detectedRaw}:00-03:00`) : new Date();
  if (Number.isNaN(detected.getTime())) return fail("Data de detecção inválida.");
  const s = await requireAdmin(`/admin/conformidade (registrou incidente: ${title})`);
  const { data, error } = await createAdminClient()
    .from("security_incidents")
    .insert({ title, severity, detected_at: detected.toISOString(), description: longText(fd, "description"), affected: longText(fd, "affected"), created_by: s.email, updated_by: s.email })
    .select("id")
    .single();
  if (error || !data) return fail("Não foi possível registrar. Tente de novo.");
  await auditAdmin(s.email, "incidente.registrar", { targetType: "incident", targetId: String(data.id), after: { title, severity } });
  if (severity === "alto") await notifyPlatform(`Incidente de severidade alta: ${title}`, [`Registrado por ${s.email}.`, "Siga docs/incidentes.md e avise as pessoas da Continuidade.", "Backoffice: /admin/conformidade"]).catch(() => false);
  revalidatePath("/admin", "layout");
  return ok("Incidente registrado. Siga o roteiro (docs/incidentes.md).");
}

/** Atualiza o andamento: status, contenção, avaliação de risco e quem já foi avisado. */
export async function updateIncident(id: number, fd: FormData): Promise<ActionResult> {
  const status = text(fd.get("status"));
  if (!INCIDENT_STATUS.has(status)) return fail("Escolha o status.");
  const risk = text(fd.get("risk_relevant"));
  const s = await requireAdmin(`/admin/conformidade (atualizou o incidente ${id})`);
  const db = createAdminClient();
  const { data: current } = await db.from("security_incidents").select("status, agencies_notified_at, anpd_notified_at, closed_at").eq("id", id).maybeSingle();
  if (!current) return fail("Incidente não encontrado.");
  const now = new Date().toISOString();
  const patch = {
    status,
    actions: longText(fd, "actions"),
    affected: longText(fd, "affected"),
    risk_relevant: risk === "sim" ? true : risk === "nao" ? false : null,
    // "marcar agora" só vale uma vez: a primeira data fica
    agencies_notified_at: current.agencies_notified_at ?? (fd.get("agencies_notified") === "on" ? now : null),
    anpd_notified_at: current.anpd_notified_at ?? (fd.get("anpd_notified") === "on" ? now : null),
    closed_at: status === "encerrado" ? (current.closed_at ?? now) : null,
    updated_by: s.email,
    updated_at: now,
  };
  const { error } = await db.from("security_incidents").update(patch).eq("id", id);
  if (error) return fail("Não foi possível salvar. Tente de novo.");
  await auditAdmin(s.email, "incidente.atualizar", { targetType: "incident", targetId: String(id), after: { status, risk_relevant: patch.risk_relevant, agencies_notified: Boolean(patch.agencies_notified_at), anpd_notified: Boolean(patch.anpd_notified_at) } });
  revalidatePath("/admin", "layout");
  return ok("Incidente atualizado.");
}

/* ------------------------------------------------------------------ liberação (recursos por agência e abertura dos canais) */

/**
 * Recursos liberados para uma agência (WhatsApp no beta e no teste grátis, Instagram no beta).
 * Liberar avisa o dono por e-mail; tirar não desconecta o que já está ligado (só impede conectar
 * de novo e os modelos do WhatsApp).
 */
export async function setAgencyFeatures(agencyId: string, fd: FormData): Promise<ActionResult> {
  const wanted = (Object.keys(FEATURES) as Feature[]).filter((f) => fd.get(f) === "on");
  const s = await requireAdmin(`/admin/clientes/${agencyId} (liberação: ${wanted.join(", ") || "nenhum recurso"})`);
  const db = createAdminClient();
  const { data: agency } = await db.from("agencies").select("features").eq("id", agencyId).maybeSingle();
  if (!agency) return fail("Agência não encontrada.");
  const before = (agency.features as string[] | null) ?? [];
  // recursos que esta tela não conhece (de fases seguintes) ficam como estão
  const after = [...before.filter((f) => !isFeature(f)), ...wanted];
  const { error } = await db.from("agencies").update({ features: after }).eq("id", agencyId);
  if (error) return fail("Não foi possível salvar. Tente de novo.");
  await auditAdmin(s.email, "agencia.liberacao", { agencyId, targetType: "agency", targetId: agencyId, after: { antes: before, depois: after } });
  const added = wanted.filter((f) => !before.includes(f));
  if (added.length) {
    const names = added.map((f) => FEATURES[f].label).join(" e ");
    await notifyAgencyOwner(db, agencyId, `${names} liberado na sua conta ${company.brand}`, [
      `O ${names} foi liberado na sua conta.`,
      "",
      `Para conectar, abra o chatbot do cliente no painel, na aba ${names}: ${appUrl("/painel/clientes")}`,
    ]).catch(() => false);
  }
  revalidatePath("/admin", "layout");
  return ok(added.length ? `Liberado e avisado por e-mail: ${added.map((f) => FEATURES[f].label).join(", ")}.` : "Liberação salva.");
}

const OPEN_COLUMN: Record<Feature, "whatsapp_open_at" | "instagram_open_at"> = { whatsapp: "whatsapp_open_at", instagram: "instagram_open_at" };

/** Abertura geral de um canal: o WhatsApp para os planos pagos (teste grátis segue manual), o Instagram para todos. */
export async function openChannel(channel: Feature, fd: FormData): Promise<ActionResult> {
  if (fd.get("confirm") !== "on") return fail("Marque a confirmação.");
  const s = await requireAdmin(`/admin (ABRIU o ${FEATURES[channel].label} para todos)`);
  const { error } = await createAdminClient().from("platform_flags").update({ [OPEN_COLUMN[channel]]: new Date().toISOString(), updated_by: s.email, updated_at: new Date().toISOString() }).eq("id", 1);
  if (error) return fail("Não foi possível abrir. Tente de novo.");
  await auditAdmin(s.email, "plataforma.abrir_canal", { after: { channel } });
  revalidatePath("/admin", "layout");
  return ok(`${FEATURES[channel].label} aberto.`);
}

export async function closeChannel(channel: Feature): Promise<ActionResult> {
  const s = await requireAdmin(`/admin (fechou a abertura do ${FEATURES[channel].label})`);
  const { error } = await createAdminClient().from("platform_flags").update({ [OPEN_COLUMN[channel]]: null, updated_by: s.email, updated_at: new Date().toISOString() }).eq("id", 1);
  if (error) return fail("Não foi possível fechar. Tente de novo.");
  await auditAdmin(s.email, "plataforma.fechar_canal", { after: { channel } });
  revalidatePath("/admin", "layout");
  return ok(`Abertura do ${FEATURES[channel].label} fechada: só as agências liberadas conectam.`);
}

/* ------------------------------------------------------------------ portão: "isto não é {categoria}" */

const gateLabel = (c: string) => CATEGORIES[c as GateCategory]?.label ?? c;

/** Aprova o pedido: a categoria deixa de ser tratada pelo portão só naquele chatbot. Avisa o dono. */
export async function approveGateReview(id: number): Promise<ActionResult> {
  const s = await requireAdmin(`/admin/conformidade (aprovou a revisão do portão ${id})`);
  const db = createAdminClient();
  const { data: req } = await db.from("gate_review_requests").select("id, agency_id, bot_id, category, status, bots(name, client_name)").eq("id", id).maybeSingle();
  if (!req || req.status !== "pendente") return fail("Pedido não encontrado ou já decidido.");
  const { error } = await db.from("bot_gate_exceptions").upsert({ bot_id: req.bot_id, category: req.category, request_id: id, approved_by: s.email }, { onConflict: "bot_id,category" });
  if (error) return fail("Não foi possível aprovar. Tente de novo.");
  await db.from("gate_review_requests").update({ status: "aprovado", decided_by: s.email, decided_at: new Date().toISOString() }).eq("id", id);
  await auditAdmin(s.email, "portao.aprovar_excecao", { agencyId: req.agency_id as string, targetType: "bot", targetId: req.bot_id as string, after: { category: req.category } });
  const bot = (Array.isArray(req.bots) ? req.bots[0] : req.bots) as { name: string; client_name: string } | null;
  const label = gateLabel(req.category as string);
  await notifyAgencyOwner(db, req.agency_id as string, `Revisão aprovada: ${label} no chatbot ${bot?.name ?? ""}`, [
    `A equipe ${company.brand} revisou o pedido "isto não é ${label}" do chatbot ${bot?.name ?? ""} (${bot?.client_name ?? ""}) e aprovou.`,
    "",
    `A partir de agora, o assistente desse chatbot não trata mais "${label}" como item restrito. Vale só para ele.`,
  ]).catch(() => false);
  revalidatePath("/admin", "layout");
  return ok("Aprovado: a exceção vale para este chatbot.");
}

/** Recusa o pedido, com o motivo (vai para o dono por e-mail). */
export async function rejectGateReview(id: number, fd: FormData): Promise<ActionResult> {
  const reason = reasonOf(fd);
  if (typeof reason !== "string") return fail(reason.error);
  const s = await requireAdmin(`/admin/conformidade (recusou a revisão do portão ${id})`);
  const db = createAdminClient();
  const { data: req } = await db.from("gate_review_requests").update({ status: "recusado", decided_by: s.email, decided_at: new Date().toISOString(), decision_note: reason }).eq("id", id).eq("status", "pendente").select("agency_id, bot_id, category, bots(name, client_name)").maybeSingle();
  if (!req) return fail("Pedido não encontrado ou já decidido.");
  await auditAdmin(s.email, "portao.recusar_excecao", { agencyId: req.agency_id as string, targetType: "bot", targetId: req.bot_id as string, after: { category: req.category, reason } });
  const bot = (Array.isArray(req.bots) ? req.bots[0] : req.bots) as { name: string; client_name: string } | null;
  const label = gateLabel(req.category as string);
  await notifyAgencyOwner(db, req.agency_id as string, `Revisão recusada: ${label} no chatbot ${bot?.name ?? ""}`, [
    `A equipe ${company.brand} revisou o pedido "isto não é ${label}" do chatbot ${bot?.name ?? ""} (${bot?.client_name ?? ""}) e manteve a regra.`,
    "",
    `Motivo: ${reason}`,
  ]).catch(() => false);
  revalidatePath("/admin", "layout");
  return ok("Pedido recusado e o dono avisado.");
}

/** Tira uma exceção: o portão volta a tratar a categoria naquele chatbot. */
export async function revokeGateException(botId: string, category: string): Promise<ActionResult> {
  const s = await requireAdmin(`/admin/conformidade (revogou a exceção ${category} do bot ${botId})`);
  const { data, error } = await createAdminClient().from("bot_gate_exceptions").delete().eq("bot_id", botId).eq("category", category).select("bot_id, bots(agency_id)");
  if (error) return fail("Não foi possível revogar. Tente de novo.");
  if (!data?.length) return fail("Exceção não encontrada.");
  const agencyId = ((Array.isArray(data[0].bots) ? data[0].bots[0] : data[0].bots) as { agency_id: string } | null)?.agency_id ?? null;
  await auditAdmin(s.email, "portao.revogar_excecao", { agencyId, targetType: "bot", targetId: botId, after: { category } });
  revalidatePath("/admin", "layout");
  return ok("Exceção revogada: o portão volta a valer para essa categoria.");
}

/* ------------------------------------------------------------------ análise do bot */

/** Roda agora as análises agendadas (na dev os crons não rodam; em produção a rotina diária roda). */
export async function runAnalysesNow(): Promise<ActionResult> {
  const s = await requireAdmin("/admin/conformidade (rodou as análises do bot agendadas)");
  const r = await runDueAnalyses(createAdminClient(), { budgetMs: 50_000, limit: 10 });
  await auditAdmin(s.email, "analise.rodar_agendadas", { after: r });
  revalidatePath("/admin", "layout");
  return ok(`Análises: ${r.feitas} feitas, ${r.puladas} sem mudança ou sem base${r.falhas ? `, ${r.falhas} com erro` : ""}. Ainda agendadas: ${r.restantes}.`);
}

/** Roda de novo a análise de um chatbot, mesmo sem mudança. */
export async function rerunAnalysis(botId: string): Promise<ActionResult> {
  const s = await requireAdmin(`/admin/conformidade (rodou de novo a análise do bot ${botId})`);
  try {
    const r = await analyzeBot(createAdminClient(), botId, { force: true });
    await auditAdmin(s.email, "analise.rodar_de_novo", { targetType: "bot", targetId: botId, after: { status: r.status } });
    revalidatePath("/admin", "layout");
    const msg: Record<string, string> = { feita: r.pending ? "Análise feita: ficou pendente para revisão." : "Análise feita: nada para revisar.", sem_base: "O chatbot não tem fonte pronta.", aguardando_classificacao: "A base ainda está sendo classificada; a análise ficou agendada.", ignorado: "Chatbot de demonstração: sem análise.", igual: "Sem mudança." };
    return ok(msg[r.status] ?? "Feito.");
  } catch (e) {
    return fail(`A análise falhou: ${(e as Error).message}`);
  }
}

/** Revisão de uma pendência da análise: segue normal (o negócio continua como está). */
export async function resolveAnalysis(id: number, fd: FormData): Promise<ActionResult> {
  const note = text(fd.get("note")).slice(0, 200) || "revisado: segue normal";
  const s = await requireAdmin(`/admin/conformidade (resolveu a análise ${id})`);
  const { data, error } = await createAdminClient().from("compliance_checks").update({ review_state: "resolved", resolved_by: s.email, resolved_at: new Date().toISOString(), resolution: note }).eq("id", id).eq("review_state", "pending").select("agency_id, bot_id").maybeSingle();
  if (error) return fail("Não foi possível resolver. Tente de novo.");
  if (!data) return fail("Pendência não encontrada ou já resolvida.");
  await auditAdmin(s.email, "analise.resolver", { agencyId: data.agency_id as string, targetType: "bot", targetId: data.bot_id as string, after: { note } });
  revalidatePath("/admin", "layout");
  return ok("Pendência resolvida.");
}

/** Revisão de uma pendência da análise: bloqueia o negócio (WhatsApp e Instagram) e fecha a pendência. */
export async function blockFromAnalysis(id: number, fd: FormData): Promise<ActionResult> {
  const db = createAdminClient();
  const { data: check } = await db.from("compliance_checks").select("client_id, agency_id, review_state").eq("id", id).maybeSingle();
  if (!check || check.review_state !== "pending") return fail("Pendência não encontrada ou já resolvida.");
  if (!check.client_id) return fail("Este chatbot não tem cliente: ligue-o a um cliente antes de bloquear.");
  // cliente que nunca passou pela tela de aceite: o estado do negócio nasce aqui, para o bloqueio valer
  const { data: business } = await db.from("business_compliance").select("client_id").eq("client_id", check.client_id).maybeSingle();
  if (!business) await db.from("business_compliance").insert({ client_id: check.client_id, agency_id: check.agency_id, answers: {}, answered_by: "BoaVoz (análise do bot)", status: "em_revisao" });
  const r = await blockBusiness(check.client_id as string, fd);
  if (!r.ok) return r;
  const s = await requireAdmin(`/admin/conformidade (bloqueou pela análise ${id})`);
  await createAdminClient().from("compliance_checks").update({ review_state: "resolved", resolved_by: s.email, resolved_at: new Date().toISOString(), resolution: `bloqueado: ${text(fd.get("reason")).slice(0, 200)}` }).eq("id", id);
  revalidatePath("/admin", "layout");
  return ok("Negócio bloqueado e pendência fechada.");
}

/* ------------------------------------------------------------------ Integrações dos pilotos (P1), configuradas à mão */

/** Bot da agência (não demo), para as ações de Integrações. */
async function pilotBot(agencyId: string, botId: string) {
  const { data } = await createAdminClient().from("bots").select("id, agency_id, name").eq("id", botId).eq("agency_id", agencyId).eq("is_demo", false).maybeSingle();
  return data;
}

/** Gera ou troca o segredo de ações do bot. O segredo aparece uma vez só, na própria tela. */
export async function generateActionSecret(agencyId: string, botId: string, fd: FormData): Promise<ActionResult> {
  const s = await requireAdmin(`/admin/clientes/${agencyId}/integracoes (segredo de ações do bot ${botId})`);
  if (!(await pilotBot(agencyId, botId))) return fail("Chatbot não encontrado nesta agência.");
  const invalidate = fd.get("invalidate") === "on";
  const secret = await rotateActionSecret(createAdminClient(), botId, { invalidatePrevious: invalidate });
  await auditAdmin(s.email, "acoes.segredo", { agencyId, targetType: "bot", targetId: botId, after: { invalidou_anterior: invalidate } });
  await notifyAgencyOwner(createAdminClient(), agencyId, "Segredo de ações gerado", [
    "A equipe BoaVoz gerou um segredo de ações para um dos seus chatbots (Integrações, piloto).",
    invalidate ? "O segredo anterior deixou de valer na hora." : "Se havia um segredo anterior, ele vale por mais 24 horas.",
    "Se não foi combinado com você, fale com o suporte.",
  ]).catch(() => false);
  return ok(`${secret}\n\nCopie agora: ele não aparece de novo. ${invalidate ? "O anterior deixou de valer." : "O anterior (se havia) vale por mais 24 horas."}`);
}

/** Cria ou edita uma ação de consulta. Ação que parece criar pedido, reserva ou cobrança fica salva e desativada. */
export async function saveAction(agencyId: string, botId: string, actionId: string | null, fd: FormData): Promise<ActionResult> {
  const s = await requireAdmin(`/admin/clientes/${agencyId}/integracoes (${actionId ? "editou" : "criou"} ação)`);
  if (!(await pilotBot(agencyId, botId))) return fail("Chatbot não encontrado nesta agência.");
  let schema: unknown;
  try {
    schema = JSON.parse(text(fd.get("params_schema")) || '{"type":"object","properties":{}}');
  } catch {
    return fail("Os parâmetros não são um JSON válido.");
  }
  const input = {
    name: text(fd.get("name")),
    description: String(fd.get("description") ?? "").trim(),
    url: text(fd.get("url")),
    params_schema: schema,
    min_level: (["anonimo", "canal", "usuario"].includes(text(fd.get("min_level"))) ? text(fd.get("min_level")) : "anonimo") as "anonimo" | "canal" | "usuario",
    outcomes: text(fd.get("outcomes")).split(",").map((o) => o.trim()).filter(Boolean),
    active: fd.get("active") === "on",
  };
  const problem = actionInputProblem(input);
  if (problem) return fail(problem);
  const db = createAdminClient();
  // efeito classificado pela IA do BoaVoz: pedido, reserva ou cobrança só com confirmação por botão (C pública)
  const createsOrder = await classifyCreatesOrder(db, agencyId, input);
  const row = { bot_id: botId, ...input, type: "query", active: input.active && !createsOrder, creates_order: createsOrder, updated_at: new Date().toISOString() };
  const { error } = actionId ? await db.from("actions").update(row).eq("id", actionId).eq("bot_id", botId) : await db.from("actions").insert(row);
  if (error) return fail(/duplicate|unique/i.test(error.message) ? "Já existe uma ação com esse nome neste chatbot." : `Não foi possível salvar: ${error.message}`);
  await auditAdmin(s.email, actionId ? "acoes.editar" : "acoes.criar", { agencyId, targetType: "bot", targetId: botId, after: { name: input.name, url: input.url, creates_order: createsOrder } });
  revalidatePath("/admin", "layout");
  return createsOrder
    ? ok(`Ação salva e DESATIVADA: ela parece criar pedido, reserva ou cobrança, e isso precisa da confirmação por botão, que chega na C pública.`)
    : ok(`Ação ${input.name} salva${input.active ? " e ativa" : " (desativada)"}.`);
}

export async function deleteAction(agencyId: string, actionId: string): Promise<ActionResult> {
  const s = await requireAdmin(`/admin/clientes/${agencyId}/integracoes (apagou a ação ${actionId})`);
  const { data, error } = await createAdminClient().from("actions").delete().eq("id", actionId).select("bot_id, name, bots!inner(agency_id)").eq("bots.agency_id", agencyId);
  if (error) return fail("Não foi possível apagar. Tente de novo.");
  if (!data?.length) return fail("Ação não encontrada.");
  await auditAdmin(s.email, "acoes.apagar", { agencyId, targetType: "bot", targetId: data[0].bot_id as string, after: { name: data[0].name } });
  revalidatePath("/admin", "layout");
  return ok("Ação apagada.");
}

/** Botão Testar: chama o endpoint de verdade com test: true e os parâmetros de exemplo. */
export async function testAction(agencyId: string, actionId: string, fd: FormData): Promise<ActionResult> {
  await requireAdmin(`/admin/clientes/${agencyId}/integracoes (testou a ação ${actionId})`);
  const db = createAdminClient();
  const { data: action } = await db.from("actions").select("*, bots!inner(agency_id)").eq("id", actionId).eq("bots.agency_id", agencyId).maybeSingle();
  if (!action) return fail("Ação não encontrada.");
  let params: Record<string, unknown>;
  try {
    params = JSON.parse(text(fd.get("params")) || "{}") as Record<string, unknown>;
  } catch {
    return fail("Os parâmetros de exemplo não são um JSON válido.");
  }
  const r = await callAction(db, action as unknown as ActionRow, { params, mode: "test" });
  const head = `${r.status.toUpperCase()}${r.httpStatus ? ` · HTTP ${r.httpStatus}` : ""} · ${r.durationMs} ms · ${r.callId}`;
  const lines = [head, ...r.warnings.map((w) => `aviso: ${w}`), ...(r.error ? [`erro: ${r.error}`] : [])];
  if (r.status === "ok" || r.status === "not_found") lines.push("", JSON.stringify({ data: r.data, reply: r.reply ?? undefined, attachments: r.attachments?.length ? r.attachments : undefined, outcome: r.outcome ?? undefined }, null, 2).slice(0, 6000));
  return r.status === "ok" || r.status === "not_found" ? ok(lines.join("\n")) : fail(lines.join("\n"));
}
