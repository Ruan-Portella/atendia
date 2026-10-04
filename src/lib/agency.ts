import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import { createAdminClient } from "./supabase/admin";
import { getPlan, type Plan } from "./plans";
import { slugify } from "./utils";
import { monthAtendimentos, quotaOf } from "./atendimentos";

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

/**
 * Devolve a agência do usuário logado, criando-a no primeiro acesso
 * (usa o nome informado no cadastro ou o e-mail). Redireciona para /login se não houver sessão.
 *
 * Envolvida em `cache()`: layout e página chamam na mesma requisição e só a primeira consulta
 * o banco. A identidade vem de `getClaims()` (JWT validado localmente), não de `getUser()`
 * (uma ida ao servidor de Auth por chamada).
 */
export const requireAgency = cache(async (): Promise<{ agency: Agency; email: string; plan: Plan; usage: number; quota: number }> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) redirect("/login");
  const userId = claims.sub;
  const email = (claims.email as string | undefined) ?? "";
  const meta = (claims.user_metadata ?? {}) as Record<string, unknown>;

  let { data: agency } = await supabase.from("agencies").select("*").eq("owner_id", userId).maybeSingle<Agency>();
  if (!agency) {
    const admin = createAdminClient();
    // pessoa de um cliente (entrou pela área do cliente) não vira agência sem querer
    if (email) {
      const { count } = await admin.from("client_members").select("id", { count: "exact", head: true }).eq("email", email.toLowerCase());
      if (count) redirect("/cliente");
    }
    const name = (meta.agency_name as string | undefined)?.trim() || (meta.full_name as string | undefined) || email.split("@")[0] || "Minha agência";
    const base = slugify(name);
    const slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;

    // afiliado: cookie gravado pelo proxy quando a pessoa chegou por ?ref=
    // (atendia_ref é o nome de antes da Boavoz; pode ser lido até 30 dias depois da troca)
    const jar = await cookies();
    const ref = (jar.get("boavoz_ref") ?? jar.get("atendia_ref"))?.value;
    let referredBy: string | null = null;
    if (ref) {
      const { data: r } = await admin.from("agencies").select("id").eq("referral_code", ref).maybeSingle();
      referredBy = r?.id ?? null;
    }
    const { data: created, error } = await admin.from("agencies").insert({ owner_id: userId, name, slug, referred_by: referredBy }).select("*").single<Agency>();
    if (error || !created) throw new Error(error?.message ?? "Não foi possível criar a agência");
    if (referredBy) await admin.from("referrals").insert({ referrer_id: referredBy, referred_id: created.id });
    agency = created;
  }

  // atendimentos do mês (São Paulo), a unidade da cota
  const usage = await monthAtendimentos(supabase, agency.id);
  return { agency, email, plan: getPlan(agency.plan), usage, quota: quotaOf(agency) };
});
