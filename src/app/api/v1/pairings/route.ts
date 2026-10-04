import { withApiKey } from "@/lib/api-v1";
import { postPairing } from "@/lib/api-pairing";

/** POST /api/v1/pairings: código de pareamento do WhatsApp ou do Instagram (permissão pairing). */
export const POST = withApiKey("pairing", (req, api) => postPairing(req, api));
