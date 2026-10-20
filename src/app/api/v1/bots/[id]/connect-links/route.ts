import { withApiKey } from "@/lib/api-v1";
import { postConnectLink } from "@/lib/api-channels";

/** POST /api/v1/bots/{id}/connect-links: o link aberto de conexão do WhatsApp ou do Instagram, ou um novo (permissão provisioning). */
export const POST = withApiKey<{ id: string }>("provisioning", (req, api, { id }) => postConnectLink(req, api, id));
