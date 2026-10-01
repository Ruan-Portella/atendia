import type { ErrorEvent } from "@sentry/nextjs";

/*
 * Sentry sem dados pessoais (ele entra na lista de subcontratados): nunca manda corpo de
 * requisição, cookies, cabeçalhos, query string, usuário nem logs do console (que podem ter
 * texto de conversa). Fica só o erro, a pilha e a rota.
 */

export const sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
export const sentryEnvironment = process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.VERCEL_ENV ?? "development";

/** Tira o que pode identificar alguém antes de o evento sair do servidor ou do navegador. */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  delete event.user;
  if (event.request) {
    const url = event.request.url?.split("?")[0];
    event.request = { method: event.request.method, url };
  }
  event.breadcrumbs = (event.breadcrumbs ?? [])
    .filter((b) => b.category !== "console")
    .map((b) => (b.data?.url ? { ...b, data: { ...b.data, url: String(b.data.url).split("?")[0] } } : b));
  return event;
}

export const baseOptions = {
  dsn: sentryDsn,
  enabled: Boolean(sentryDsn),
  environment: sentryEnvironment,
  sendDefaultPii: false,
  // desempenho: amostra pequena (o plano grátis tem cota de eventos)
  tracesSampleRate: 0.05,
  maxValueLength: 500,
  beforeSend: scrubEvent,
};
