import { withApiKey } from "@/lib/api-v1";
import { getLinks } from "@/lib/api-pairing";

/** GET /api/v1/contacts/{contact}/links: vínculos ativos do contato (permissão pairing). */
export const GET = withApiKey<{ contact: string }>("pairing", (req, api, { contact }) => getLinks(req, api, contact));
