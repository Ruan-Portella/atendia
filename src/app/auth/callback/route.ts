import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Troca o código do OAuth / confirmação de e-mail por uma sessão. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/painel/clientes";
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next.startsWith("/") ? next : "/painel/clientes"}`);
  }
  return NextResponse.redirect(`${origin}/login?erro=auth`);
}
