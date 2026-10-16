// Configura a Stripe do BoaVoz (revisão de preços, parte 4): produtos e preços com chave de
// pesquisa, o medidor do excedente, o webhook e o portal do cliente. Idempotente: o que já existe
// fica (o webhook só tem os eventos atualizados, e o segredo de assinatura não muda).
//
//   node --env-file=.env scripts/stripe-setup.mjs check  --base=https://dev.boavoz.com
//   node --env-file=.env scripts/stripe-setup.mjs apply  --base=https://dev.boavoz.com
//   node --env-file=.env scripts/stripe-setup.mjs apply  --base=https://boavoz.com --live
//
// Chave live só com --live. Na dev (Vercel Authentication), a URL do webhook precisa do
// ?x-vercel-protection-bypass=… : acrescente no painel da Stripe depois (o segredo não muda).
import Stripe from "stripe";

const args = process.argv.slice(2);
const mode = args.find((a) => !a.startsWith("--")) ?? "check";
const base = (args.find((a) => a.startsWith("--base="))?.slice(7) ?? "").replace(/\/$/, "");
const live = args.includes("--live");

const key = process.env.STRIPE_SECRET_KEY ?? "";
if (!/^(sk|rk)_(test|live)_/.test(key)) throw new Error("STRIPE_SECRET_KEY ausente");
if (key.includes("_live_") && !live) throw new Error("chave live: rode com --live");
if (!/^https:\/\//.test(base)) throw new Error("informe --base=https://…");
const stripe = new Stripe(key);

const CATALOG = [
  { lookup: "boavoz_bot_p", name: "BoaVoz · Chatbot P", amount: 4900, meta: { kind: "size", size: "P" }, desc: "160 atendimentos por mês" },
  { lookup: "boavoz_bot_m", name: "BoaVoz · Chatbot M", amount: 9900, meta: { kind: "size", size: "M" }, desc: "340 atendimentos por mês" },
  { lookup: "boavoz_bot_g", name: "BoaVoz · Chatbot G", amount: 19900, meta: { kind: "size", size: "G" }, desc: "680 atendimentos por mês" },
  { lookup: "boavoz_bot_volume", name: "BoaVoz · Chatbot Volume (pacote de 1.000)", amount: 29900, meta: { kind: "size", size: "volume" }, desc: "1.000 atendimentos por mês, por pacote" },
  { lookup: "boavoz_dominio", name: "BoaVoz · Domínio próprio", amount: 2900, meta: { kind: "pack", pack: "dominio" }, desc: "Painel e chat no domínio da agência" },
  { lookup: "boavoz_integracoes", name: "BoaVoz · Integrações", amount: 4900, meta: { kind: "pack", pack: "integracoes" }, desc: "Ações, webhooks, API e identificação de usuários" },
  { lookup: "boavoz_plataforma", name: "BoaVoz · Plataforma", amount: 19900, meta: { kind: "pack", pack: "plataforma" }, desc: "Lojas pela API, chatbot modelo e identificação em todas as lojas" },
];
const OVERAGE = { lookup: "boavoz_excedente", amount: 35, meter: "boavoz_excedente" };
const WEBHOOK_URL = `${base}/api/stripe/webhook`;
const WEBHOOK_EVENTS = ["checkout.session.completed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted", "invoice.paid", "invoice.payment_failed"];

const account = await stripe.accounts.retrieve();
console.log("conta:", account.settings?.dashboard?.display_name ?? "(sem nome)", "·", account.country, account.default_currency, "·", key.includes("_live_") ? "LIVE" : "teste");

const lookups = [...CATALOG.map((c) => c.lookup), OVERAGE.lookup];
const existing = await stripe.prices.list({ lookup_keys: lookups, limit: 20 });
const byLookup = new Map(existing.data.map((p) => [p.lookup_key, p]));
console.log("preços:", lookups.map((l) => `${l}=${byLookup.get(l)?.id ?? "falta"}`).join(", "));
let meter = (await stripe.billing.meters.list({ limit: 100 })).data.find((m) => m.event_name === OVERAGE.meter && m.status === "active");
console.log("medidor:", meter?.id ?? "falta");
const hooks = await stripe.webhookEndpoints.list({ limit: 100 });
const hook = hooks.data.find((h) => h.url.split("?")[0] === WEBHOOK_URL);
console.log("webhook:", hook ? `${hook.id} [${hook.enabled_events.length} eventos]` : "falta");
const portals = await stripe.billingPortal.configurations.list({ limit: 10 });
const def = portals.data.find((c) => c.is_default);
console.log("portal:", def ? `${def.id} troca=${def.features.subscription_update.enabled}` : "falta");
if (mode !== "apply") process.exit(0);

for (const c of CATALOG) {
  if (byLookup.has(c.lookup)) continue;
  const product = await stripe.products.create({ name: c.name, description: c.desc, metadata: c.meta });
  const price = await stripe.prices.create({ product: product.id, currency: "brl", unit_amount: c.amount, recurring: { interval: "month" }, lookup_key: c.lookup, metadata: c.meta });
  console.log("criado", c.lookup, price.id);
}
if (!meter) {
  meter = await stripe.billing.meters.create({
    display_name: "Atendimentos a mais (excedente)",
    event_name: OVERAGE.meter,
    default_aggregation: { formula: "sum" },
    customer_mapping: { type: "by_id", event_payload_key: "stripe_customer_id" },
    value_settings: { event_payload_key: "value" },
  });
  console.log("medidor criado", meter.id);
}
if (!byLookup.has(OVERAGE.lookup)) {
  const product = await stripe.products.create({ name: "BoaVoz · Excedente", description: "Atendimento além da cota do chatbot, até o teto do mês", metadata: { kind: "overage" } });
  const price = await stripe.prices.create({ product: product.id, currency: "brl", unit_amount: OVERAGE.amount, recurring: { interval: "month", usage_type: "metered", meter: meter.id }, lookup_key: OVERAGE.lookup, metadata: { kind: "overage" } });
  console.log("criado", OVERAGE.lookup, price.id);
}
if (hook) {
  await stripe.webhookEndpoints.update(hook.id, { enabled_events: WEBHOOK_EVENTS });
  console.log("webhook: eventos atualizados", hook.id);
} else {
  const created = await stripe.webhookEndpoints.create({ url: WEBHOOK_URL, enabled_events: WEBHOOK_EVENTS, api_version: Stripe.API_VERSION, description: `BoaVoz (${base})` });
  console.log("webhook criado", created.id, "· copie o segredo de assinatura no painel da Stripe para STRIPE_WEBHOOK_SECRET");
}
const features = {
  customer_update: { enabled: true, allowed_updates: ["email", "address", "tax_id", "name"] },
  invoice_history: { enabled: true },
  payment_method_update: { enabled: true },
  subscription_cancel: { enabled: true, mode: "at_period_end", proration_behavior: "none" },
  subscription_update: { enabled: false },
};
if (def) {
  await stripe.billingPortal.configurations.update(def.id, { features, default_return_url: `${base}/painel/cobranca` });
  console.log("portal atualizado", def.id);
} else {
  const cfg = await stripe.billingPortal.configurations.create({ features, default_return_url: `${base}/painel/cobranca`, business_profile: { privacy_policy_url: `${base}/privacidade`, terms_of_service_url: `${base}/termos` } });
  console.log("portal criado", cfg.id);
}
console.log("pronto. Falta no painel da Stripe: novas tentativas por 2 semanas e cancelar a assinatura se todas falharem.");
