import { withApiKey } from "@/lib/api-v1";
import { getUsage } from "@/lib/api-usage";

/** GET /api/v1/usage ?month&client_id&bot_id: o uso do mês por cliente e chatbot (permissão provisioning). */
export const GET = withApiKey("provisioning", (req, api) => getUsage(req, api));
