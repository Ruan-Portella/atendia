/** Autor das respostas mandadas pelo app WhatsApp Business do celular (coexistência). */
export const PHONE_AUTHOR = "celular";

/** Autor das respostas mandadas pelo próprio app do Instagram (alguém da equipe no celular). */
export const IG_APP_AUTHOR = "instagram";

/** Depois de uma resposta pelo celular ou pelo app, o assistente fica quieto na conversa por este tempo. */
export const PHONE_PAUSE_MINUTES = 60;

/** Alguém respondeu pelo celular ou pelo app há pouco? Então é gente atendendo: o assistente não fala por cima. */
export function phonePauseActive(lastPhoneReplyAt: string | null | undefined, now = Date.now()): boolean {
  return Boolean(lastPhoneReplyAt) && now - new Date(lastPhoneReplyAt!).getTime() < PHONE_PAUSE_MINUTES * 60_000;
}
