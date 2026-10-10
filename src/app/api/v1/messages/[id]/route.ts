import { withApiKey } from "@/lib/api-v1";
import { getMessage } from "@/lib/api-conversations";

/** GET /api/v1/messages/{id}: uma mensagem, com status e error (permissão messages). */
export const GET = withApiKey<{ id: string }>("messages", (_req, api, { id }) => getMessage(api, id));
