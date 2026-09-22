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
  plan: string;
  trial_ends_at: string;
  stripe_customer_id: string | null;
  referral_code: string;
  created_at: string;
}

/**
 * Devolve a agência do usuário logado, criando-a no primeiro acesso
 * (usa o nome informado no cadastro ou o e-mail). Redireciona para /login se não houver sessão.
 */
export async function requireAgency(): Promise<{ agency: Agency; email: string; plan: Plan; usage: number }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let { data: agency } = await supabase.from("agencies").select("*").eq("owner_id", user.id).maybeSingle<Agency>();
  if (!agency) {
    const admin = createAdminClient();
    const name = (user.user_metadata?.agency_name as string | undefined)?.trim() || user.user_metadata?.full_name || user.email!.split("@")[0];
    const base = slugify(name);
    const slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;

    // afiliado: cookie gravado pelo proxy quando a pessoa chegou por ?ref=
    const ref = (await cookies()).get("atendia_ref")?.value;
    let referredBy: string | null = null;
    if (ref) {
      const { data: r } = await admin.from("agencies").select("id").eq("referral_code", ref).maybeSingle();
      referredBy = r?.id ?? null;
    }
    const { data: created, error } = await admin.from("agencies").insert({ owner_id: user.id, name, slug, referred_by: referredBy }).select("*").single<Agency>();
    if (error || !created) throw new Error(error?.message ?? "Não foi possível criar a agência");
    if (referredBy) await admin.from("referrals").insert({ referrer_id: referredBy, referred_id: created.id });
    agency = created;
  }

  const { data: u } = await supabase.from("usage").select("conversations").eq("agency_id", agency.id).eq("period", currentPeriod()).maybeSingle();
  return { agency, email: user.email ?? "", plan: getPlan(agency.plan), usage: u?.conversations ?? 0 };
}
