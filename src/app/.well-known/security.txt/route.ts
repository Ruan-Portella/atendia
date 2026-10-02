import { securityTxt } from "@/lib/security-contact";

/** Canal de vulnerabilidades no formato padrão (RFC 9116). */
export function GET() {
  return new Response(securityTxt(), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=86400" } });
}
