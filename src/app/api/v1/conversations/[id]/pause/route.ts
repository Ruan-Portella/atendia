import { withApiKey } from "@/lib/api-v1";
import { postPause } from "@/lib/api-conversations";

/** POST /api/v1/conversations/{id}/pause: pausa a IA nesta conversa, sempre com prazo (permissão conversations). */
export const POST = withApiKey<{ id: string }>("conversations", (req, api, { id }) => postPause(req, api, id));
