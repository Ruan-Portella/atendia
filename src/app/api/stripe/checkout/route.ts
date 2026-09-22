import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { billingEnabled, priceFor, stripe } from "@/lib/stripe";
import { appUrl } from "@/lib/utils";

export async function POST(req: Request) {
  if (!billingEnabled || !stripe) return Response.json({ error: "billing_disabled", message: "Stripe não configurado." }, { status: 501 });
  const { plan } = z.object({ plan: z.enum(["freelancer", "agencia", "escala"]) }).parse(await req.json());
  const price = priceFor(plan);
  if (!price) return Response.json({ error: "price_missing", message: `Defina STRIPE_PRICE_${plan.toUpperCase()}.` }, { status: 500 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { data: agency } = await supabase.from("agencies").select("id, name, stripe_customer_id").eq("owner_id", user.id).single();
  if (!agency) return Response.json({ error: "no_agency" }, { status: 400 });

  let customer = agency.stripe_customer_id as string | null;
  if (!customer) {
    const c = await stripe.customers.create({ email: user.email ?? undefined, name: agency.name, metadata: { agencyId: agency.id } });
    customer = c.id;
    await createAdminClient().from("agencies").update({ stripe_customer_id: customer }).eq("id", agency.id);
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: agency.id,
    line_items: [{ price, quantity: 1 }],
    success_url: appUrl("/painel/cobranca?ok=1"),
    cancel_url: appUrl("/painel/cobranca"),
    metadata: { agencyId: agency.id, plan },
    subscription_data: { metadata: { agencyId: agency.id, plan } },
    allow_promotion_codes: true,
    locale: "pt-BR",
  });
  return Response.json({ url: session.url });
}
