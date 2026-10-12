import { withApiKey } from "@/lib/api-v1";
import { postContactConsent } from "@/lib/api-contacts";

/** POST /api/v1/contacts/{contact}/consent: aceite (ou retirada) de novidades no WhatsApp, com a prova (permissão campaigns). */
export const POST = withApiKey<{ contact: string }>("campaigns", (req, api, { contact }) => postContactConsent(req, api, contact));
