import { withApiKey } from "@/lib/api-v1";
import { postCampaign } from "@/lib/api-campaigns";

/** Público grande (até 10 mil contatos) e a leitura dos modelos na Meta: a função precisa de folga. */
export const maxDuration = 60;

/** POST /api/v1/campaigns: campanha de marketing ou lembretes, com Idempotency-Key (permissão campaigns). */
export const POST = withApiKey("campaigns", (req, api) => postCampaign(req, api));
