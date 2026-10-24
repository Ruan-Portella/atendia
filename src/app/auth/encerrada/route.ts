import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { activeMembership, sessionRevoked } from "@/lib/team";

/**
 * Sessão encerrada por um dono ou administrador da equipe: sai deste navegador e volta para Entrar,
 * com o aviso. Só desloga se a sessão foi mesmo encerrada: um link para cá vindo de outro site não
 * tira ninguém do painel (relatório de segurança de 23/10/2026).
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (claims?.sub) {
    const member = await activeMembership(createAdminClient(), claims.sub);
    if (member && !sessionRevoked(claims.amr, member.sessions_revoked_at)) return NextResponse.redirect(new URL("/painel", request.url), { status: 303 });
  }
  await supabase.auth.signOut({ scope: "local" });
  return NextResponse.redirect(new URL("/login?encerrada=1", request.url), { status: 303 });
}
