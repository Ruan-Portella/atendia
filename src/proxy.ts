import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { isCustomHost } from "@/lib/domain";
import { accessDay, logAccess, requestIp, type AccessActor } from "@/lib/access-log";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashId } from "@/lib/rate-limit";

/** Cookie que marca "esta sessão já foi registrada hoje, deste IP" (evita gravar a cada página). */
const ACCESS_MARK = "bv_al";

/** O que um domínio de agência serve: demos, portal do cliente, widget e API. */
const CUSTOM_HOST_PATHS = /^\/(demo|c|w)\/|^\/api\/|^\/widget\.js$|^\/dominio$/;
const PLATFORM_ICONS = /^\/(favicon\.ico|icon\.svg|apple-icon\.png)$/;

/**
 * Renova a sessão do Supabase a cada requisição e protege /painel.
 * Em domínio próprio de agência, só deixa passar as páginas públicas dela (sem sessão);
 * o resto (landing, login, painel) vira uma página neutra com a marca da agência.
 * (No Next 16 o antigo middleware.ts chama-se proxy.ts.)
 */
export async function proxy(request: NextRequest, event: NextFetchEvent) {
  const customHost = isCustomHost(request.headers.get("host"));
  // API pública (/api/v1): só no domínio do BoaVoz, sem sessão (a chave é conferida na rota)
  if (/^\/api\/v1(\/|$)/.test(request.nextUrl.pathname)) {
    return customHost ? Response.json({ error: { code: "not_found", message: "A API do BoaVoz responde só em boavoz.com." } }, { status: 404 }) : NextResponse.next();
  }
  // ícones da plataforma (public/favicon.ico, icon.svg, apple-icon.png) não saem no domínio da agência
  if (PLATFORM_ICONS.test(request.nextUrl.pathname)) return customHost ? new NextResponse(null, { status: 404 }) : NextResponse.next();

  // a área do cliente (/cliente) precisa de sessão também no domínio da agência: segue abaixo
  const clientArea = /^\/cliente(\/|$)/.test(request.nextUrl.pathname);
  if (customHost && !clientArea) {
    if (CUSTOM_HOST_PATHS.test(request.nextUrl.pathname)) return NextResponse.next();
    const url = request.nextUrl.clone();
    url.pathname = "/dominio";
    url.search = "";
    return NextResponse.rewrite(url);
  }

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
  // backoffice (/admin) também exige login; quem é admin e a segunda etapa são conferidos na página
  if (!user && (path.startsWith("/painel") || path === "/admin" || path.startsWith("/admin/"))) {
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

  // Registro de acesso (Marco Civil): uma linha por pessoa, IP e dia, em segundo plano
  const area: AccessActor | null = path === "/admin" || path.startsWith("/admin/") ? "support" : /^\/cliente\/./.test(path) ? "member" : path.startsWith("/painel") ? "user" : null;
  if (user && area) {
    const ip = requestIp(request.headers);
    const mark = `${accessDay()}.${hashId(`${area}:${user.sub}:${ip}`).slice(0, 16)}`;
    if (request.cookies.get(ACCESS_MARK)?.value !== mark) {
      const email = typeof user.email === "string" ? user.email : null;
      event.waitUntil(logAccess(createAdminClient(), { actorType: area, actorId: String(user.sub), email, event: "session", ip, userAgent: request.headers.get("user-agent") }));
      response.cookies.set(ACCESS_MARK, mark, { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 60 * 60 * 24 });
    }
  }

  // Guarda o código de afiliado por 30 dias
  const ref = request.nextUrl.searchParams.get("ref");
  if (ref && /^[a-z0-9]{4,16}$/i.test(ref)) {
    response.cookies.set("boavoz_ref", ref, { maxAge: 60 * 60 * 24 * 30, path: "/", sameSite: "lax" });
  }
  return response;
}

export const config = {
  // imagens estáticas ficam de fora, menos os ícones da plataforma (ver PLATFORM_ICONS)
  matcher: ["/((?!_next/static|_next/image|widget.js|api/chat|api/leads|api/widget|w/|(?!icon\\.svg$|apple-icon\\.png$).*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
