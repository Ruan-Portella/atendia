/**
 * O cookie da sessão do Supabase só sai por HTTPS na Vercel (produção, dev.boavoz.com e previews);
 * no localhost, sem HTTPS, segue sem o secure (relatório de segurança de 23/10/2026, M7). O
 * httpOnly fica desligado: o cliente do navegador (@supabase/ssr) lê o cookie.
 */
export const SESSION_COOKIE_OPTIONS = { secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/" };
