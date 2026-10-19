import { withApiKey } from "@/lib/api-v1";
import { postCreditPurchase } from "@/lib/api-billing";

/** A compra espera a Stripe. */
export const maxDuration = 60;

/** POST /api/v1/credit/purchases: compra crédito no cartão da assinatura (permissão billing, escopo da conta inteira). */
export const POST = withApiKey("billing", (req, api) => postCreditPurchase(req, api));
