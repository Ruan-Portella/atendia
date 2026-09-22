import { DOMAIN_MARKER } from "@/lib/domain";

/** Usado pela verificação do domínio próprio: se este JSON chega pelo domínio da agência, ele aponta para nós. */
export function GET(req: Request) {
  return Response.json({ app: DOMAIN_MARKER, host: new URL(req.url).host }, { headers: { "Cache-Control": "no-store" } });
}
