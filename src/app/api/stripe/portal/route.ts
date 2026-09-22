import { createClient } from "@/lib/supabase/server";
import { billingEnabled, stripe } from "@/lib/stripe";
import { appUrl } from "@/lib/utils";

export async function POST() {
  if (!billingEnabled || !stripe) return Response.json({ error: "billing_disabled" }, { status: 501 });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { data: agency } = await supabase.from("agencies").select("stripe_customer_id").eq("owner_id", user.id).single();
  if (!agency?.stripe_customer_id) return Response.json({ error: "no_customer", message: "Ainda não há assinatura." }, { status: 400 });
  const session = await stripe.billingPortal.sessions.create({ customer: agency.stripe_customer_id, return_url: appUrl("/painel/cobranca") });
  return Response.json({ url: session.url });
}
