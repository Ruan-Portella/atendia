import { withApiKey } from "@/lib/api-v1";
import { listLeadsApi } from "@/lib/api-contacts";

/** GET /api/v1/leads: leads do escopo, do mais antigo para o mais novo (permissão contacts). */
export const GET = withApiKey("contacts", (req, api) => listLeadsApi(req, api));
