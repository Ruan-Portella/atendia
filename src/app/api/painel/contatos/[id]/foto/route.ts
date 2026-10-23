import { createClient } from "@/lib/supabase/server";
import { contactPhoto } from "@/lib/contacts";

/**
 * A foto do contato (22/10/2026; só Instagram), para o painel. Pela sessão de quem vê: a RLS limita
 * aos contatos do escopo dela. O endereço leva a versão (?v=), então o navegador guarda por um tempo.
 */
export async function GET(_req: Request, { params }: RouteContext<"/api/painel/contatos/[id]/foto">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response(null, { status: 404 });
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return new Response(null, { status: 401 });
  const photo = await contactPhoto(supabase, id).catch(() => null);
  if (!photo) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(photo.bytes), { headers: { "Content-Type": photo.mime, "Cache-Control": "private, max-age=604800, immutable", "X-Content-Type-Options": "nosniff" } });
}
