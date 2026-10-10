import { withApiKey } from "@/lib/api-v1";
import { listBotTemplates } from "@/lib/api-messages";

/** GET /api/v1/bots/{id}/templates: os modelos do WhatsApp do bot, com categoria e status da Meta (permissão messages). */
export const GET = withApiKey<{ id: string }>("messages", (_req, api, { id }) => listBotTemplates(api, id));
