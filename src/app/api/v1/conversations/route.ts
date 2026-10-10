import { withApiKey } from "@/lib/api-v1";
import { listConversations } from "@/lib/api-conversations";

/** GET /api/v1/conversations: conversas do escopo, a mais recente primeiro (permissão conversations). */
export const GET = withApiKey("conversations", (req, api) => listConversations(req, api));
