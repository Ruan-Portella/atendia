import { withApiKey } from "@/lib/api-v1";
import { getClient } from "@/lib/api-provisioning";

/** GET /api/v1/clients/{id}: dados, chatbots e conformidade do cliente (permissão provisioning). */
export const GET = withApiKey<{ id: string }>("provisioning", (_req, api, { id }) => getClient(api, id));
