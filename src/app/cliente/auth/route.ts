import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Destino do link mágico da área do cliente: valida o token no servidor (a sessão fica no
 * cookie deste domínio) e leva para a área do cliente. Token inválido/usado → tela de entrada.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash") ?? "";
  const nextRaw = url.searchParams.get("next") ?? "/cliente";
  const next = /^\/cliente(\/[\w-]*)*$/.test(nextRaw) ? nextRaw : "/cliente";

  const supabase = await createClient();
  const { data, error } = tokenHash ? await supabase.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash }) : { data: null, error: new Error("sem token") };
  if (error || !data?.user?.email) {
    return NextResponse.redirect(new URL(`/cliente/entrar?erro=link&next=${encodeURIComponent(next)}`, url));
  }
  await createAdminClient().from("client_members").update({ last_login_at: new Date().toISOString() }).eq("email", data.user.email.toLowerCase());
  return NextResponse.redirect(new URL(next, url));
}
