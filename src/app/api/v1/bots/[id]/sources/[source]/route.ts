import { withApiKey } from "@/lib/api-v1";
import { deleteSourceApi } from "@/lib/api-sources";

/** DELETE /api/v1/bots/{id}/sources/{source}: tira a fonte e os trechos dela (permissão sources). */
export const DELETE = withApiKey<{ id: string; source: string }>("sources", (_req, api, { id, source }) => deleteSourceApi(api, id, source));
