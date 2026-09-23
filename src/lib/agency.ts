import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import { createAdminClient } from "./supabase/admin";
import { currentPeriod, getPlan, type Plan } from "./plans";
import { slugify } from "./utils";

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
  plan: string;
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
export const requireAgency = cache(async (): Promise<{ agency: Agency; email: string; plan: Plan; usage: number }> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) redirect("/login");
  const userId = claims.sub;
  const email = (claims.email as string | undefined) ?? "";
  const meta = (claims.user_metadata ?? {}) as Record<string, unknown>;

  // O uso do mês vem junto (embed do PostgREST): uma ida ao banco em vez de duas.
  const period = currentPeriod();
  const { data: row } = await supabase
    .from("agencies")
    .select("*, usage(conversations)")
    .eq("owner_id", userId)
    .eq("usage.period", period)
    .maybeSingle<Agency & { usage: Array<{ conversations: number }> }>();
  let agency: Agency | null = null;
  let usage = 0;
  if (row) {
    const { usage: u, ...rest } = row;
    agency = rest;
    usage = u?.[0]?.conversations ?? 0;
  }
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

  return { agency, email, plan: getPlan(agency.plan), usage };
});
