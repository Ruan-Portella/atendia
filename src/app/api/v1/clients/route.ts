import { withApiKey } from "@/lib/api-v1";
import { postClient } from "@/lib/api-provisioning";

/** POST /api/v1/clients: cria o cliente (a loja), idempotente pelo external_id (permissão provisioning, escopo da conta). */
export const POST = withApiKey("provisioning", (req, api) => postClient(req, api));
