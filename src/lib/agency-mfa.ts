import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";

/*
 * Segundo fator da agência (leva S): opcional para todos e exigido por área. Hoje: Segurança (e as
 * ações dela), exportações e conversas de chatbot em modo dados sensíveis. Quem ainda não tem o
 * fator cadastra na hora, em /painel/verificar (app autenticador, TOTP do Supabase); o resto do
 * painel continua livre.
 */

/** Nível da sessão: "aal2" depois do código do app autenticador. */
export async function sessionAal(): Promise<string | null> {
  const { data } = await (await createClient()).auth.getClaims();
  return (data?.claims?.aal as string | undefined) ?? null;
}

export const hasMfa = async () => (await sessionAal()) === "aal2";

/** Para onde voltar depois da verificação: só o painel e as exportações da agência. Pura. */
export function safeMfaNext(raw: string | null | undefined): string {
  const v = (raw ?? "").trim();
  if (!v.startsWith("/") || v.startsWith("//") || v.includes("\\") || /[\r\n]/.test(v)) return "/painel/seguranca";
  return /^\/(painel(\/|\?|$)|api\/(exportar|leads\/export|seguranca\/))/.test(v) ? v : "/painel/seguranca";
}

export const verifyUrl = (next: string) => `/painel/verificar?next=${encodeURIComponent(safeMfaNext(next))}`;

/** Páginas: sem o segundo fator nesta sessão, vai para a verificação (cadastro, na primeira vez). */
export async function requireAgencyMfa(next: string): Promise<void> {
  if (!(await hasMfa())) redirect(verifyUrl(next));
}

/** Rotas (downloads): a resposta que manda para a verificação, ou null se já passou. */
export async function mfaRedirect(req: Request): Promise<Response | null> {
  if (await hasMfa()) return null;
  const u = new URL(req.url);
  return Response.redirect(new URL(verifyUrl(`${u.pathname}${u.search}`), u.origin), 303);
}
