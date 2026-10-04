import { withApiKey } from "@/lib/api-v1";
import { deleteLink } from "@/lib/api-pairing";

/** DELETE /api/v1/contacts/{contact}/links/{id}: desfaz o vínculo (permissão pairing). */
export const DELETE = withApiKey<{ contact: string; id: string }>("pairing", (req, api, { contact, id }) => deleteLink(req, api, contact, id));
