import { withApiKey } from "@/lib/api-v1";
import { getCredit } from "@/lib/api-billing";

/** GET /api/v1/credit: saldo, lotes e recarga automática do crédito da conta (permissão billing, escopo da conta inteira). */
export const GET = withApiKey("billing", (_req, api) => getCredit(api));
