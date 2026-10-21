/*
 * Proteção contra robôs (antes da produção; posts do X trazidos em 21/10/2026). Assim que um domínio
 * ganha certificado (o do BoaVoz ou o de uma agência), robôs varrem atrás de .env, .git, painéis de
 * WordPress e afins. O BoaVoz não serve nada disso, mas cada pedido passava pelo proxy inteiro (com
 * a consulta da sessão) e pela página de 404: é custo de CPU e de execução na Vercel a cada pedido.
 * Aqui ficam as duas regras do proxy, puras:
 * - caminho de varredura: 404 na hora, sem consultar nada;
 * - sem o cookie de sessão do Supabase, o proxy não consulta a sessão (robô não tem cookie).
 */

/** Pastas e arquivos que só robô pede (nenhuma rota do BoaVoz começa assim). */
const SCANNER_PREFIX = /^\/(wp-admin|wp-login|wp-content|wp-includes|wp-json|wordpress|xmlrpc|phpmyadmin|pma|myadmin|cgi-bin|vendor\/phpunit|actuator|server-status|telescope|_profiler|_ignition|owa|ecp|boaform|hudson|jenkins|solr|geoserver)(\/|\.|$)/i;
/** Extensões de servidor e de configuração que o BoaVoz nunca serve. */
const SCANNER_SUFFIX = /\.(php\d?|phtml|asp|aspx|jsp|jspx|cgi|pl|env|bak|backup|old|orig|save|swp|sql|sqlite|db|ini|conf|cfg|log|ya?ml|toml|pem|key|tar|tgz|gz|zip|rar|7z)$/i;

/**
 * O caminho é de varredura? Qualquer trecho começando com ponto (.env, .git/HEAD, .aws/credentials,
 * .DS_Store), menos o /.well-known (security.txt e afins); as pastas de WordPress e painéis
 * conhecidos; e as extensões de servidor e de configuração. Pura.
 */
export function isScannerPath(pathname: string): boolean {
  let path: string;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    // codificação quebrada (%E0%A4%A): só robô manda
    return true;
  }
  if (path.split("/").some((seg) => seg.startsWith(".") && seg !== ".well-known")) return true;
  if (SCANNER_PREFIX.test(path)) return true;
  return SCANNER_SUFFIX.test(path);
}

/**
 * O pedido traz a sessão do Supabase? O cookie é sb-<projeto>-auth-token (às vezes em pedaços: .0,
 * .1). O do PKCE (-code-verifier) não é sessão. Pura.
 */
export function hasSessionCookie(names: string[]): boolean {
  return names.some((n) => /^sb-[^.]+-auth-token(\.\d+)?$/.test(n));
}
