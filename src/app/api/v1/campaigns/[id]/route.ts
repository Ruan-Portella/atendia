import { withApiKey } from "@/lib/api-v1";
import { getCampaign } from "@/lib/api-campaigns";

/** GET /api/v1/campaigns/{id}: status e totais da campanha (permissão campaigns). */
export const GET = withApiKey<{ id: string }>("campaigns", (_req, api, { id }) => getCampaign(api, id));
