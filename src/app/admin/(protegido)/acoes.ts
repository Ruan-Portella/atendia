"use server";

import { revalidatePath } from "next/cache";
import { retireUnsizedChannels } from "@/lib/free-inbox";
import { clientsOfScope, trackCompliance } from "@/lib/platform-events";
import { requireAdmin } from "@/lib/platform-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { text } from "@/lib/validation";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { reviewDecisionEmail, type ComplianceStatus } from "@/lib/acceptance";
import { notifyAgencyOwner, notifyPlatform } from "@/lib/notify";
import { company } from "@/lib/company";
import { appUrl } from "@/lib/utils";
import { audit, requestMeta } from "@/lib/audit";
import { FEATURES, isFeature, type Feature } from "@/lib/features";
import { CATEGORIES, type GateCategory } from "@/lib/gate/rules";
import { analyzeBot, runDueAnalyses } from "@/lib/bot-analysis";
import { actionInputProblem, callAction, classifyCreatesOrder, needsConfirmation, rotateActionSecret, type ActionRow } from "@/lib/actions";
import { apiKeyProblem, createApiKey, isApiPermission, revokeApiKey } from "@/lib/api-keys";
import { createIdentitySecret, revokeIdentitySecret, type IdentityScope } from "@/lib/identity";
import { createWebhook, sendWebhookTest } from "@/lib/webhooks";
import { syncSubscriptionSafe } from "@/lib/billing-sync";
import { isBotSize } from "@/lib/plans";
import { SIGNAL_KINDS, TEST_THRESHOLDS, THRESHOLDS, runContinuousChecks } from "@/lib/continuous-check";
import { refreshReportDaily } from "@/lib/report-daily";
import { cronsScheduledHere } from "@/lib/backoffice-ops";
import { deadline, withCronLock } from "@/lib/cron";
import { costText, createCampaign, estimateFor, runCampaignTick, setCampaignStatus, templateProblem } from "@/lib/campaigns";
import { whatsappContact } from "@/lib/contacts";
import { canonicalPhone } from "@/lib/phone";
import { actionInputFromForm, actionSavedMessage, headersColumn, headersFromForm, scopeFromForm, webhookInputFromForm } from "@/lib/integrations-input";
import { ComponentProblem, parseComponentInput } from "@/lib/component-input";

/** Auditoria das ações do backoffice (a agência afetada vê na tela de Segurança, leva S). */
async function auditAdmin(email: string, action: string, o: { agencyId?: string | null; targetType?: string; targetId?: string; after?: Record<string, unknown> } = {}) {
  await audit(createAdminClient(), { agencyId: o.agencyId ?? null, actorType: "support", actorId: email, action, targetType: o.targetType ?? null, targetId: o.targetId ?? null, after: o.after ?? null, ...(await requestMeta()) });
}

/*
 * Ações do backoffice que mudam o funcionamento: pausar a IA (de uma agência ou de todas, a
 * chave geral). Cada uma fica no registro de acesso, com o que foi feito.
 */

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

/**
 * Tamanho do chatbot pelo backoffice: testes antes da cobrança por tamanho e o plano sob medida
 * (cota combinada no lugar da do tamanho). Vazio = sem tamanho (o chatbot fica sem cota).
 */
export async function setBotSize(agencyId: string, botId: string, fd: FormData): Promise<ActionResult> {
  const raw = text(fd.get("size"));
  const size = raw === "" ? null : raw;
  if (size !== null && !isBotSize(size)) return fail("Escolha o tamanho.");
  const packs = size === "volume" ? Number(text(fd.get("packs")).replace(/\D/g, "") || "0") : null;
  if (packs !== null && (!Number.isSafeInteger(packs) || packs < 1 || packs > 1000)) return fail("No Volume, informe de 1 a 1.000 pacotes.");
  const overrideRaw = text(fd.get("override")).replace(/\D/g, "");
  const override = overrideRaw ? Number(overrideRaw) : null;
  if (override !== null && (!Number.isSafeInteger(override) || override > 10_000_000)) return fail("Cota sob medida inválida.");
  const s = await requireAdmin(`/admin/clientes/${agencyId} (tamanho do chatbot ${botId})`);
  const db = createAdminClient();
  const { data: before } = await db.from("bots").select("size, volume_packs, quota_override").eq("id", botId).eq("agency_id", agencyId).maybeSingle();
  if (!before) return fail("Chatbot não encontrado.");
  // decisão da BoaVoz: vale na hora, com a cota cheia do mês, e a troca agendada sai
  const { error } = await db.from("bots").update({ size, volume_packs: packs, quota_override: override, pending_size: null, pending_volume_packs: null, pending_from: null, prorated_month: null, prorated_quota: null }).eq("id", botId);
  if (error) return fail("Não foi possível salvar. Tente de novo.");
  await auditAdmin(s.email, "chatbot.tamanho", { agencyId, targetType: "bot", targetId: botId, after: { de: before, para: { size, volume_packs: packs, quota_override: override } } });
  // conta com assinatura: a próxima fatura acompanha (sem cobrança proporcional; sob medida fica fora)
  await syncSubscriptionSafe(db, agencyId);
  revalidatePath("/admin", "layout");
  return ok(override !== null ? `Cota sob medida: ${override.toLocaleString("pt-BR")} atendimentos por mês.` : size ? "Tamanho salvo." : "Chatbot sem tamanho: ele fica sem cota.");
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
  // webhooks: compliance.changed para cada cliente tocado (o do chatbot, ou todos os da agência)
  const { error } = await trackCompliance(db, () => clientsOfScope(db, { botId, agencyId }), (r) => `medida:${r.data?.id}`, async () =>
    db.from("enforcement_actions").insert({ source: "boavoz", feature: "channel", channel, agency_id: agencyId, bot_id: botId, reason, created_by: s.email }).select("id").single(),
  );
  if (error) return fail("Não foi possível suspender. Tente de novo.");
  await auditAdmin(s.email, "canal.suspender", { agencyId, targetType: botId ? "bot" : "agency", targetId: botId ?? agencyId, after: { channel, reason } });
  revalidatePath("/admin", "layout");
  return ok("Canal suspenso.");
}

/** Levanta uma medida (da BoaVoz ou registrada da Meta): o canal volta a funcionar se nada mais o bloqueia. */
export async function liftMeasure(id: number): Promise<ActionResult> {
  const s = await requireAdmin(`/admin (levantou a medida ${id})`);
  const db = createAdminClient();
  const { data: measure } = await db.from("enforcement_actions").select("agency_id, bot_id, waba_id, source").eq("id", id).maybeSingle();
  const scope = measure?.source === "boavoz" ? { botId: measure.bot_id as string | null, agencyId: measure.agency_id as string | null } : { wabaId: (measure?.waba_id as string | null) ?? null };
  const { data: lifted, error } = await trackCompliance(db, () => (measure ? clientsOfScope(db, scope) : Promise.resolve([])), `medida:${id}:levantada`, async () =>
    db.from("enforcement_actions").update({ lifted_at: new Date().toISOString(), lifted_by: s.email }).eq("id", id).is("lifted_at", null).select("agency_id, source, channel"),
  );
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
  // webhooks: compliance.changed (estado e restrições, depois de levantar as suspensões do bloqueio)
  const approved = await trackCompliance(db, [clientId], `revisao:${now}`, async () => {
    const { error } = await db.from("business_compliance").update({ status: "ativo", reviewed_at: now, reviewed_by: s.email, review_note: null }).eq("client_id", clientId);
    if (error) return false;
    await db.from("enforcement_actions").update({ lifted_at: now, lifted_by: s.email }).eq("source", "boavoz").eq("detail->>client_id", clientId).is("lifted_at", null);
    return true;
  });
  if (!approved) return fail("Não foi possível aprovar. Tente de novo.");
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
  const now = new Date().toISOString();
  // webhooks: compliance.changed (o texto da revisão fica no BoaVoz: o evento leva um resumo fixo)
  const blocked = await trackCompliance(db, [clientId], `revisao:${now}`, async () => {
    const { error } = await db.from("business_compliance").update({ status: "bloqueado", reviewed_at: now, reviewed_by: s.email, review_note: reason }).eq("client_id", clientId);
    if (error) return false;
    const { data: bots } = await db.from("bots").select("id").eq("client_id", clientId).eq("is_demo", false);
    const measures = (bots ?? []).flatMap((b) =>
      (["whatsapp", "instagram"] as const).map((channel) => ({ source: "boavoz", feature: "channel", channel, agency_id: row.agencyId, bot_id: b.id, reason: `negócio bloqueado na revisão: ${reason}`, detail: { client_id: clientId }, created_by: s.email })),
    );
    if (measures.length) await db.from("enforcement_actions").insert(measures);
    return true;
  });
  if (!blocked) return fail("Não foi possível bloquear. Tente de novo.");
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
 * Recursos liberados para uma agência (WhatsApp e Instagram antes da abertura geral).
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

/** Abertura geral de um canal: toda agência conecta sem liberação (o chatbot atende com um tamanho). */
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

/**
 * Verificação contínua agora (no staging não há cron): atualiza os totais diários e roda os sinais.
 * Limites de teste só fora da produção.
 */
export async function runContinuousNow(fd: FormData): Promise<ActionResult> {
  const test = fd.get("test") === "on" && !cronsScheduledHere();
  const s = await requireAdmin(`/admin/conformidade (rodou a verificação contínua${test ? " com limites de teste" : ""})`);
  const db = createAdminClient();
  try {
    const hasTime = deadline(30_000);
    await refreshReportDaily(db, () => hasTime());
    const r = await runContinuousChecks(db, { thresholds: test ? TEST_THRESHOLDS : THRESHOLDS });
    await auditAdmin(s.email, "conformidade.verificar", { after: { test, clientes: r.clients, sinais: r.opened.length } });
    revalidatePath("/admin", "layout");
    return ok(`${r.clients} cliente(s) com dados nas 8 semanas · ${r.opened.length ? `${r.opened.length} sinal(is) novo(s)` : "nenhum sinal novo"}.`);
  } catch (e) {
    return fail(`A verificação falhou: ${(e as Error).message}`);
  }
}

/** Revisão de um sinal da verificação contínua: fecha a pendência com a nota (nada muda para o cliente). */
export async function resolveSignal(id: number, fd: FormData): Promise<ActionResult> {
  const note = text(fd.get("note")).slice(0, 200) || "revisado: segue normal";
  const s = await requireAdmin(`/admin/conformidade (resolveu o sinal ${id})`);
  const { data, error } = await createAdminClient()
    .from("compliance_checks")
    .update({ review_state: "resolved", resolved_by: s.email, resolved_at: new Date().toISOString(), resolution: note })
    .eq("id", id)
    .eq("review_state", "pending")
    .in("kind", SIGNAL_KINDS as string[])
    .select("agency_id, client_id")
    .maybeSingle();
  if (error) return fail("Não foi possível resolver. Tente de novo.");
  if (!data) return fail("Sinal não encontrado ou já resolvido.");
  await auditAdmin(s.email, "conformidade.resolver_sinal", { agencyId: data.agency_id as string, targetType: "client", targetId: (data.client_id as string | null) ?? undefined, after: { note } });
  revalidatePath("/admin", "layout");
  return ok("Sinal resolvido.");
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

/** Cria ou edita uma ação. Pedido, reserva ou cobrança (classificado pelo BoaVoz) só roda depois do Confirmar do contato. */
export async function saveAction(agencyId: string, botId: string, actionId: string | null, fd: FormData): Promise<ActionResult> {
  const s = await requireAdmin(`/admin/clientes/${agencyId}/integracoes (${actionId ? "editou" : "criou"} ação)`);
  if (!(await pilotBot(agencyId, botId))) return fail("Chatbot não encontrado nesta agência.");
  const input = actionInputFromForm(fd);
  if ("error" in input) return fail(input.error);
  const problem = actionInputProblem(input);
  if (problem) return fail(problem);
  const h = headersFromForm(fd);
  if ("error" in h) return fail(h.error);
  const db = createAdminClient();
  // efeito classificado pela IA do BoaVoz: pedido, reserva ou cobrança só depois do Confirmar do contato
  const createsOrder = await classifyCreatesOrder(db, agencyId, input);
  const row = { bot_id: botId, ...input, ...headersColumn(h.headers), creates_order: createsOrder, updated_at: new Date().toISOString() };
  const { error } = actionId ? await db.from("actions").update(row).eq("id", actionId).eq("bot_id", botId) : await db.from("actions").insert(row);
  if (error) return fail(/duplicate|unique/i.test(error.message) ? "Já existe uma ação com esse nome neste chatbot." : `Não foi possível salvar: ${error.message}`);
  await auditAdmin(s.email, actionId ? "acoes.editar" : "acoes.criar", { agencyId, targetType: "bot", targetId: botId, after: { name: input.name, url: input.url, tipo: input.type, previa: input.supports_preview, creates_order: createsOrder } });
  revalidatePath("/admin", "layout");
  return ok(actionSavedMessage(input.name, input, createsOrder));
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
  const row = action as unknown as ActionRow;
  // "executa": só com o aviso aceito (chama de verdade, com confirmed: true), ou só a prévia
  const preview = fd.get("preview") === "on" && row.supports_preview;
  if (needsConfirmation(row) && !preview && fd.get("real") !== "on") return fail("Esta ação executa de verdade: marque \"isto chama o endpoint de verdade\" (dados de teste) ou teste só a prévia.");
  const r = await callAction(db, row, preview ? { params, mode: "preview" } : { params, mode: "test", confirmed: needsConfirmation(row) });
  const head = `${r.status.toUpperCase()}${r.httpStatus ? ` · HTTP ${r.httpStatus}` : ""} · ${r.durationMs} ms · ${r.callId}`;
  const lines = [head, ...r.warnings.map((w) => `aviso: ${w}`), ...(r.error ? [`erro: ${r.error}`] : [])];
  // components fora do formato não vão para o contato: o Testar avisa onde está o problema
  if (r.components !== undefined) {
    try {
      parseComponentInput(r.components);
    } catch (e) {
      if (e instanceof ComponentProblem) lines.push(`aviso: components fora do formato (${e.field}): ${e.message}`);
    }
  }
  if (r.status === "ok" || r.status === "not_found") lines.push("", JSON.stringify({ data: r.data, internal: r.internal ?? undefined, reply: r.reply ?? undefined, attachments: r.attachments?.length ? r.attachments : undefined, outcome: r.outcome ?? undefined, confirmation: r.confirmation ?? undefined, components: r.components ?? undefined }, null, 2).slice(0, 6000));
  return r.status === "ok" || r.status === "not_found" ? ok(lines.join("\n")) : fail(lines.join("\n"));
}

/**
 * Chave da API pública para o piloto (P1: escopo por bot). Aparece uma vez só; o banco guarda o
 * hash. O dono da agência recebe o aviso (uma chave que ele não combinou é sinal de problema).
 */
export async function createPilotApiKey(agencyId: string, fd: FormData): Promise<ActionResult> {
  const s = await requireAdmin(`/admin/clientes/${agencyId}/integracoes (criou chave de API)`);
  const db = createAdminClient();
  const permissions = fd.getAll("permission").map(String);
  const scope = await scopeFromForm(db, agencyId, fd);
  if ("error" in scope) return fail(scope.error);
  const name = text(fd.get("name"));
  const problem = apiKeyProblem({ name, scope, permissions });
  if (problem) return fail(problem);
  const created = await createApiKey(db, { agencyId, name, scope, permissions: permissions.filter(isApiPermission), createdBy: s.email });
  await auditAdmin(s.email, "api.chave.criar", { agencyId, targetType: "api_key", targetId: created.id, after: { name, prefix: created.prefix, escopo: scope, permissoes: permissions } });
  await notifyAgencyOwner(db, agencyId, "Chave de API criada", [
    `A equipe BoaVoz criou a chave de API "${name}" (${created.prefix}…) na sua conta, para o piloto de Integrações.`,
    `Permissões: ${permissions.join(", ")}.`,
    "Se não foi combinado com você, fale com o suporte para revogar.",
  ]).catch(() => false);
  revalidatePath("/admin", "layout");
  return ok(`${created.key}\n\nCopie agora: ela não aparece de novo. Use no cabeçalho Authorization: Bearer <chave>.`);
}

export async function revokePilotApiKey(agencyId: string, keyId: string): Promise<ActionResult> {
  const s = await requireAdmin(`/admin/clientes/${agencyId}/integracoes (revogou a chave ${keyId})`);
  const key = await revokeApiKey(createAdminClient(), agencyId, keyId, s.email);
  if (!key) return fail("Chave não encontrada ou já revogada.");
  await auditAdmin(s.email, "api.chave.revogar", { agencyId, targetType: "api_key", targetId: keyId, after: { name: key.name, prefix: key.prefix } });
  revalidatePath("/admin", "layout");
  return ok(`Chave ${key.prefix}… revogada: a próxima requisição com ela já recebe 401.`);
}

/**
 * Segredo de identidade do piloto (P2): o servidor do SaaS assina o token do widget com ele.
 * Escopo: um chatbot, um cliente ou todos. Aparece uma vez; o dono da agência recebe o aviso.
 */
export async function createPilotIdentitySecret(agencyId: string, fd: FormData): Promise<ActionResult> {
  const s = await requireAdmin(`/admin/clientes/${agencyId}/integracoes (criou segredo de identidade)`);
  const db = createAdminClient();
  const name = text(fd.get("name"));
  if (!name || name.length > 80) return fail("Dê um nome ao segredo (até 80 caracteres), ex.: \"Fintra produção\".");
  const scopeType = text(fd.get("scope_type"));
  let scope: IdentityScope;
  if (scopeType === "all") scope = { type: "all" };
  else if (scopeType === "client") {
    const clientId = text(fd.get("client_id"));
    const { data: client } = await db.from("clients").select("id").eq("id", clientId).eq("agency_id", agencyId).maybeSingle();
    if (!client) return fail("Escolha um cliente desta agência.");
    scope = { type: "client", clientId };
  } else {
    const botId = text(fd.get("bot_id"));
    if (!(await pilotBot(agencyId, botId))) return fail("Escolha um chatbot desta agência.");
    scope = { type: "bot", botId };
  }
  const created = await createIdentitySecret(db, { agencyId, name, scope, createdBy: s.email });
  await auditAdmin(s.email, "identidade.segredo.criar", { agencyId, targetType: "identity_secret", targetId: created.id, after: { name, kid: created.kid, escopo: scope } });
  await notifyAgencyOwner(db, agencyId, "Segredo de identidade criado", [
    `A equipe BoaVoz criou o segredo de identidade "${name}" (${created.kid}) na sua conta, para o piloto de Integrações.`,
    "Com ele, o seu sistema identifica quem conversa no chat do site.",
    "Se não foi combinado com você, fale com o suporte para revogar.",
  ]).catch(() => false);
  revalidatePath("/admin", "layout");
  return ok(`${created.secret}\n\nkid: ${created.kid}\n\nCopie o segredo agora: ele não aparece de novo. O token vai assinado em HS256, com o kid no cabeçalho.`);
}

export async function revokePilotIdentitySecret(agencyId: string, id: string): Promise<ActionResult> {
  const s = await requireAdmin(`/admin/clientes/${agencyId}/integracoes (revogou o segredo de identidade ${id})`);
  const r = await revokeIdentitySecret(createAdminClient(), agencyId, id, s.email);
  if (!r) return fail("Segredo não encontrado ou já revogado.");
  await auditAdmin(s.email, "identidade.segredo.revogar", { agencyId, targetType: "identity_secret", targetId: id, after: { name: r.name, kid: r.kid } });
  revalidatePath("/admin", "layout");
  return ok(`Segredo ${r.kid} revogado: tokens assinados com ele deixam de valer na hora.`);
}

/**
 * Webhook do piloto (P2): contact.linked e contact.unlinked para o sistema do SaaS. O segredo
 * (whsec_) aparece uma vez; o dono da agência recebe o aviso (o webhook leva dados das pessoas).
 */
export async function createPilotWebhook(agencyId: string, fd: FormData): Promise<ActionResult> {
  const s = await requireAdmin(`/admin/clientes/${agencyId}/integracoes (criou webhook)`);
  const db = createAdminClient();
  const w = webhookInputFromForm(fd);
  if ("error" in w) return fail(w.error);
  const { name, url, events } = w;
  const scope = await scopeFromForm(db, agencyId, fd);
  if ("error" in scope) return fail(scope.error);
  const created = await createWebhook(db, { agencyId, name, url, events, scope, createdBy: s.email });
  await auditAdmin(s.email, "webhook.criar", { agencyId, targetType: "webhook", targetId: created.id, after: { name, url, events, escopo: scope } });
  await notifyAgencyOwner(db, agencyId, "Webhook criado", [
    `A equipe BoaVoz criou o webhook "${name}" na sua conta (${new URL(url).host}), para o piloto de Integrações.`,
    `Eventos: ${events.join(", ")}.`,
    "Se não foi combinado com você, fale com o suporte para desativar.",
  ]).catch(() => false);
  revalidatePath("/admin", "layout");
  return ok(`${created.secret}\n\nCopie o segredo agora: ele não aparece de novo. As entregas vão assinadas no padrão Standard Webhooks.`);
}

export async function setPilotWebhookActive(agencyId: string, id: string, active: boolean): Promise<ActionResult> {
  const s = await requireAdmin(`/admin/clientes/${agencyId}/integracoes (${active ? "reativou" : "desativou"} webhook ${id})`);
  const { data, error } = await createAdminClient()
    .from("webhooks")
    .update(active ? { active: true, disabled_at: null, disabled_reason: null, failing_since: null } : { active: false, disabled_at: new Date().toISOString(), disabled_reason: `desativado por ${s.email}` })
    .eq("id", id)
    .eq("agency_id", agencyId)
    .select("id");
  if (error || !data?.length) return fail("Webhook não encontrado.");
  await auditAdmin(s.email, active ? "webhook.reativar" : "webhook.desativar", { agencyId, targetType: "webhook", targetId: id });
  revalidatePath("/admin", "layout");
  return ok(active ? "Webhook reativado." : "Webhook desativado: novos eventos não são entregues nem acumulam.");
}

export async function deletePilotWebhook(agencyId: string, id: string): Promise<ActionResult> {
  const s = await requireAdmin(`/admin/clientes/${agencyId}/integracoes (apagou webhook ${id})`);
  const { data, error } = await createAdminClient().from("webhooks").delete().eq("id", id).eq("agency_id", agencyId).select("name");
  if (error || !data?.length) return fail("Webhook não encontrado.");
  await auditAdmin(s.email, "webhook.apagar", { agencyId, targetType: "webhook", targetId: id, after: { name: data[0].name } });
  revalidatePath("/admin", "layout");
  return ok("Webhook apagado (as entregas dele também).");
}

/** "Enviar teste": webhook.test com a mesma assinatura, fora das novas tentativas e da contagem para desativar. */
export async function testPilotWebhook(agencyId: string, id: string): Promise<ActionResult> {
  await requireAdmin(`/admin/clientes/${agencyId}/integracoes (testou webhook ${id})`);
  const r = await sendWebhookTest(createAdminClient(), id, agencyId);
  if (!r) return fail("Webhook não encontrado.");
  const okStatus = r.status !== null && r.status >= 200 && r.status < 300 && !r.error;
  return okStatus ? ok(`Entregue: HTTP ${r.status}.`) : fail(`Não entregue: ${r.error ?? `HTTP ${r.status}`}.`);
}

/** Recifra do histórico agora (até ~45 s); o resto segue na rotina diária. */
/**
 * Limpeza por prazo agora (na dev a rotina diária não roda sozinha): soma os totais diários, promove
 * os prazos vencidos, agenda o padrão de quem estava em "Não apagar" (com e-mail) e apaga o que
 * passou do prazo de cada chatbot.
 */
export async function runRetentionNow(): Promise<ActionResult> {
  const s = await requireAdmin("/admin/operacao (rodou a limpeza por prazo)");
  const { deadline } = await import("@/lib/cron");
  const { refreshReportDaily } = await import("@/lib/report-daily");
  const { applyRetentionTerms } = await import("@/lib/retention");
  const db = createAdminClient();
  const hasTime = deadline(50_000);
  await refreshReportDaily(db, hasTime);
  const r = await applyRetentionTerms(db, hasTime);
  // arquivos sem conversa (chatbot ou cliente excluído) e vencidos
  const { sweepAttachments } = await import("@/lib/attachments");
  const orphans = await sweepAttachments(db, hasTime);
  await auditAdmin(s.email, "retencao.rodar", { after: { ...r, arquivos_sem_conversa: orphans } });
  revalidatePath("/admin/operacao");
  if (r.skipped) return fail(`Limpeza parada: ${r.skipped}. Arquivos sem conversa removidos: ${orphans}.`);
  return ok(`Limpeza feita: ${r.conversations} conversa(s), ${r.files + orphans} arquivo(s) (modo sensível e sem conversa), ${r.leads} lead(s), ${r.unanswered} pergunta(s), ${r.refusals} pedido(s) fora do assunto e ${r.contacts} contato(s) apagados; ${r.promoted} prazo(s) promovido(s) e ${r.scheduled} agência(s) avisada(s) do prazo padrão.`);
}

/** Totais diários (report_daily): recalcula agora o que falta (na dev a rotina diária não roda sozinha). */
export async function runReportDailyNow(): Promise<ActionResult> {
  const s = await requireAdmin("/admin/operacao (recalculou os totais diários)");
  const { deadline } = await import("@/lib/cron");
  const { refreshReportDaily } = await import("@/lib/report-daily");
  const r = await refreshReportDaily(createAdminClient(), deadline(45_000));
  await auditAdmin(s.email, "relatorio.totais_diarios", { after: r });
  revalidatePath("/admin/operacao");
  const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("pt-BR");
  if ("nothing" in r) return ok(`Nada a recalcular: os totais já vão até ${r.through ? day(r.through) : "ontem"}.`);
  return ok(`Totais recalculados de ${day(r.from)} a ${day(r.through ?? r.to)} (${r.rows} linha${r.rows === 1 ? "" : "s"}).${r.through && r.through < r.to ? " Faltou tempo para o resto: clique de novo." : ""}`);
}

export async function runReencryptNow(): Promise<ActionResult> {
  const s = await requireAdmin("/admin/operacao (recifrou o histórico)");
  const { deadline } = await import("@/lib/cron");
  const { reencryptHistory } = await import("@/lib/reencrypt");
  const done = await reencryptHistory(createAdminClient(), deadline(45_000), 200);
  const total = Object.values(done).reduce((a, b) => a + b, 0);
  await auditAdmin(s.email, "cifra.recifrar", { after: done });
  revalidatePath("/admin/operacao");
  return ok(total ? `Cifradas agora: ${Object.entries(done).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(" · ")}.` : "Nada a cifrar: o histórico já está todo cifrado.");
}

/* ------------------------------------------------------------------ campanhas (B3): teste pelo backoffice até a tela da parte 4 */

/** No teste, até tantos números de uma vez. */
const TEST_CAMPAIGN_MAX = 50;

/**
 * Campanha de teste: um modelo aprovado, as mesmas variáveis para todos e os números, um por linha.
 * Passa pelas mesmas conferências da campanha de verdade (SAIR, aceite de novidades no marketing,
 * 18+ quando marcada como bebida ou remédio). Sem data, sai no próximo tique (ou no "Rodar agora").
 */
export async function createTestCampaign(agencyId: string, fd: FormData): Promise<ActionResult> {
  const botId = text(fd.get("bot"));
  const s = await requireAdmin(`/admin/clientes/${agencyId}/campanhas (campanha de teste no bot ${botId})`);
  const db = createAdminClient();
  const { data: bot } = await db.from("bots").select("id, agency_id, client_id, is_demo").eq("id", botId).eq("agency_id", agencyId).maybeSingle();
  if (!bot || bot.is_demo) return fail("Chatbot não encontrado nesta agência.");
  const { listTemplates, loadTemplateChannel, templateBody, templateVariables } = await import("@/lib/whatsapp-templates");
  const ch = await loadTemplateChannel(db, botId);
  if (!ch) return fail("Este chatbot não tem WhatsApp conectado.");
  const name = text(fd.get("template"));
  let template;
  try {
    template = (await listTemplates(ch)).find((t) => t.name === name);
  } catch (e) {
    return fail(`A Meta não listou os modelos: ${(e as Error).message}`);
  }
  const kind = template?.category.toUpperCase() === "MARKETING" ? "marketing" : "utility_reminder";
  const problem = templateProblem(kind, template ?? null);
  if (problem || !template) return fail(`Não dá para usar este modelo: ${problem}.`);
  const vars = templateVariables(templateBody(template)).length;
  const variables = String(fd.get("variables") ?? "").split(/\r?\n/).map((v) => v.trim()).filter(Boolean);
  if (variables.length < vars) return fail(`O modelo tem ${vars} variáve${vars === 1 ? "l" : "is"}: escreva ${vars === 1 ? "o valor" : "um valor por linha"}.`);
  const phones = [...new Set(String(fd.get("phones") ?? "").split(/[\n,;]+/).map((p) => canonicalPhone(p, { typed: true })).filter((p): p is string => Boolean(p)))];
  if (!phones.length) return fail("Informe ao menos um WhatsApp com DDD, um por linha.");
  if (phones.length > TEST_CAMPAIGN_MAX) return fail(`No teste, até ${TEST_CAMPAIGN_MAX} números.`);
  const scheduledRaw = text(fd.get("scheduled_at"));
  const scheduled = scheduledRaw ? new Date(`${scheduledRaw}:00-03:00`) : null;
  if (scheduled && Number.isNaN(scheduled.getTime())) return fail("Data de envio inválida.");

  const recipients = [];
  for (const [i, phone] of phones.entries()) {
    const contact = await whatsappContact(db, { id: botId, agency_id: agencyId }, { phone });
    // marketing é por contato; o lembrete é por linha (a mesma pessoa pode ter dois lembretes)
    recipients.push({ contactId: contact?.id ?? null, phone, dedupeKey: kind === "marketing" && contact ? `c:${contact.id}` : `l:${i + 1}`, variables: variables.slice(0, vars) });
  }
  const campaignName = text(fd.get("name")).slice(0, 120) || `Teste ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`;
  // estimativa: no marketing é o teto (quem não aceitou novidades fica de fora no envio)
  const estimate = await estimateFor(db, ch, botId, recipients.length, template.category);
  try {
    const r = await createCampaign(db, {
      agencyId,
      clientId: (bot.client_id as string | null) ?? null,
      botId,
      kind,
      name: campaignName,
      template: { name: template.name, language: template.language, category: template.category },
      regulated: fd.get("regulated") === "on",
      audience: { teste_backoffice: true },
      scheduledAt: scheduled?.toISOString() ?? null,
      createdBy: `suporte:${s.email}`,
      recipients,
      estimatedCostBrl: estimate.costBrl,
    });
    await auditAdmin(s.email, "campanha.criar", { agencyId, targetType: "bot", targetId: botId, after: { campanha: r.id, modelo: template.name, tipo: kind, envios: r.queued, teste: true } });
    revalidatePath(`/admin/clientes/${agencyId}/campanhas`);
    const pace = estimate.days > 1 ? ` Pelo limite de ${estimate.limit.toLocaleString("pt-BR")} contatos por 24 h, este envio leva ${estimate.days} dias.` : "";
    return ok(`Campanha criada com ${r.queued} envio(s) (${kind === "marketing" ? "marketing: só sai para quem aceitou novidades" : "lembrete de utilidade"}). Custo estimado na Meta: ${costText(estimate.costBrl)}, cobrado da conta do cliente.${pace} ${scheduled && scheduled.getTime() > Date.now() ? `Agendada para ${scheduled.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.` : "Sai no próximo tique, ou clique em Rodar agora."}`);
  } catch (e) {
    return fail(`A campanha não foi criada: ${(e as Error).message}`);
  }
}

/** Roda um tique agora (o mesmo do pg_cron, com a mesma trava). */
export async function runCampaignsNow(agencyId: string): Promise<ActionResult> {
  const s = await requireAdmin(`/admin/clientes/${agencyId}/campanhas (rodou o tique das campanhas)`);
  const db = createAdminClient();
  try {
    const r = await withCronLock(db, "campanhas", 90, () => runCampaignTick(db, { hasTime: deadline(40_000) }));
    if (!("campaigns" in r)) return fail("Outro tique está rodando agora. Espere alguns segundos e clique de novo.");
    await auditAdmin(s.email, "campanha.rodar", { after: { ...r } });
    revalidatePath(`/admin/clientes/${agencyId}/campanhas`);
    return ok(`Tique: ${r.campaigns} campanha(s) · ${r.sent} enviada(s) · ${r.skipped} pulada(s) pelas conferências · ${r.failed} com erro · ${r.uncertain} incerta(s) · ${r.finished} terminada(s)${r.paused ? ` · ${r.paused} pausada(s)` : ""}.`);
  } catch (e) {
    return fail(`O tique falhou: ${(e as Error).message}`);
  }
}

/** Pausar, retomar ou cancelar uma campanha da agência. */
export async function changeCampaignStatus(agencyId: string, campaignId: string, status: "paused" | "sending" | "canceled"): Promise<ActionResult> {
  const s = await requireAdmin(`/admin/clientes/${agencyId}/campanhas (campanha ${campaignId}: ${status})`);
  const db = createAdminClient();
  const { data: c } = await db.from("campaigns").select("id").eq("id", campaignId).eq("agency_id", agencyId).maybeSingle();
  if (!c) return fail("Campanha não encontrada nesta agência.");
  if (!(await setCampaignStatus(db, campaignId, status, status === "paused" ? "pausada pela equipe BoaVoz" : null))) return fail("A campanha já não está nesse ponto. Recarregue a página.");
  const action = { paused: "campanha.pausar", sending: "campanha.retomar", canceled: "campanha.cancelar" }[status];
  await auditAdmin(s.email, action, { agencyId, targetType: "campaign", targetId: campaignId });
  revalidatePath(`/admin/clientes/${agencyId}/campanhas`);
  return ok({ paused: "Campanha pausada.", sending: "Campanha retomada: sai no próximo tique.", canceled: "Campanha cancelada: o que faltava não sai mais." }[status]);
}

/**
 * Crédito do excedente dado pela BoaVoz (cortesia, compensação de falha): um lote de "ajuste"
 * válido por 12 meses, com o motivo na auditoria. Não passa pela Stripe.
 */
export async function grantCredit(agencyId: string, fd: FormData): Promise<ActionResult> {
  const reais = Number(text(fd.get("amount")).replace(/\D/g, "") || "0");
  const reason = text(fd.get("reason"));
  if (!Number.isSafeInteger(reais) || reais < 1 || reais > 10_000) return fail("Informe de R$ 1 a R$ 10.000, em reais inteiros.");
  if (reason.length < 3) return fail("Escreva o motivo (fica na auditoria).");
  const s = await requireAdmin(`/admin/clientes/${agencyId} (crédito do excedente)`);
  const db = createAdminClient();
  const expires = new Date();
  expires.setMonth(expires.getMonth() + 12);
  const { error } = await db.from("credit_lots").insert({ agency_id: agencyId, amount_cents: reais * 100, remaining_cents: reais * 100, source: "ajuste", expires_at: expires.toISOString() });
  if (error) return fail("Não foi possível dar o crédito. Tente de novo.");
  await auditAdmin(s.email, "credito.ajuste", { agencyId, targetType: "agency", targetId: agencyId, after: { valor_reais: reais, motivo: reason.slice(0, 200) } });
  revalidatePath("/admin", "layout");
  return ok(`Crédito de R$ ${reais.toLocaleString("pt-BR")} dado à agência (vale 12 meses).`);
}

/** Confere agora a caixa de entrada grátis da agência (a tarefa diária faz para todas). */
export async function checkFreeInbox(agencyId: string): Promise<ActionResult> {
  const s = await requireAdmin(`/admin/clientes/${agencyId} (caixa de entrada grátis)`);
  const r = await retireUnsizedChannels(createAdminClient(), { agencyId });
  await auditAdmin(s.email, "caixa_gratis.conferir", { agencyId, targetType: "agency", targetId: agencyId, after: r });
  revalidatePath("/admin", "layout");
  return ok(r.warned || r.disconnected ? `${r.warned} chatbot(s) entraram no prazo de 30 dias; ${r.disconnected} desconectado(s).` : "Nada a fazer: só a caixa de entrada grátis está sem tamanho com canal.");
}
