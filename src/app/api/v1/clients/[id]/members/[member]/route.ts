import { withApiKey } from "@/lib/api-v1";
import { deleteMember } from "@/lib/api-members";

/** DELETE /api/v1/clients/{id}/members/{member}: tira o acesso ao portal na hora (permissão members). */
export const DELETE = withApiKey<{ id: string; member: string }>("members", (req, api, { id, member }) => deleteMember(req, api, id, member));
