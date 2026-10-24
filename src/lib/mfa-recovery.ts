import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { audit } from "./audit";
import { agencyBaseUrl } from "./domain";
import { notifyPlatform, sendAsAgency } from "./notify";
import { appUrl } from "./utils";

/*
 * Recuperação do segundo fator pelo suporte (itens menores da conferência de 20/10, parte 4; spec,
 * Segurança). Quem perdeu o app autenticador pede na tela de verificação (painel ou área do
 * cliente). O pedido só vale depois do link do e-mail (24 horas para confirmar); confirmado, o
 * suporte só consegue remover o fator 48 horas depois, no backoffice. Nesse meio tempo, o dono da
 * agência fica sabendo (alerta de segurança: e-mail e faixa), o "Não fui eu" do e-mail cancela e
 * o código do app usado de novo também (quem tem o app não precisa da recuperação). Cada passo
 * fica na auditoria da agência. Na área do cliente, os e-mails e as páginas saem com o nome da
 * agência (white-label).
 */

export const RECOVERY_CONFIRM_HOURS = 24;
export const RECOVERY_WAIT_HOURS = 48;
const HOUR = 3_600_000;
const OPEN = ["pendente", "confirmado"];

export type RecoveryArea = "painel" | "cliente";
export type RecoveryStatus = "pendente" | "confirmado" | "feito" | "cancelado" | "recusado" | "vencido";

export const RECOVERY_STATUS_LABEL: Record<RecoveryStatus, string> = {
  pendente: "esperando a confirmação pelo e-mail",
  confirmado: "confirmado, na espera de 48 horas",
  feito: "fator removido",
  cancelado: "cancelado",
  recusado: "recusado pelo suporte",
  vencido: "vencido sem confirmação",
};

export const recoveryTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

/** Os fatores da pessoa no Supabase (injetável nos testes). */
export interface FactorOps {
  list(userId: string): Promise<Array<{ id: string; status: string }>>;
  remove(userId: string, factorId: string): Promise<void>;
}

export function supabaseFactorOps(db: SupabaseClient): FactorOps {
  return {
    async list(userId) {
      const { data, error } = await db.auth.admin.mfa.listFactors({ userId });
      if (error) throw error;
      return (data?.factors ?? []).map((f) => ({ id: f.id, status: f.status }));
    },
    async remove(userId, factorId) {
      const { error } = await db.auth.admin.mfa.deleteFactor({ id: factorId, userId });
      if (error) throw error;
    },
  };
}

const when = (d: Date | string) => new Date(d).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

interface AgencyBrand {
  name: string;
  custom_domain: string | null;
  custom_domain_verified_at: string | null;
}

/** O link do e-mail: no painel, o endereço do BoaVoz; na área do cliente, o domínio da agência. Pura. */
export function recoveryLink(area: RecoveryArea, token: string, agency: Pick<AgencyBrand, "custom_domain" | "custom_domain_verified_at">): string {
  return area === "cliente" ? `${agencyBaseUrl(agency)}/cliente/segundo-fator/${token}` : appUrl(`/segundo-fator/${token}`);
}

/** Quem assina e quem é "o suporte" em cada área (white-label na área do cliente). Pura. */
const voice = (area: RecoveryArea, agencyName: string) => (area === "cliente" ? { from: agencyName, support: `a equipe de ${agencyName}`, sign: `Equipe ${agencyName}` } : { from: "BoaVoz", support: "o suporte do BoaVoz", sign: "Equipe BoaVoz" });

/** O e-mail do pedido, com o link para confirmar (ou cancelar). Pura. */
export function recoveryRequestEmail(o: { area: RecoveryArea; agencyName: string; link: string }): [string, string[]] {
  const v = voice(o.area, o.agencyName);
  return [
    "Confirme o pedido para recuperar o segundo fator",
    [
      "Recebemos um pedido para remover o app autenticador (segundo fator) da sua conta, porque ele foi perdido.",
      "",
      `Para seguir, confirme em até ${RECOVERY_CONFIRM_HOURS} horas: ${o.link}`,
      "",
      `Depois da confirmação, por segurança, ${v.support} só remove o app ${RECOVERY_WAIT_HOURS} horas depois. Aí, no próximo acesso a uma área protegida, você cadastra um app novo.`,
      "",
      "Não foi você? Abra o mesmo link e cancele o pedido. Sem a confirmação, nada muda.",
      "",
      v.sign,
    ],
  ];
}

/** O e-mail da confirmação, com a data a partir da qual o suporte remove. Pura. */
export function recoveryConfirmedEmail(o: { area: RecoveryArea; agencyName: string; link: string; availableAt: Date }): [string, string[]] {
  const v = voice(o.area, o.agencyName);
  return [
    "Pedido de recuperação do segundo fator confirmado",
    [
      `Pedido confirmado. A partir de ${when(o.availableAt)}, ${v.support} remove o app autenticador da sua conta e você recebe um e-mail.`,
      "",
      "Encontrou o app ou o celular antigo? Basta usar o código dele de novo: o pedido é cancelado sozinho.",
      "",
      `Não foi você? Cancele agora: ${o.link}`,
      "",
      v.sign,
    ],
  ];
}

/** O e-mail depois da remoção pelo suporte. Pura. */
export function recoveryDoneEmail(o: { area: RecoveryArea; agencyName: string }): [string, string[]] {
  const v = voice(o.area, o.agencyName);
  return [
    "O app autenticador foi removido da sua conta",
    [
      `${v.support[0].toUpperCase()}${v.support.slice(1)} removeu o app autenticador (segundo fator) da sua conta, como você pediu.`,
      "",
      "No próximo acesso a uma área protegida, cadastre um app novo (Google Authenticator, Authy ou outro).",
      "",
      "Não foi você que pediu? Responda este e-mail agora.",
      "",
      v.sign,
    ],
  ];
}

/** O e-mail da recusa, com o motivo. Pura. */
export function recoveryRefusedEmail(o: { area: RecoveryArea; agencyName: string; note: string }): [string, string[]] {
  const v = voice(o.area, o.agencyName);
  return [
    "O pedido de recuperação do segundo fator não foi atendido",
    [`${v.support[0].toUpperCase()}${v.support.slice(1)} não atendeu o pedido para remover o app autenticador da sua conta.`, "", `Motivo: ${o.note}`, "", "Para continuar, responda este e-mail.", "", v.sign],
  ];
}

async function brandOf(db: SupabaseClient, agencyId: string): Promise<AgencyBrand> {
  const { data } = await db.from("agencies").select("name, custom_domain, custom_domain_verified_at").eq("id", agencyId).maybeSingle();
  return { name: (data?.name as string | undefined) ?? "BoaVoz", custom_domain: (data?.custom_domain as string | null | undefined) ?? null, custom_domain_verified_at: (data?.custom_domain_verified_at as string | null | undefined) ?? null };
}

const actorOf = (r: { area: RecoveryArea; user_id: string; email: string }) => (r.area === "cliente" ? { actorType: "member" as const, actorId: r.email } : { actorType: "user" as const, actorId: r.user_id });

/** O pedido sem confirmação que passou das 24 horas vira "vencido" (de uma pessoa, ou todos). */
export async function expireStaleRecoveries(db: SupabaseClient, now = new Date(), userId?: string): Promise<number> {
  let q = db
    .from("mfa_recovery_requests")
    .update({ status: "vencido", closed_at: now.toISOString() })
    .eq("status", "pendente")
    .lt("created_at", new Date(now.getTime() - RECOVERY_CONFIRM_HOURS * HOUR).toISOString());
  if (userId) q = q.eq("user_id", userId);
  const { data } = await q.select("id");
  return data?.length ?? 0;
}

export interface RecoveryRequester {
  userId: string;
  email: string;
  area: RecoveryArea;
  agencyId: string;
  clientId?: string | null;
}

export type RecoveryRequestResult = { ok: true } | { ok: false; problem: "sem_fator" | "aberto" | "erro" };

/** O texto de cada recusa do pedido (painel e área do cliente). */
export const RECOVERY_PROBLEM: Record<"sem_fator" | "aberto" | "erro", string> = {
  sem_fator: "Sua conta não tem app autenticador cadastrado: volte e cadastre um na verificação.",
  aberto: "Você já tem um pedido em aberto. Confira o seu e-mail (e a caixa de spam).",
  erro: "Não foi possível registrar o pedido. Tente de novo em alguns minutos.",
};

/** O pedido: só para quem tem o app cadastrado, um em aberto por pessoa; manda o link de confirmação. */
export async function requestRecovery(db: SupabaseClient, r: RecoveryRequester, o: { reason?: string | null; factors?: FactorOps; ip?: string | null; userAgent?: string | null; now?: Date } = {}): Promise<RecoveryRequestResult> {
  const now = o.now ?? new Date();
  const factors = o.factors ?? supabaseFactorOps(db);
  const list = await factors.list(r.userId).catch(() => null);
  if (!list) return { ok: false, problem: "erro" };
  if (!list.some((f) => f.status === "verified")) return { ok: false, problem: "sem_fator" };
  await expireStaleRecoveries(db, now, r.userId);
  const { data: open } = await db.from("mfa_recovery_requests").select("id").eq("user_id", r.userId).in("status", OPEN).limit(1);
  if (open?.length) return { ok: false, problem: "aberto" };
  const token = randomBytes(24).toString("base64url");
  const reason = o.reason?.replace(/\s+/g, " ").trim().slice(0, 500) || null;
  const { error } = await db.from("mfa_recovery_requests").insert({ user_id: r.userId, email: r.email.toLowerCase(), area: r.area, agency_id: r.agencyId, client_id: r.clientId ?? null, reason, token_hash: recoveryTokenHash(token), status: "pendente", created_at: now.toISOString() });
  // o índice único dos pedidos em aberto segura dois cliques ao mesmo tempo
  if (error) return { ok: false, problem: error.code === "23505" ? "aberto" : "erro" };
  const brand = await brandOf(db, r.agencyId);
  const link = recoveryLink(r.area, token, brand);
  const [subject, lines] = recoveryRequestEmail({ area: r.area, agencyName: brand.name, link });
  await sendAsAgency(voice(r.area, brand.name).from, r.email, subject, lines).catch(() => false);
  // sem a Resend (a dev), o e-mail não sai: o link vai para o log do servidor, para o teste; com a chave (a produção), nunca
  if (!process.env.RESEND_API_KEY) console.warn(`[segundo fator] sem a Resend: o link de confirmação de ${r.email} é ${link}`);
  await audit(db, { agencyId: r.agencyId, ...actorOf({ area: r.area, user_id: r.userId, email: r.email }), action: "seguranca.mfa_recuperar_pedir", targetType: r.area === "cliente" ? "client" : "agency", targetId: r.clientId ?? r.agencyId, after: { area: r.area }, ip: o.ip ?? null, userAgent: o.userAgent ?? null });
  return { ok: true };
}

interface RecoveryRow {
  id: string;
  user_id: string;
  email: string;
  area: RecoveryArea;
  agency_id: string;
  client_id: string | null;
  status: RecoveryStatus;
  created_at: string;
  confirmed_at: string | null;
  available_at: string | null;
}

const ROW_COLS = "id, user_id, email, area, agency_id, client_id, status, created_at, confirmed_at, available_at";

/** O pedido em vigor: o pendente que passou das 24 horas conta como vencido. Pura. */
export function effectiveStatus(r: Pick<RecoveryRow, "status" | "created_at">, now = new Date()): RecoveryStatus {
  return r.status === "pendente" && new Date(r.created_at).getTime() < now.getTime() - RECOVERY_CONFIRM_HOURS * HOUR ? "vencido" : r.status;
}

/** O suporte já pode remover? Só o confirmado, depois das 48 horas. Pura. */
export const recoveryReady = (r: Pick<RecoveryRow, "status" | "available_at">, now = new Date()) => r.status === "confirmado" && !!r.available_at && new Date(r.available_at).getTime() <= now.getTime();

export interface RecoveryView {
  status: RecoveryStatus;
  area: RecoveryArea;
  agencyName: string;
  availableAt: string | null;
}

/** A página do link do e-mail: o estado do pedido, sem o e-mail nem o motivo. */
export async function loadRecovery(db: SupabaseClient, token: string, now = new Date()): Promise<RecoveryView | null> {
  if (!/^[\w-]{20,100}$/.test(token)) return null;
  const { data } = await db.from("mfa_recovery_requests").select(ROW_COLS).eq("token_hash", recoveryTokenHash(token)).maybeSingle();
  if (!data) return null;
  const r = data as RecoveryRow;
  return { status: effectiveStatus(r, now), area: r.area, agencyName: (await brandOf(db, r.agency_id)).name, availableAt: r.available_at ?? null };
}

async function rowByToken(db: SupabaseClient, token: string): Promise<RecoveryRow | null> {
  if (!/^[\w-]{20,100}$/.test(token)) return null;
  const { data } = await db.from("mfa_recovery_requests").select(ROW_COLS).eq("token_hash", recoveryTokenHash(token)).maybeSingle();
  return (data as RecoveryRow | null) ?? null;
}

export type RecoveryStepResult = { ok: true; availableAt?: string } | { ok: false; problem: "nao_encontrado" | "vencido" | "fechado" };

/** "Confirmar" no link do e-mail: começa a espera de 48 horas; o dono e o suporte ficam sabendo. */
export async function confirmRecovery(db: SupabaseClient, token: string, o: { ip?: string | null; userAgent?: string | null; now?: Date } = {}): Promise<RecoveryStepResult> {
  const now = o.now ?? new Date();
  const r = await rowByToken(db, token);
  if (!r) return { ok: false, problem: "nao_encontrado" };
  const status = effectiveStatus(r, now);
  if (status === "vencido") {
    if (r.status === "pendente") await expireStaleRecoveries(db, now, r.user_id);
    return { ok: false, problem: "vencido" };
  }
  if (status !== "pendente") return { ok: false, problem: "fechado" };
  const availableAt = new Date(now.getTime() + RECOVERY_WAIT_HOURS * HOUR);
  const { data } = await db.from("mfa_recovery_requests").update({ status: "confirmado", confirmed_at: now.toISOString(), available_at: availableAt.toISOString() }).eq("id", r.id).eq("status", "pendente").select("id");
  if (!data?.length) return { ok: false, problem: "fechado" };
  const brand = await brandOf(db, r.agency_id);
  const [subject, lines] = recoveryConfirmedEmail({ area: r.area, agencyName: brand.name, link: recoveryLink(r.area, token, brand), availableAt });
  await sendAsAgency(voice(r.area, brand.name).from, r.email, subject, lines).catch(() => false);
  // alerta de segurança: o dono recebe o e-mail e a faixa aparece no painel
  await audit(db, { agencyId: r.agency_id, ...actorOf(r), action: "seguranca.mfa_recuperar_confirmar", targetType: r.area === "cliente" ? "client" : "agency", targetId: r.client_id ?? r.agency_id, after: { area: r.area, disponivel_em: availableAt.toISOString() }, ip: o.ip ?? null, userAgent: o.userAgent ?? null });
  await notifyPlatform("Recuperação do segundo fator confirmada", [
    `${r.email} (${r.area === "cliente" ? "área do cliente" : "painel"} da agência ${brand.name}) confirmou o pedido para remover o app autenticador.`,
    `O fator pode ser removido a partir de ${when(availableAt)}. Antes disso, confira com a agência se o pedido é dela.`,
    appUrl("/admin/segundo-fator"),
  ]).catch(() => false);
  return { ok: true, availableAt: availableAt.toISOString() };
}

/** "Não fui eu" no link do e-mail: cancela o pedido em aberto. */
export async function cancelRecovery(db: SupabaseClient, token: string, o: { ip?: string | null; userAgent?: string | null; now?: Date } = {}): Promise<RecoveryStepResult> {
  const now = o.now ?? new Date();
  const r = await rowByToken(db, token);
  if (!r) return { ok: false, problem: "nao_encontrado" };
  if (!OPEN.includes(r.status)) return { ok: false, problem: "fechado" };
  const { data } = await db.from("mfa_recovery_requests").update({ status: "cancelado", closed_at: now.toISOString(), closed_by: "pessoa (link do e-mail)" }).eq("id", r.id).in("status", OPEN).select("id");
  if (!data?.length) return { ok: false, problem: "fechado" };
  await audit(db, { agencyId: r.agency_id, ...actorOf(r), action: "seguranca.mfa_recuperar_cancelar", targetType: r.area === "cliente" ? "client" : "agency", targetId: r.client_id ?? r.agency_id, after: { por: "link do e-mail" }, ip: o.ip ?? null, userAgent: o.userAgent ?? null });
  return { ok: true };
}

/** O código do app funcionou: quem tem o app não precisa da recuperação (o pedido em aberto cai). */
export async function cancelOnVerified(db: SupabaseClient, userId: string, now = new Date()): Promise<number> {
  const { data } = await db.from("mfa_recovery_requests").update({ status: "cancelado", closed_at: now.toISOString(), closed_by: "código do app usado" }).eq("user_id", userId).in("status", OPEN).select("id, area, email, agency_id, client_id");
  for (const r of (data ?? []) as Array<Pick<RecoveryRow, "id" | "area" | "email" | "agency_id" | "client_id">>) {
    await audit(db, { agencyId: r.agency_id, ...actorOf({ area: r.area, user_id: userId, email: r.email }), action: "seguranca.mfa_recuperar_cancelar", targetType: r.area === "cliente" ? "client" : "agency", targetId: r.client_id ?? r.agency_id, after: { por: "código do app usado" } });
  }
  return data?.length ?? 0;
}

export type SupportResult = { ok: true; removed?: number } | { ok: false; problem: "nao_encontrado" | "espera" | "fechado" | "erro" | "conferencia" };

/** A conferência fora do e-mail, como o suporte escreveu (pelo menos 10 letras). Pura. */
export function outOfBandCheck(raw: string | null | undefined): string | null {
  const clean = (raw ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  return clean.length >= 10 ? clean : null;
}

/**
 * Backoffice: remove os fatores da pessoa (só o pedido confirmado, depois das 48 horas). O e-mail
 * sozinho não basta (quem domina a caixa confirma e apaga os avisos): o suporte confere a pessoa
 * por outro canal (o WhatsApp do dono da agência, outro administrador da conta) e escreve como
 * conferiu, que fica no pedido e na auditoria (relatório de segurança de 23/10/2026, M12).
 */
export async function supportRemoveFactors(db: SupabaseClient, id: string, by: string, o: { check: string; factors?: FactorOps; now?: Date }): Promise<SupportResult> {
  const check = outOfBandCheck(o.check);
  if (!check) return { ok: false, problem: "conferencia" };
  const now = o.now ?? new Date();
  const factors = o.factors ?? supabaseFactorOps(db);
  const { data } = await db.from("mfa_recovery_requests").select(ROW_COLS).eq("id", id).maybeSingle();
  const r = data as RecoveryRow | null;
  if (!r) return { ok: false, problem: "nao_encontrado" };
  if (r.status !== "confirmado") return { ok: false, problem: "fechado" };
  if (!recoveryReady(r, now)) return { ok: false, problem: "espera" };
  let removed = 0;
  try {
    for (const f of await factors.list(r.user_id)) {
      await factors.remove(r.user_id, f.id);
      removed++;
    }
  } catch (e) {
    console.error("recuperação do segundo fator: remoção falhou", id, (e as Error).message);
    return { ok: false, problem: "erro" };
  }
  const { data: done } = await db.from("mfa_recovery_requests").update({ status: "feito", closed_at: now.toISOString(), closed_by: by, close_note: `Conferido fora do e-mail: ${check}` }).eq("id", id).eq("status", "confirmado").select("id");
  if (!done?.length) return { ok: false, problem: "fechado" };
  await audit(db, { agencyId: r.agency_id, actorType: "support", actorId: by, action: "seguranca.mfa_remover_suporte", targetType: "user", targetId: r.user_id, after: { area: r.area, email: r.email, conferencia: check, fatores: removed } });
  const brand = await brandOf(db, r.agency_id);
  const [subject, lines] = recoveryDoneEmail({ area: r.area, agencyName: brand.name });
  await sendAsAgency(voice(r.area, brand.name).from, r.email, subject, lines).catch(() => false);
  return { ok: true, removed };
}

/** Backoffice: recusa o pedido em aberto, com o motivo (vai no e-mail à pessoa). */
export async function supportRefuseRecovery(db: SupabaseClient, id: string, by: string, note: string, now = new Date()): Promise<SupportResult> {
  const clean = note.replace(/\s+/g, " ").trim().slice(0, 300);
  const { data } = await db.from("mfa_recovery_requests").update({ status: "recusado", closed_at: now.toISOString(), closed_by: by, close_note: clean }).eq("id", id).in("status", OPEN).select(ROW_COLS);
  const r = (data?.[0] as RecoveryRow | undefined) ?? null;
  if (!r) return { ok: false, problem: "fechado" };
  await audit(db, { agencyId: r.agency_id, actorType: "support", actorId: by, action: "seguranca.mfa_recuperar_recusar", targetType: "user", targetId: r.user_id, after: { area: r.area, motivo: clean } });
  const brand = await brandOf(db, r.agency_id);
  const [subject, lines] = recoveryRefusedEmail({ area: r.area, agencyName: brand.name, note: clean });
  await sendAsAgency(voice(r.area, brand.name).from, r.email, subject, lines).catch(() => false);
  return { ok: true };
}

/** O pedido em aberto da pessoa (a tela do pedido mostra em vez do formulário). */
export async function openRecoveryOf(db: SupabaseClient, userId: string, now = new Date()): Promise<{ status: "pendente" | "confirmado"; createdAt: string; availableAt: string | null } | null> {
  const { data } = await db.from("mfa_recovery_requests").select("status, created_at, available_at").eq("user_id", userId).in("status", OPEN).limit(1);
  const r = data?.[0] as { status: "pendente" | "confirmado"; created_at: string; available_at: string | null } | undefined;
  if (!r || effectiveStatus(r, now) === "vencido") return null;
  return { status: r.status, createdAt: r.created_at, availableAt: r.available_at };
}

/** Backoffice (visão geral): os pedidos em aberto e os prontos para remover. */
export async function openRecoveryCounts(db: SupabaseClient, now = new Date()): Promise<{ open: number; ready: number }> {
  const { data } = await db.from("mfa_recovery_requests").select("status, created_at, available_at").in("status", OPEN).limit(500);
  const rows = ((data ?? []) as Array<Pick<RecoveryRow, "status" | "created_at" | "available_at">>).filter((r) => effectiveStatus(r, now) !== "vencido");
  return { open: rows.length, ready: rows.filter((r) => recoveryReady(r, now)).length };
}

/** Tarefa diária: os pendentes de mais de 24 horas vencem; os fechados saem depois de 1 ano. */
export async function sweepMfaRecoveries(db: SupabaseClient, now = new Date()): Promise<{ vencidos: number; apagados: number }> {
  const vencidos = await expireStaleRecoveries(db, now);
  const { count } = await db
    .from("mfa_recovery_requests")
    .delete({ count: "exact" })
    .in("status", ["feito", "cancelado", "recusado", "vencido"])
    .lt("created_at", new Date(now.getTime() - 365 * 86_400_000).toISOString());
  return { vencidos, apagados: count ?? 0 };
}
