import { withApiKey } from "@/lib/api-v1";
import { getBotUsage } from "@/lib/api-billing";

/** GET /api/v1/bots/{id}/usage: tamanho, cota, uso, projeção, média, sugestão e excedente do mês (permissão billing). */
export const GET = withApiKey<{ id: string }>("billing", (_req, api, { id }) => getBotUsage(api, id));
