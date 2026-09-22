/** Retorno padrão das server actions: nunca lançam erro para a UI, devolvem ok/mensagem. */
export type ActionResult = { ok: true; message?: string } | { ok: false; message: string };

export const ok = (message?: string): ActionResult => ({ ok: true, message });
export const fail = (message: string): ActionResult => ({ ok: false, message });
