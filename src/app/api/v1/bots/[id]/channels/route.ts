import { withApiKey } from "@/lib/api-v1";
import { getChannels } from "@/lib/api-channels";

/** GET /api/v1/bots/{id}/channels: os canais da Meta do chatbot e o estado de cada um (permissão provisioning). */
export const GET = withApiKey<{ id: string }>("provisioning", (_req, api, { id }) => getChannels(api, id));
