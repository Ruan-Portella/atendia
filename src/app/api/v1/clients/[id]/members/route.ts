import { withApiKey } from "@/lib/api-v1";
import { getMembers, postMember } from "@/lib/api-members";

/** O convite manda o e-mail de acesso. */
export const maxDuration = 30;

/** GET /api/v1/clients/{id}/members: a equipe do portal do cliente, com a chave que convidou cada um (permissão members). */
export const GET = withApiKey<{ id: string }>("members", (_req, api, { id }) => getMembers(api, id));

/** POST /api/v1/clients/{id}/members: dá acesso ao portal e manda o link por e-mail (permissão members). */
export const POST = withApiKey<{ id: string }>("members", (req, api, { id }) => postMember(req, api, id));
