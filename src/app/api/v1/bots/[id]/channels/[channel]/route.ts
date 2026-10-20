import { withApiKey } from "@/lib/api-v1";
import { deleteChannel } from "@/lib/api-channels";

/** A Meta responde à saída da inscrição. */
export const maxDuration = 30;

/** DELETE /api/v1/bots/{id}/channels/{channel}: desconecta de vez (permissão provisioning; até 5 por hora, com alerta ao dono). */
export const DELETE = withApiKey<{ id: string; channel: string }>("provisioning", (req, api, { id, channel }) => deleteChannel(req, api, id, channel));
