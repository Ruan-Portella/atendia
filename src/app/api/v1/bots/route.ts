import { withApiKey } from "@/lib/api-v1";
import { postBot } from "@/lib/api-provisioning";

/** Com size, a subida de tamanho espera a Stripe. */
export const maxDuration = 60;

/** POST /api/v1/bots: cria o chatbot da loja a partir de um modelo (permissão provisioning; size e overage pedem billing). */
export const POST = withApiKey("provisioning", (req, api) => postBot(req, api));
