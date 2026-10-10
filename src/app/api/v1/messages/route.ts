import { withApiKey } from "@/lib/api-v1";
import { postMessage } from "@/lib/api-messages";

/** O envio à Meta é síncrono (prazo de 15 s por chamada, mais a leitura dos modelos). */
export const maxDuration = 60;

/** POST /api/v1/messages: texto ou modelo pelo WhatsApp e pelo Instagram, ou texto no chat do site (permissão messages). */
export const POST = withApiKey("messages", (req, api) => postMessage(req, api));
