import { withApiKey } from "@/lib/api-v1";
import { listContactsApi } from "@/lib/api-contacts";

/** GET /api/v1/contacts: contatos do escopo, na ordem da última alteração (permissão contacts). */
export const GET = withApiKey("contacts", (req, api) => listContactsApi(req, api));
