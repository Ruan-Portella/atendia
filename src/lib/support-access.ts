import type { SupabaseClient } from "@supabase/supabase-js";
import { audit, type AuditEvent } from "./audit";

/*
 * Acesso do suporte (leva S): a equipe do BoaVoz só lê conteúdo de conversa de uma agência (as
 * conversas, as perguntas sem resposta e os pedidos fora do assunto) com a liberação dela, por 24
 * horas e com motivo, dada em Segurança. Cada conversa lida vai para a auditoria (a agência vê). A
 * liberação fica como histórico.
 */

export const SUPPORT_HOURS = 24;

export interface SupportGrant {
  id: string;
  agency_id: string;
  granted_by: string;
  reason: string;
  expires_at: string;
  revoked_at: string | null;
  revoked_by: string | null;
  created_at: string;
}

const COLS = "id, agency_id, granted_by, reason, expires_at, revoked_at, revoked_by, created_at";

/** A liberação que vale agora (null: o suporte não lê conversas desta agência). */
export async function activeGrant(db: SupabaseClient, agencyId: string, now = new Date()): Promise<SupportGrant | null> {
  const { data } = await db.from("support_access_grants").select(COLS).eq("agency_id", agencyId).is("revoked_at", null).gt("expires_at", now.toISOString()).order("expires_at", { ascending: false }).limit(1).maybeSingle();
  return (data as SupportGrant | null) ?? null;
}

/** Quais destas agências estão com o suporte liberado agora. */
export async function grantedAgencies(db: SupabaseClient, agencyIds: string[], now = new Date()): Promise<Set<string>> {
  const ids = [...new Set(agencyIds.filter(Boolean))];
  if (!ids.length) return new Set();
  const { data } = await db.from("support_access_grants").select("agency_id").in("agency_id", ids).is("revoked_at", null).gt("expires_at", now.toISOString());
  return new Set((data ?? []).map((g) => g.agency_id as string));
}

/** A agência libera o suporte por 24 horas (uma liberação nova; a anterior que ainda vale é encerrada). */
export async function grantSupport(db: SupabaseClient, o: { agencyId: string; by: string; reason: string; meta?: Pick<AuditEvent, "ip" | "userAgent"> }): Promise<SupportGrant> {
  await db.from("support_access_grants").update({ revoked_at: new Date().toISOString(), revoked_by: o.by }).eq("agency_id", o.agencyId).is("revoked_at", null);
  const { data, error } = await db.from("support_access_grants").insert({ agency_id: o.agencyId, granted_by: o.by, reason: o.reason, expires_at: new Date(Date.now() + SUPPORT_HOURS * 3_600_000).toISOString() }).select(COLS).single();
  if (error || !data) throw new Error(`liberação do suporte não gravada: ${error?.message}`);
  // evento grave: e-mail ao dono e faixa no painel (security-alerts)
  await audit(db, { agencyId: o.agencyId, actorType: "user", actorId: o.by, action: "suporte.liberar", targetType: "support_grant", targetId: data.id as string, after: { motivo: o.reason, ate: data.expires_at }, ...o.meta });
  return data as SupportGrant;
}

/** Encerra agora a liberação que vale. */
export async function revokeSupport(db: SupabaseClient, o: { agencyId: string; by: string; meta?: Pick<AuditEvent, "ip" | "userAgent"> }): Promise<boolean> {
  const { data } = await db.from("support_access_grants").update({ revoked_at: new Date().toISOString(), revoked_by: o.by }).eq("agency_id", o.agencyId).is("revoked_at", null).gt("expires_at", new Date().toISOString()).select("id");
  if (!data?.length) return false;
  await audit(db, { agencyId: o.agencyId, actorType: "user", actorId: o.by, action: "suporte.encerrar", targetType: "support_grant", targetId: data[0].id as string, ...o.meta });
  return true;
}

/** Leitura de conversa pelo suporte: vai para a auditoria da agência. */
export async function logSupportRead(db: SupabaseClient, o: { agencyId: string; adminEmail: string; conversationId: string; grantId: string; meta?: Pick<AuditEvent, "ip" | "userAgent"> }): Promise<void> {
  await audit(db, { agencyId: o.agencyId, actorType: "support", actorId: o.adminEmail, action: "suporte.ler_conversa", targetType: "conversation", targetId: o.conversationId, after: { liberacao: o.grantId }, ...o.meta });
}

/** Leituras feitas dentro de cada liberação (para o histórico em Segurança). */
export async function readsPerGrant(db: SupabaseClient, agencyId: string, grants: SupportGrant[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!grants.length) return out;
  const { data } = await db.from("audit_log").select("after").eq("agency_id", agencyId).eq("action", "suporte.ler_conversa").gte("created_at", grants[grants.length - 1].created_at).limit(5000);
  for (const r of data ?? []) {
    const id = (r.after as { liberacao?: string } | null)?.liberacao;
    if (id) out.set(id, (out.get(id) ?? 0) + 1);
  }
  return out;
}
