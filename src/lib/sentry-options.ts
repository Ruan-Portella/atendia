import type { ErrorEvent } from "@sentry/nextjs";
import type { StreamedSpanJSON } from "@sentry/core";

/*
 * Sentry sem dados pessoais (ele entra na lista de subcontratados): nunca manda corpo de
 * requisição, cookies, cabeçalhos, query string, usuário nem logs do console (que podem ter
 * texto de conversa). Fica só o erro, a pilha e a rota.
 *
 * No SDK 11, sendDefaultPii não vale mais: quem manda é dataCollection, que por padrão coleta tudo
 * (prompts e respostas da IA, corpos, cabeçalhos, cookies, variáveis da pilha). Desligado aqui, e os
 * spans passam por scrubSpan (relatório de segurança de 23/10/2026, A5).
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

/**
 * Atributos de span da IA que podem ficar: modelo, operação, uso e motivo do fim (sem texto). Nomes
 * inteiros (com $): gen_ai.system fica, gen_ai.system_instructions e gen_ai.system.message (o prompt) não.
 */
const KEEP_AI = /^(gen_ai|ai)\.((system|operation\.name|operationId|request\.model|response\.model|response\.finish_?reasons?|response\.finishReason)$|(model|usage)\.)/;
/** O que sai de qualquer span: texto da IA, corpo e cabeçalho HTTP, query, usuário, consulta ao banco. */
const DROP = /^(gen_ai|ai)\.|^http\.(request|response)\.(body|header)|^url\.query|^user\.|^db\.(query\.text|statement)|cookie/i;
const URL_KEYS = new Set(["url.full", "http.url", "http.target", "url", "http.request.url"]);

/** Tira dos spans (rastreamento de desempenho) o que pode ter conversa ou identificar alguém. */
export function scrubSpan(span: StreamedSpanJSON): StreamedSpanJSON {
  const attrs: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(span.attributes ?? {})) {
    if (DROP.test(k) && !KEEP_AI.test(k)) continue;
    attrs[k] = URL_KEYS.has(k) && typeof v === "string" ? v.split("?")[0] : v;
  }
  return { ...span, name: span.name.split("?")[0], attributes: attrs as StreamedSpanJSON["attributes"] };
}

export const baseOptions = {
  dsn: sentryDsn,
  enabled: Boolean(sentryDsn),
  environment: sentryEnvironment,
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
    graphQL: { document: false, variables: false },
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    queues: false,
    stackFrameVariables: false,
  },
  // desempenho: amostra pequena (o plano grátis tem cota de eventos)
  tracesSampleRate: 0.05,
  maxValueLength: 500,
  beforeSend: scrubEvent,
  beforeSendSpan: scrubSpan,
};
