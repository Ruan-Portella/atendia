import { withApiKey } from "@/lib/api-v1";
import { deleteNoticeApi, getNoticeApi, putNoticeApi } from "@/lib/api-notice";

const PERMISSIONS = ["sources", "provisioning"] as const;

/** GET /api/v1/bots/{id}/notice: o aviso do momento que vale agora (permissão sources ou provisioning). */
export const GET = withApiKey<{ id: string }>(PERMISSIONS, (req, api, { id }) => getNoticeApi(req, api, id));

/** PUT /api/v1/bots/{id}/notice: põe ou troca o aviso {text, until}. */
export const PUT = withApiKey<{ id: string }>(PERMISSIONS, (req, api, { id }) => putNoticeApi(req, api, id));

/** DELETE /api/v1/bots/{id}/notice: tira o aviso antes do prazo. */
export const DELETE = withApiKey<{ id: string }>(PERMISSIONS, (req, api, { id }) => deleteNoticeApi(req, api, id));
