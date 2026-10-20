import { withApiKey } from "@/lib/api-v1";
import { postPause } from "@/lib/api-channels";

/** POST /api/v1/bots/{id}/pause: a pausa do dono, em todos os canais (permissão provisioning). */
export const POST = withApiKey<{ id: string }>("provisioning", (req, api, { id }) => postPause(req, api, id));
