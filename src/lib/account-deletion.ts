import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { stripe } from "./stripe";
import { logDeletion } from "./deletions";
import { purgeAttachments } from "./attachments";
import { removeBotSourceFiles } from "./source-files";
import { disconnectInstagramChannel, disconnectWhatsAppChannel } from "./channel-disconnect";
import { notifyAgencyOwner } from "./notify";
import { audit } from "./audit";
import { company } from "./company";
import { appUrl } from "./utils";
import { dateBR } from "./retention";

/*
 * Exclusão da conta pelo dono (Lançamento, parte 1, 19/10/2026; spec: "exclusão da conta pelo
 * dono, com 7 dias para desistir"). O pedido marca a data e para a renovação da assinatura; até
 * lá tudo funciona, com a faixa no painel, e o dono pode desistir. Na data, o cron diário:
 * desconecta os canais (o app sai das contas da Meta), cancela a assinatura, registra o que sai
 * (para valer de novo se um backup voltar), apaga os arquivos, a agência (o resto vai em cascata)
 * e as contas da equipe. A auditoria e os registros de acesso ficam, nos prazos de sempre. Cada
 * passo pode rodar de novo: se o cron cair no meio, termina no dia seguinte.
 */

export const ACCOUNT_DELETION_DAYS = 7;

/** O que muda por fora do banco (substituível nos testes). */
export interface DeletionDeps {
  stripe: Pick<Stripe, "subscriptions"> | null;
  disconnectWhatsApp: (db: SupabaseClient, botId: string) => Promise<unknown>;
  disconnectInstagram: (db: SupabaseClient, botId: string) => Promise<unknown>;
  purgeBotFiles: (db: SupabaseClient, botId: string) => Promise<void>;
  /** Apaga os arquivos de uma pasta do bucket de logos (o logo da agência e as fotos da equipe). */
  removeLogoFolder: (db: SupabaseClient, folder: string) => Promise<void>;
  deleteUser: (db: SupabaseClient, userId: string) => Promise<{ ok: boolean; message?: string }>;
  notifyOwner: (db: SupabaseClient, agencyId: string, subject: string, lines: string[]) => Promise<boolean>;
}

async function removeLogoFolder(db: SupabaseClient, folder: string): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const { data, error } = await db.storage.from("logos").list(folder, { limit: 100 });
    if (error || !data?.length) return;
    const { error: rmError } = await db.storage.from("logos").remove(data.map((f) => `${folder}/${f.name}`));
    if (rmError) return console.error("exclusão da conta: arquivos não saíram", folder, rmError.message);
  }
}

export const DEFAULT_DELETION_DEPS: DeletionDeps = {
  stripe,
  disconnectWhatsApp: (db, botId) => disconnectWhatsAppChannel(db, botId, "conta_excluida"),
  disconnectInstagram: (db, botId) => disconnectInstagramChannel(db, botId, "conta_excluida"),
  purgeBotFiles: async (db, botId) => {
    await purgeAttachments(db, { botId });
    await removeBotSourceFiles(db, botId);
  },
  removeLogoFolder,
  deleteUser: async (db, userId) => {
    const { error } = await db.auth.admin.deleteUser(userId);
    return error ? { ok: false, message: error.message } : { ok: true };
  },
  notifyOwner: notifyAgencyOwner,
};

/** A data da exclusão: 7 dias depois do pedido. Pura. */
export const deletionDate = (now = new Date()) => new Date(now.getTime() + ACCOUNT_DELETION_DAYS * 86_400_000);

const AGENCY_COLS = "id, name, owner_id, stripe_subscription_id, billing_cancel_at, deletion_scheduled_for, deletion_billing_paused";
type AgencyRow = { id: string; name: string; owner_id: string | null; stripe_subscription_id: string | null; billing_cancel_at: string | null; deletion_scheduled_for: string | null; deletion_billing_paused: boolean | null };

const securityLink = () => appUrl("/painel/seguranca?aba=conta");

/**
 * "Excluir a conta": marca a data (7 dias) e para a renovação da assinatura (a fatura do dia 1º
 * não sai para uma conta que vai embora; desistir volta a renovar). Pedir de novo não muda a data.
 */
export async function requestAccountDeletion(db: SupabaseClient, i: { agencyId: string; userId: string; now?: Date }, deps: DeletionDeps = DEFAULT_DELETION_DEPS): Promise<{ ok: true; scheduledFor: string } | { ok: false; message: string }> {
  const { data } = await db.from("agencies").select(AGENCY_COLS).eq("id", i.agencyId).maybeSingle();
  const agency = data as AgencyRow | null;
  if (!agency) return { ok: false, message: "Conta não encontrada." };
  if (agency.deletion_scheduled_for) return { ok: true, scheduledFor: agency.deletion_scheduled_for };

  // a assinatura para de renovar (se já estava com o cancelamento agendado, fica como está)
  let paused = false;
  if (deps.stripe && agency.stripe_subscription_id && !agency.billing_cancel_at) {
    try {
      await deps.stripe.subscriptions.update(agency.stripe_subscription_id, { cancel_at_period_end: true });
      paused = true;
    } catch (e) {
      console.error("exclusão da conta: a assinatura não parou", (e as Error).message);
      return { ok: false, message: "Não deu para parar a renovação da assinatura agora. Tente de novo em instantes." };
    }
  }
  const now = i.now ?? new Date();
  const scheduledFor = deletionDate(now).toISOString();
  const { error } = await db
    .from("agencies")
    .update({ deletion_requested_at: now.toISOString(), deletion_scheduled_for: scheduledFor, deletion_requested_by: i.userId, deletion_billing_paused: paused })
    .eq("id", i.agencyId);
  if (error) return { ok: false, message: "Não foi possível agendar a exclusão. Tente de novo." };
  await deps.notifyOwner(db, i.agencyId, `A conta ${agency.name} no ${company.brand} será excluída em ${dateBR(scheduledFor)}`, [
    `Recebemos o pedido para excluir a conta ${agency.name} no ${company.brand}.`,
    "",
    `Em ${dateBR(scheduledFor)}, apagamos os chatbots, as conversas, os contatos, os leads, os arquivos e a equipe da conta, e os canais do WhatsApp e do Instagram são desconectados. A assinatura não renova mais.`,
    "",
    `Até lá, tudo continua funcionando. Para desistir, entre no painel em Segurança, Excluir a conta: ${securityLink()}`,
    "",
    "Se não foi você que pediu, desista agora e troque o acesso da conta.",
  ]);
  return { ok: true, scheduledFor };
}

/** "Desistir": a conta fica, e a assinatura volta a renovar se foi o pedido que parou. */
export async function cancelAccountDeletion(db: SupabaseClient, i: { agencyId: string }, deps: DeletionDeps = DEFAULT_DELETION_DEPS): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data } = await db.from("agencies").select(AGENCY_COLS).eq("id", i.agencyId).maybeSingle();
  const agency = data as AgencyRow | null;
  if (!agency) return { ok: false, message: "Conta não encontrada." };
  if (!agency.deletion_scheduled_for) return { ok: true };
  if (deps.stripe && agency.stripe_subscription_id && agency.deletion_billing_paused) {
    try {
      await deps.stripe.subscriptions.update(agency.stripe_subscription_id, { cancel_at_period_end: false });
    } catch (e) {
      console.error("exclusão da conta: a assinatura não voltou a renovar", (e as Error).message);
      return { ok: false, message: "Não deu para religar a renovação da assinatura agora. Tente de novo em instantes." };
    }
  }
  const { error } = await db.from("agencies").update({ deletion_requested_at: null, deletion_scheduled_for: null, deletion_requested_by: null, deletion_billing_paused: false }).eq("id", i.agencyId);
  if (error) return { ok: false, message: "Não foi possível desistir agora. Tente de novo." };
  await deps.notifyOwner(db, i.agencyId, `A exclusão da conta ${agency.name} foi cancelada`, [`A conta ${agency.name} no ${company.brand} não será mais excluída. Tudo continua como estava.`]);
  return { ok: true };
}

export interface DeletionReport {
  agencyId: string;
  bots: number;
  clients: number;
  people: number;
  usersLeft: string[];
}

/**
 * Exclui a conta, só se a data já chegou. A ordem: canais (o app sai das contas da Meta),
 * assinatura, o registro do que sai, os arquivos, a agência (cascata) e as contas da equipe.
 */
export async function executeAccountDeletion(db: SupabaseClient, agencyId: string, now = new Date(), deps: DeletionDeps = DEFAULT_DELETION_DEPS): Promise<DeletionReport | null> {
  const { data } = await db.from("agencies").select(AGENCY_COLS).eq("id", agencyId).maybeSingle();
  const agency = data as AgencyRow | null;
  if (!agency?.deletion_scheduled_for || Date.parse(agency.deletion_scheduled_for) > now.getTime()) return null;

  const [{ data: bots }, { data: clients }, { data: members }] = await Promise.all([
    db.from("bots").select("id").eq("agency_id", agencyId),
    db.from("clients").select("id").eq("agency_id", agencyId),
    db.from("agency_members").select("id, user_id").eq("agency_id", agencyId),
  ]);
  const botIds = (bots ?? []).map((b) => String(b.id));
  const clientIds = (clients ?? []).map((c) => String(c.id));
  // as pessoas do portal dos clientes: as fotos delas ficam em avatars/<id> (as linhas vão em cascata)
  const { data: portalPeople } = clientIds.length ? await db.from("client_members").select("id").in("client_id", clientIds) : { data: [] };
  const people = (members ?? []) as Array<{ id: string; user_id: string | null }>;
  const userIds = [...new Set([agency.owner_id, ...people.map((m) => m.user_id)].filter((u): u is string => Boolean(u)))];

  for (const botId of botIds) {
    await deps.disconnectWhatsApp(db, botId).catch((e) => console.error("exclusão da conta: WhatsApp", botId, (e as Error).message));
    await deps.disconnectInstagram(db, botId).catch((e) => console.error("exclusão da conta: Instagram", botId, (e as Error).message));
  }
  if (deps.stripe && agency.stripe_subscription_id) {
    try {
      await deps.stripe.subscriptions.cancel(agency.stripe_subscription_id);
    } catch (e) {
      // já cancelada (ou apagada na Stripe): segue
      console.warn("exclusão da conta: assinatura", (e as Error).message);
    }
  }
  // registrar antes de apagar: um backup restaurado apaga de novo (reapply_deletions)
  await logDeletion(db, "agencies", [agencyId]);
  await logDeletion(db, "bots", botIds);
  await logDeletion(db, "clients", clientIds);
  await logDeletion(db, "auth_users", userIds);

  for (const botId of botIds) await deps.purgeBotFiles(db, botId);
  await deps.removeLogoFolder(db, agencyId);
  for (const m of [...people, ...((portalPeople ?? []) as Array<{ id: string }>)]) await deps.removeLogoFolder(db, `avatars/${m.id}`);

  // o último e-mail sai antes (depois, o dono não existe mais)
  await deps.notifyOwner(db, agencyId, `A conta ${agency.name} no ${company.brand} foi excluída`, [
    `Como pedido em Segurança, a conta ${agency.name} no ${company.brand} foi excluída hoje: os chatbots, as conversas, os contatos, os leads, os arquivos e a equipe.`,
    "",
    "Os canais do WhatsApp e do Instagram foram desconectados (os números e as contas continuam dos negócios) e a assinatura foi cancelada.",
    "",
    `Obrigado por usar o ${company.brand}.`,
  ]);

  const { error } = await db.from("agencies").delete().eq("id", agencyId);
  if (error) throw new Error(`exclusão da conta: a agência não saiu (${error.message})`);
  const usersLeft: string[] = [];
  for (const u of userIds) {
    const r = await deps.deleteUser(db, u);
    if (!r.ok) {
      console.error("exclusão da conta: a conta da pessoa não saiu", u, r.message);
      usersLeft.push(u);
    }
  }
  const report: DeletionReport = { agencyId, bots: botIds.length, clients: clientIds.length, people: userIds.length, usersLeft };
  await audit(db, { agencyId, actorType: "system", actorId: null, action: "conta.excluida", targetType: "agency", targetId: agencyId, after: { chatbots: report.bots, clientes: report.clients, pessoas: report.people, contas_pendentes: usersLeft.length } });
  return report;
}

/** Cron diário: as contas com a data vencida, uma por vez (uma com erro não segura as outras). */
export async function runDueAccountDeletions(db: SupabaseClient, now = new Date(), deps: DeletionDeps = DEFAULT_DELETION_DEPS): Promise<{ deleted: number; failed: number }> {
  const { data } = await db.from("agencies").select("id").not("deletion_scheduled_for", "is", null).lte("deletion_scheduled_for", now.toISOString()).limit(20);
  let deleted = 0;
  let failed = 0;
  for (const row of data ?? []) {
    try {
      if (await executeAccountDeletion(db, String(row.id), now, deps)) deleted++;
    } catch (e) {
      failed++;
      console.error("exclusão da conta falhou", row.id, (e as Error).message);
    }
  }
  return { deleted, failed };
}
