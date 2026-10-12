import { withApiKey } from "@/lib/api-v1";
import { getMedia } from "@/lib/api-conversations";

/** GET /api/v1/media/{id}: o arquivo de uma mensagem, decifrado (permissão conversations). */
export const GET = withApiKey<{ id: string }>("conversations", (_req, api, { id }) => getMedia(api, id));
