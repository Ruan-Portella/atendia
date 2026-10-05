import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import { createAdminClient } from "./supabase/admin";
import { getPlan, type Plan } from "./plans";
import { slugify } from "./utils";
import { monthAtendimentos, quotaOf } from "./atendimentos";
import { activeMembership, can, hadMembership, openInvitesFor, type AgencyMember, type AgencyRole, type Permission } from "./team";
import { firstName, personName } from "./authors";

export interface Agency {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  brand_color: string;
  support_whatsapp: string | null;
  custom_domain: string | null;
  custom_domain_verified_at: string | null;
  privacy_url: string | null;
  retention_months: number | null;
  /** Prazo novo esperando a data de efeito (redução em 30 dias; ver retention.ts). */
  retention_pending_months: number | null;
  retention_effective_at: string | null;
  /** Até quando os alertas de segurança já foram vistos (faixa do topo do painel). */
  security_alerts_seen_at: string | null;
  plan: string;
  /** Cota combinada fora do plano (assinantes de antes da cota nova); nula = a do plano. */
  quota_override: number | null;
  /** Recursos liberados pelo BoaVoz para esta conta (ver features.ts). */
  features: string[];
  trial_ends_at: string;
  stripe_customer_id: string | null;
  referral_code: string;
  created_at: string;
}

export interface AgencyContext {
  agency: Agency;
  email: string;
  plan: Plan;
  usage: number;
  quota: number;
  /** id do usuário logado (quem fez, na auditoria) */
  userId: string;
  /** vínculo do usuário com a agência: papel e escopo (equipe, leva B1') */
  member: AgencyMember;
  role: AgencyRole;
}

/**
 * Devolve a agência do usuário logado pelo vínculo em agency_members (dono, administrador,
 * editor ou atendente). Sem vínculo, cria a agência no primeiro acesso (nome do cadastro ou o
 * e-mail); quem tem convite em aberto ou já foi de uma equipe vai para /convite, e quem é só do
 * portal do cliente vai para /cliente. Redireciona para /login se não houver sessão.
 *
 * Envolvida em `cache()`: layout e página chamam na mesma requisição e só a primeira consulta
 * o banco. A identidade vem de `getClaims()` (JWT validado localmente), não de `getUser()`
 * (uma ida ao servidor de Auth por chamada).
 */
export const requireAgency = cache(async (): Promise<AgencyContext> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) redirect("/login");
  const userId = claims.sub;
  const email = ((claims.email as string | undefined) ?? "").toLowerCase();
  const meta = (claims.user_metadata ?? {}) as Record<string, unknown>;
  const admin = createAdminClient();

  let member = await activeMembership(admin, userId);
  if (!member) {
    // dono de uma agência sem a linha owner (a migração 0073 cria; aqui só por garantia)
    const { data: owned } = await admin.from("agencies").select("id").eq("owner_id", userId).maybeSingle();
    if (owned) {
      const { error } = await admin.from("agency_members").insert({ agency_id: owned.id, user_id: userId, email, role: "owner", scope: "all", accepted_at: new Date().toISOString() });
      if (error) throw new Error(`equipe: linha do dono não criada (${error.message})`);
      member = await activeMembership(admin, userId);
    }
  }
  if (!member) {
    // convidado ou ex-membro de uma equipe: não vira agência sem querer
    if ((email && (await openInvitesFor(admin, email)).length) || (await hadMembership(admin, userId))) redirect("/convite");
    // pessoa de um cliente (entrou pela área do cliente) também não
    if (email) {
      const { count } = await admin.from("client_members").select("id", { count: "exact", head: true }).eq("email", email);
      if (count) redirect("/cliente");
    }
    member = await createAgencyFor(userId, email, meta);
  }
  if (member.paused_by_plan_at) redirect("/convite?pausado=1");
  // e-mail trocado na conta: o vínculo acompanha (o convite e a equipe mostram o e-mail atual)
  if (email && member.email !== email) await admin.from("agency_members").update({ email }).eq("id", member.id);

  const { data: agency, error } = await admin.from("agencies").select("*").eq("id", member.agency_id).single<Agency>();
  if (error || !agency) throw new Error(error?.message ?? "Agência não encontrada");
  // atendimentos do mês (São Paulo), a unidade da cota
  const usage = await monthAtendimentos(supabase, agency.id);
  return { agency, email, plan: getPlan(agency.plan), usage, quota: quotaOf(agency), userId, member, role: member.role };
});

/**
 * Cria a agência de quem chegou pelo cadastro (o gatilho da 0073 cria a linha do dono).
 * Afiliado: cookie gravado pelo proxy quando a pessoa chegou por ?ref=.
 */
export async function createAgencyFor(userId: string, email: string, meta: Record<string, unknown>): Promise<AgencyMember> {
  const admin = createAdminClient();
  const name = (meta.agency_name as string | undefined)?.trim() || (meta.full_name as string | undefined) || email.split("@")[0] || "Minha agência";
  const base = slugify(name);
  const slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;

  // atendia_ref é o nome de antes da Boavoz; pode ser lido até 30 dias depois da troca
  const jar = await cookies();
  const ref = (jar.get("boavoz_ref") ?? jar.get("atendia_ref"))?.value;
  let referredBy: string | null = null;
  if (ref) {
    const { data: r } = await admin.from("agencies").select("id").eq("referral_code", ref).maybeSingle();
    referredBy = r?.id ?? null;
  }
  const { data: created, error } = await admin.from("agencies").insert({ owner_id: userId, name, slug, referred_by: referredBy }).select("id").single();
  if (error || !created) throw new Error(error?.message ?? "Não foi possível criar a agência");
  if (referredBy) await admin.from("referrals").insert({ referrer_id: referredBy, referred_id: created.id });
  let member = await activeMembership(admin, userId);
  if (!member) {
    const { error: memberError } = await admin.from("agency_members").insert({ agency_id: created.id, user_id: userId, email, role: "owner", scope: "all", accepted_at: new Date().toISOString() });
    if (memberError) throw new Error(`equipe: linha do dono não criada (${memberError.message})`);
    member = await activeMembership(admin, userId);
  }
  if (!member) throw new Error("equipe: vínculo do dono não encontrado");
  // nome de exibição: começa com o primeiro nome do cadastro (editável em Meu perfil)
  if (!member.display_name) {
    const display = firstName(personName(meta), email);
    await admin.from("agency_members").update({ display_name: display }).eq("id", member.id);
    member = { ...member, display_name: display };
  }
  return member;
}

/** Página do painel que exige uma permissão: sem ela, 404 (o item nem aparece no menu). */
export async function requirePermission(perm: Permission): Promise<AgencyContext> {
  const ctx = await requireAgency();
  if (!can(ctx.role, perm)) notFound();
  return ctx;
}
