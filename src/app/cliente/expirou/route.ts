import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * O acesso da área do cliente venceu (MEMBER_SESSION_DAYS): encerra a sessão neste
 * navegador e manda para a tela de pedir um link novo.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const nextRaw = url.searchParams.get("next") ?? "/cliente";
  const next = /^\/cliente(\/[\w-]*)*$/.test(nextRaw) ? nextRaw : "/cliente";
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  return NextResponse.redirect(new URL(`/cliente/entrar?expirou=1&next=${encodeURIComponent(next)}`, url));
}
