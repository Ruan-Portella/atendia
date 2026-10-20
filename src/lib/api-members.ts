import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError, invalidRequest, notFound, readJsonBody, withIdempotency, type ApiContext } from "./api-v1";
import { keyAuthor, meta, only, requireClient, requirePlatform } from "./api-provisioning";
import { audit } from "./audit";
import { notifyAgencyOwner } from "./notify";
import { PORTAL_ROLE_LABELS, isPortalRole, sendMemberLink, type PortalRole } from "./member";
import { agencyBaseUrl } from "./domain";
import { isEmail } from "./validation";
import { appUrl } from "./utils";

/*
 * Equipe do portal pela API (D', parte 4c, 19/10/2026; spec, "API de provisionamento", passo 4),
 * permissão members (desmarcada por padrão: o portal exporta conversas, então provisioning sozinho
 * não convida ninguém), pacote Plataforma:
 * - POST /v1/clients/{id}/members {email, role, display_name?}: dá o acesso e manda o link por
 *   e-mail; o mesmo e-mail no cliente devolve a pessoa que já existe (200).
 * - GET /v1/clients/{id}/members: a equipe, com a chave que convidou cada um.
 * - DELETE /v1/clients/{id}/members/{member}: tira o acesso na hora.
 * A chave que convidou fica em client_members.invited_by_key (a tela das chaves mostra as pessoas
 * de cada uma, com "remover todas"). Alerta ao dono na hora quando os convites pela API passam de
 * 20 em 24 horas, e um resumo por dia (cron diário, apiInvitesDigest).
 */

const MBR_ID = /^mbr_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
/** O mesmo limite do painel. */
export const MEMBERS_PER_CLIENT = 20;
/** Acima disto em 24 horas, o dono recebe o alerta na hora. */
export const INVITES_ALERT_24H = 20;
const INVITE_ACTION = "portal.pessoa_adicionar";
const MEMBER_COLS = "id, email, role, display_name, last_login_at, created_at, invited_by_key";

export interface MemberInput {
  email: string;
  role: PortalRole;
  displayName: string | null;
}

/** O corpo do POST. Pura. */
export function parseMemberBody(body: Record<string, unknown>): MemberInput {
  only(body, ["email", "role", "display_name"]);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!isEmail(email) || email.length > 200) throw invalidRequest("email inválido.", { field: "email" });
  if (!isPortalRole(body.role)) throw invalidRequest("role deve ser manager (gestor: tudo o que a agência liberou no portal) ou agent (atendente: só as conversas).", { field: "role" });
  let displayName: string | null = null;
  if (body.display_name !== undefined && body.display_name !== null) {
    displayName = typeof body.display_name === "string" ? body.display_name.replace(/\s+/g, " ").trim() : "";
    if (!displayName || displayName.length > 40) throw invalidRequest("display_name vai de 1 a 40 caracteres (o nome que o contato vê quando a pessoa assume a conversa).", { field: "display_name" });
  }
  return { email, role: body.role, displayName };
}

type MemberRow = { id: string; email: string; role: string; display_name: string | null; last_login_at: string | null; created_at: string; invited_by_key: string | null };

async function memberJson(db: SupabaseClient, rows: MemberRow[]) {
  const keyIds = [...new Set(rows.map((r) => r.invited_by_key).filter((k): k is string => Boolean(k)))];
  const { data: keys } = keyIds.length ? await db.from("api_keys").select("id, name, prefix").in("id", keyIds) : { data: [] };
  const keyOf = new Map((keys ?? []).map((k) => [k.id as string, { name: k.name as string, prefix: `${k.prefix}…` }]));
  return rows.map((r) => ({
    id: `mbr_${r.id}`,
    email: r.email,
    role: r.role,
    display_name: r.display_name ?? null,
    last_login_at: r.last_login_at ?? null,
    created_at: r.created_at,
    // convite pelo painel: null
    invited_by: r.invited_by_key ? { type: "api_key", ...(keyOf.get(r.invited_by_key) ?? { name: null, prefix: null }) } : null,
  }));
}

async function membersContext(api: ApiContext, rawClientId: string) {
  await requirePlatform(api);
  return requireClient(api, rawClientId);
}

export async function getMembers(api: ApiContext, rawClientId: string): Promise<Response> {
  const clientId = await membersContext(api, rawClientId);
  const { data, error } = await api.db.from("client_members").select(MEMBER_COLS).eq("client_id", clientId).order("created_at");
  if (error) throw new Error(`equipe do cliente: ${error.message}`);
  return Response.json({ data: await memberJson(api.db, (data ?? []) as MemberRow[]) });
}

export async function postMember(req: Request, api: ApiContext, rawClientId: string): Promise<Response> {
  const clientId = await membersContext(api, rawClientId);
  const { raw, body } = await readJsonBody(req);
  const input = parseMemberBody(body);
  return withIdempotency(api, req, raw, async () => {
    const db = api.db;
    const existing = async () => (await db.from("client_members").select(MEMBER_COLS).eq("client_id", clientId).eq("email", input.email).maybeSingle()).data as MemberRow | null;
    const already = await existing();
    if (already) return { status: 200, body: { ...(await memberJson(db, [already]))[0], invite_email: "not_sent" } };
    const { count } = await db.from("client_members").select("id", { count: "exact", head: true }).eq("client_id", clientId);
    if ((count ?? 0) >= MEMBERS_PER_CLIENT) throw new ApiError(422, "plan_limit_reached", `Limite de ${MEMBERS_PER_CLIENT} pessoas por cliente.`, { limit: MEMBERS_PER_CLIENT });
    const { data, error } = await db.from("client_members").insert({ client_id: clientId, email: input.email, role: input.role, display_name: input.displayName, invited_by_key: api.key.id }).select(MEMBER_COLS).single();
    if (error || !data) {
      // dois convites ao mesmo tempo para o mesmo e-mail: o segundo devolve o primeiro
      const again = /duplicate|unique/i.test(error?.message ?? "") ? await existing() : null;
      if (again) return { status: 200, body: { ...(await memberJson(db, [again]))[0], invite_email: "not_sent" } };
      throw new Error(`pessoa não adicionada: ${error?.message ?? "sem linha"}`);
    }
    const { data: client } = await db.from("clients").select("name").eq("id", clientId).single();
    await audit(db, { agencyId: api.key.agency_id, actorType: "api_key", actorId: api.key.id, action: INVITE_ACTION, targetType: "client", targetId: clientId, after: { email: input.email, papel: PORTAL_ROLE_LABELS[input.role].toLowerCase(), por: keyAuthor(api) }, ...meta(req) });
    await alertManyInvites(db, api.key.agency_id);
    // o link de acesso, com a marca da agência (o mesmo convite do painel)
    const { data: agency } = await db.from("agencies").select("name, logo_url, brand_color, support_whatsapp, custom_domain, custom_domain_verified_at").eq("id", api.key.agency_id).single();
    const sent = agency ? await sendMemberLink({ email: input.email, origin: agencyBaseUrl(agency), next: `/cliente/${clientId}`, clientName: String(client?.name ?? ""), agency }) : { ok: false as const, message: "conta não encontrada" };
    if (!sent.ok) console.error("api: convite do portal não enviado", sent.message);
    return { status: 201, body: { ...(await memberJson(db, [data as MemberRow]))[0], invite_email: sent.ok ? "sent" : "failed" } };
  });
}

export async function deleteMember(req: Request, api: ApiContext, rawClientId: string, rawMemberId: string): Promise<Response> {
  const clientId = await membersContext(api, rawClientId);
  const m = MBR_ID.exec(rawMemberId);
  if (!m) throw notFound();
  const { data: member } = await api.db.from("client_members").select("id, email").eq("id", m[1].toLowerCase()).eq("client_id", clientId).maybeSingle();
  if (!member) throw notFound();
  const { error } = await api.db.from("client_members").delete().eq("id", member.id).eq("client_id", clientId);
  if (error) throw new Error(`pessoa não removida: ${error.message}`);
  await audit(api.db, { agencyId: api.key.agency_id, actorType: "api_key", actorId: api.key.id, action: "portal.pessoa_remover", targetType: "client", targetId: clientId, before: { member_id: member.id, email: member.email }, ...meta(req) });
  return new Response(null, { status: 204 });
}

/* ------------------------------------------------------------------ alertas ao dono */

const since24h = () => new Date(Date.now() - 24 * 3_600_000).toISOString();

/** Passou de 20 convites pela API em 24 horas (só na vez que passa): e-mail ao dono na hora. */
async function alertManyInvites(db: SupabaseClient, agencyId: string): Promise<void> {
  const { count } = await db.from("audit_log").select("id", { count: "exact", head: true }).eq("agency_id", agencyId).eq("action", INVITE_ACTION).eq("actor_type", "api_key").gt("created_at", since24h());
  if (count !== INVITES_ALERT_24H + 1) return;
  await notifyAgencyOwner(db, agencyId, "Alerta: mais de 20 convites ao portal pela API em 24 horas", [
    `Chaves de API da sua conta BoaVoz convidaram mais de ${INVITES_ALERT_24H} pessoas para o portal dos clientes nas últimas 24 horas.`,
    "",
    "Se for o seu sistema cadastrando lojas, não precisa fazer nada. Se não reconhece, revogue a chave em Integrações → Chaves de API: a tela mostra as pessoas que cada chave convidou, com \"remover todas\".",
    appUrl("/painel/integracoes?aba=chaves"),
  ]).catch(() => false);
}

/** Resumo do dia (cron diário): por conta, as pessoas convidadas pela API nas últimas 24 horas. */
export async function apiInvitesDigest(db: SupabaseClient): Promise<{ agencies: number; invites: number }> {
  const { data, error } = await db.from("audit_log").select("agency_id, target_id, after, created_at").eq("action", INVITE_ACTION).eq("actor_type", "api_key").gt("created_at", since24h()).order("created_at").limit(5000);
  if (error) throw new Error(`convites pela API: ${error.message}`);
  const byAgency = new Map<string, Array<{ client: string; after: Record<string, unknown> }>>();
  for (const r of data ?? []) {
    if (!r.agency_id) continue;
    const list = byAgency.get(r.agency_id as string) ?? [];
    list.push({ client: String(r.target_id ?? ""), after: (r.after ?? {}) as Record<string, unknown> });
    byAgency.set(r.agency_id as string, list);
  }
  for (const [agencyId, list] of byAgency) {
    const clientIds = [...new Set(list.map((l) => l.client).filter(Boolean))];
    const { data: clients } = clientIds.length ? await db.from("clients").select("id, name").in("id", clientIds) : { data: [] };
    const name = new Map((clients ?? []).map((c) => [c.id as string, c.name as string]));
    const lines = list.slice(0, 50).map((l) => `- ${String(l.after.email ?? "?")}, ${String(l.after.papel ?? "")} de ${name.get(l.client) ?? "um cliente excluído"} (${String(l.after.por ?? "chave de API")})`);
    await notifyAgencyOwner(db, agencyId, `Resumo do dia: ${list.length} ${list.length === 1 ? "pessoa convidada" : "pessoas convidadas"} ao portal pela API`, [
      "Nas últimas 24 horas, chaves de API da sua conta convidaram estas pessoas para o portal dos clientes:",
      "",
      ...lines,
      ...(list.length > 50 ? [`- e mais ${list.length - 50}.`] : []),
      "",
      "Para tirar o acesso de quem uma chave convidou: Integrações → Chaves de API, \"remover todas\".",
      appUrl("/painel/integracoes?aba=chaves"),
    ]).catch(() => false);
  }
  return { agencies: byAgency.size, invites: data?.length ?? 0 };
}
