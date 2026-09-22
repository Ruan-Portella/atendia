import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Renova a sessão do Supabase a cada requisição e protege /painel.
 * (No Next 16 o antigo middleware.ts chama-se proxy.ts.)
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // getClaims valida o JWT localmente (chave pública em cache) em vez de consultar o Auth
  // a cada requisição, como faz getUser: é a diferença entre ~5 ms e ~300 ms por página.
  const { data: claims } = await supabase.auth.getClaims();
  const user = claims?.claims?.sub ? claims.claims : null;

  const path = request.nextUrl.pathname;
  if (!user && path.startsWith("/painel")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }
  if (user && (path === "/login" || path === "/cadastro")) {
    const url = request.nextUrl.clone();
    url.pathname = "/painel/clientes";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Guarda o código de afiliado por 30 dias
  const ref = request.nextUrl.searchParams.get("ref");
  if (ref && /^[a-z0-9]{4,16}$/i.test(ref)) {
    response.cookies.set("atendia_ref", ref, { maxAge: 60 * 60 * 24 * 30, path: "/", sameSite: "lax" });
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|widget.js|api/chat|api/leads|api/widget|w/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
