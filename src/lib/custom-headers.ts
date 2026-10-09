/*
 * Cabeçalhos personalizados de ações e webhooks (C pública; ex.: x-api-key exigida pelo gateway do
 * cliente). Guardados cifrados (secret-box), enviados além da assinatura e nunca mostrados de novo
 * nem gravados nos logs (só os nomes). Os de assinatura (webhook-*), de transporte e o
 * Content-Type são reservados. Puro.
 */

export const RESERVED_HEADERS = /^(webhook-|host$|content-length$|content-type$|connection$|transfer-encoding$|expect$|upgrade$|te$|keep-alive$|proxy-)/i;
export const MAX_CUSTOM_HEADERS = 10;

/** "Nome: valor", um por linha → cabeçalhos, ou o problema. Pura. */
export function parseCustomHeaders(text: string): { headers: Record<string, string> } | { error: string } {
  const headers: Record<string, string> = {};
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > MAX_CUSTOM_HEADERS) return { error: `Até ${MAX_CUSTOM_HEADERS} cabeçalhos.` };
  for (const line of lines) {
    const i = line.indexOf(":");
    const name = (i > 0 ? line.slice(0, i) : "").trim();
    const value = (i > 0 ? line.slice(i + 1) : "").trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(name)) return { error: `Cabeçalho inválido: escreva "Nome: valor" (o nome só com letras, números e -), um por linha.` };
    if (RESERVED_HEADERS.test(name)) return { error: `O cabeçalho ${name} é reservado (assinatura, transporte ou Content-Type).` };
    if (!value || value.length > 1024) return { error: `O valor de ${name} precisa ter de 1 a 1.024 caracteres.` };
    if (/[^\x20-\x7e]/.test(value)) return { error: `O valor de ${name} só aceita caracteres comuns (sem acento nem quebra de linha).` };
    if (Object.keys(headers).some((k) => k.toLowerCase() === name.toLowerCase())) return { error: `O cabeçalho ${name} aparece duas vezes.` };
    headers[name] = value;
  }
  return { headers };
}

/** Os cabeçalhos que vão na requisição (os reservados nunca passam, mesmo se gravados antes). Pura. */
export const sendableHeaders = (custom: Record<string, string>): Record<string, string> => Object.fromEntries(Object.entries(custom).filter(([k]) => !RESERVED_HEADERS.test(k)).map(([k, v]) => [k, String(v)]));
