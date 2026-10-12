import { withApiKey } from "@/lib/api-v1";
import { putContactTags } from "@/lib/api-contacts";

/** PUT /api/v1/contacts/{contact}/tags: troca as etiquetas do contato (permissão contacts). */
export const PUT = withApiKey<{ contact: string }>("contacts", (req, api, { contact }) => putContactTags(req, api, contact));
