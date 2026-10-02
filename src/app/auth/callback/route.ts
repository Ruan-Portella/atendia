import { after } from "next/server";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAccess, requestIp } from "@/lib/access-log";

/** Troca o código do OAuth / confirmação de e-mail por uma sessão. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/painel/clientes";
  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // registro de acesso (Marco Civil): a entrada que o servidor vê
      const userId = data.user?.id;
      if (userId) after(() => logAccess(createAdminClient(), { actorType: "user", actorId: userId, event: "login", ip: requestIp(request.headers), userAgent: request.headers.get("user-agent") }));
      return NextResponse.redirect(`${origin}${next.startsWith("/") ? next : "/painel/clientes"}`);
    }
  }
  return NextResponse.redirect(`${origin}/login?erro=auth`);
}
