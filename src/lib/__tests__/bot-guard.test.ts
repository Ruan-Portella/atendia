import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { hasSessionCookie, isScannerPath } from "../bot-guard";

/** As rotas do app como URL (os grupos entre parênteses somem; os [segmentos] viram um exemplo). */
function appRoutes(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return appRoutes(path, base);
    if (!/^(page|route)\.tsx?$/.test(name)) return [];
    const url = relative(base, dir).split(sep).filter((seg) => !/^\(.*\)$/.test(seg)).map((seg) => seg.replace(/^\[\[?\.{0,3}(.*?)\]?\]$/, "x$1")).join("/");
    return [`/${url}`];
  });
}

describe("proteção contra robôs", () => {
  it("varredura: trechos com ponto, WordPress, painéis e extensões de servidor", () => {
    for (const p of ["/.env", "/.env.production", "/api/.env", "/.git/HEAD", "/.aws/credentials", "/.DS_Store", "/../.env", "/wp-login.php", "/wp-admin/", "/wordpress/wp-includes/x.js", "/phpmyadmin", "/xmlrpc.php", "/index.php", "/config.yml", "/backup.sql", "/site.zip", "/server.key", "/cgi-bin/luci", "/vendor/phpunit/phpunit/src/Util/PHP/eval-stdin.php", "/actuator/health", "/%2e%2e/%2e%2e/etc/passwd", "/%E0%A4%A"]) {
      expect(isScannerPath(p), p).toBe(true);
    }
  });

  it("nenhuma rota do BoaVoz é barrada (nem o /.well-known, os ícones, o manifest e os arquivos por id)", () => {
    const routes = appRoutes(join(__dirname, "..", "..", "app"));
    expect(routes.length).toBeGreaterThan(50);
    const blocked = routes.filter((r) => isScannerPath(r));
    expect(blocked).toEqual([]);
    for (const p of ["/", "/.well-known/security.txt", "/icon.svg", "/apple-icon.png", "/favicon.ico", "/manifest.webmanifest", "/sw.js", "/widget.js", "/robots.txt", "/sitemap.xml", "/api/files/8f2c1a", "/api/v1/media/abc", "/docs/postman/boavoz-api.postman_collection.json", "/w/abc123?chamado=K7Q2-9XMP", "/painel/bots/1/conversas/2"]) {
      expect(isScannerPath(p), p).toBe(false);
    }
  });

  it("a sessão do Supabase pelo nome do cookie (inteiro ou em pedaços); o do PKCE e os outros não contam", () => {
    expect(hasSessionCookie(["sb-abcdefghij-auth-token"])).toBe(true);
    expect(hasSessionCookie(["bv_d", "sb-abc-auth-token.0", "sb-abc-auth-token.1"])).toBe(true);
    expect(hasSessionCookie(["sb-abc-auth-token-code-verifier"])).toBe(false);
    expect(hasSessionCookie(["bv_d", "bv_al", "_ga"])).toBe(false);
    expect(hasSessionCookie([])).toBe(false);
  });
});
