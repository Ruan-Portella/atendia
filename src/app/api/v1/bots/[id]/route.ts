import { withApiKey } from "@/lib/api-v1";
import { patchBot } from "@/lib/api-billing";

/** O envio de cobrança (subir tamanho) espera a Stripe. */
export const maxDuration = 60;

/** PATCH /api/v1/bots/{id}: tamanho (size, volume_packs) e excedente (overage) do bot (permissão billing). */
export const PATCH = withApiKey<{ id: string }>("billing", (req, api, { id }) => patchBot(req, api, id));
