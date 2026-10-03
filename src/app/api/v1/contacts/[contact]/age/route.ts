import { withApiKey } from "@/lib/api-v1";
import { putContactAge } from "@/lib/api-age";

/** PUT /api/v1/contacts/{contact}/age: idade informada pela empresa (permissão contacts). */
export const PUT = withApiKey<{ contact: string }>("contacts", (req, api, { contact }) => putContactAge(req, api, contact));
