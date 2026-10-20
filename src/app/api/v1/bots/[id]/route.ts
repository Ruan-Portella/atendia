import { withApiKey } from "@/lib/api-v1";
import { patchBotAny } from "@/lib/api-provisioning";

/** O envio de cobrança (subir tamanho) espera a Stripe. */
export const maxDuration = 60;

/**
 * PATCH /api/v1/bots/{id}: o tamanho (size, volume_packs) e o excedente (overage), com a permissão
 * billing; ou os dados do chatbot (display, overrides, business_hours, handoff_destination), com a
 * permissão provisioning. Um ou outro por pedido.
 */
export const PATCH = withApiKey<{ id: string }>(["billing", "provisioning"], (req, api, { id }) => patchBotAny(req, api, id));
