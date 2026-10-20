import { withApiKey } from "@/lib/api-v1";
import { createSourceApi, listSourcesApi } from "@/lib/api-sources";

/** A leitura da fonte (página ou PDF por URL) responde na hora. */
export const maxDuration = 60;

/** GET /api/v1/bots/{id}/sources: as fontes do bot, as mais novas primeiro (permissão sources). */
export const GET = withApiKey<{ id: string }>("sources", (req, api, { id }) => listSourcesApi(req, api, id));

/** POST /api/v1/bots/{id}/sources: texto, FAQ, página ou PDF por URL, com o contexto opcional (permissão sources). */
export const POST = withApiKey<{ id: string }>("sources", (req, api, { id }) => createSourceApi(req, api, id));
