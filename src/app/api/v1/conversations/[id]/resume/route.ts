import { withApiKey } from "@/lib/api-v1";
import { postResume } from "@/lib/api-conversations";

/** A IA responde a pergunta pendente depois da resposta (after): a função precisa de folga. */
export const maxDuration = 60;

/** POST /api/v1/conversations/{id}/resume: devolve a conversa para a IA (permissão conversations). */
export const POST = withApiKey<{ id: string }>("conversations", (req, api, { id }) => postResume(req, api, id));
