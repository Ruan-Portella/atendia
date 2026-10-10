import { withApiKey } from "@/lib/api-v1";
import { listConversationMessages } from "@/lib/api-conversations";

/** GET /api/v1/conversations/{id}/messages: o histórico, com status e error (permissão conversations). */
export const GET = withApiKey<{ id: string }>("conversations", (req, api, { id }) => listConversationMessages(req, api, id));
