import { withApiKey } from "@/lib/api-v1";
import { deleteContactApi } from "@/lib/api-contacts";

/** A rotina de exclusão roda depois da resposta (after): a função precisa de folga. */
export const maxDuration = 60;

/** DELETE /api/v1/contacts/{contact}?bot_id=: pedido do titular pela API (permissão contacts). */
export const DELETE = withApiKey<{ contact: string }>("contacts", (req, api, { contact }) => deleteContactApi(req, api, contact));
