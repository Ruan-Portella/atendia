import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import { createAdminClient } from "./supabase/admin";

/*
 * Quem opera a plataforma (backoffice /admin e /api/eval): e-mail na lista PLATFORM_ADMIN_EMAILS
 * (separados por vírgula; sem a lista, ninguém) e verificação em duas etapas feita na sessão
 * (código do app autenticador: nível "aal2" do Supabase). Cada página aberta fica registrada.
 */

export function isPlatformAdmin(email: string | undefined | null): boolean {
  const list = (process.env.PLATFORM_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return Boolean(email) && list.includes(email!.toLowerCase());
}

export interface AdminSession {
  userId: string;
  email: string;
  /** Segunda etapa feita nesta sessão (código do app autenticador). */
  mfa: boolean;
}

/** Sessão de quem está logado, se for admin da plataforma (com ou sem a segunda etapa). */
export const adminSession = cache(async (): Promise<AdminSession | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const email = (claims?.email as string | undefined) ?? null;
  if (!claims?.sub || !isPlatformAdmin(email)) return null;
  return { userId: claims.sub, email: email!, mfa: claims.aal === "aal2" };
});

/** Registro de acesso (Marco Civil): quem abriu qual página do backoffice. Falha não bloqueia. */
export async function logAdminAccess(s: AdminSession, path: string) {
  const { error } = await createAdminClient().from("admin_access_log").insert({ user_id: s.userId, email: s.email, path: path.slice(0, 300) });
  if (error) console.error("backoffice: acesso não registrado", error.message);
}

/**
 * Para páginas do backoffice: sem login vai para o login (o proxy já cuida); quem não é admin
 * não vê nem que a página existe (404); admin sem a segunda etapa vai para /admin/2fa.
 * Com `path`, registra o acesso.
 */
export async function requireAdmin(path?: string): Promise<AdminSession> {
  const s = await adminSession();
  if (!s) notFound();
  if (!s.mfa) redirect("/admin/2fa");
  if (path) await logAdminAccess(s, path);
  return s;
}

/** Para rotas de API (ex.: /api/eval): a sessão de admin com a segunda etapa, ou a resposta de erro. */
export async function requireAdminApi(path: string): Promise<AdminSession | Response> {
  const s = await adminSession();
  if (!s) return new Response("não autorizado", { status: 403 });
  if (!s.mfa) return new Response("faça a verificação em duas etapas em /admin/2fa", { status: 403 });
  await logAdminAccess(s, path);
  return s;
}
