import { withApiKey } from "@/lib/api-v1";
import { postResume } from "@/lib/api-channels";

/** POST /api/v1/bots/{id}/resume: tira a pausa do dono; as medidas em vigor voltam em restrictions (permissão provisioning). */
export const POST = withApiKey<{ id: string }>("provisioning", (req, api, { id }) => postResume(req, api, id));
