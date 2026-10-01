import * as Sentry from "@sentry/nextjs";
import { baseOptions } from "@/lib/sentry-options";

/** Monitor de erros no servidor (Node e Edge). Sem NEXT_PUBLIC_SENTRY_DSN, fica desligado. */
export function register() {
  Sentry.init(baseOptions);
}

// erros de páginas, rotas e server actions chegam ao Sentry
export const onRequestError = Sentry.captureRequestError;
