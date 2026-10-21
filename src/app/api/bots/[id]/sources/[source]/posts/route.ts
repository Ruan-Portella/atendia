import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { activeMembership, can } from "@/lib/team";
import { editPostDescription } from "@/lib/instagram-posts";

/*
 * A lista dos posts do Instagram de uma fonte (itens menores da conferência de 20/10, parte 5):
 * GET lista os posts lidos, com a descrição das fotos; PATCH salva a descrição corrigida pela
 * equipe e refaz os trechos do post. A RLS decide quem vê a fonte; corrigir é configuração (dono,
 * administrador ou editor da equipe).
 */

export const maxDuration = 60;

type Db = Awaited<ReturnType<typeof createClient>>;

async function sourceOf(supabase: Db, botId: string, sourceId: string) {
  const { data } = await supabase.from("sources").select("id, kind").eq("id", sourceId).eq("bot_id", botId).maybeSingle();
  return data?.kind === "instagram" ? data : null;
}

const notFound = () => Response.json({ error: "not_found", message: "Fonte do Instagram não encontrada." }, { status: 404 });

export async function GET(_req: Request, ctx: RouteContext<"/api/bots/[id]/sources/[source]/posts">) {
  const { id: botId, source: sourceId } = await ctx.params;
  const supabase = await createClient();
  if (!(await sourceOf(supabase, botId, sourceId))) return notFound();
  const { data, error } = await supabase
    .from("instagram_posts")
    .select("id, media_type, is_reel, caption, permalink, posted_at, description, description_edited_at, description_edited_by")
    .eq("source_id", sourceId)
    .order("posted_at", { ascending: false })
    .limit(100);
  if (error) return Response.json({ error: "read_failed", message: "Não foi possível carregar os posts." }, { status: 500 });
  return Response.json({ posts: data ?? [] });
}

const EditBody = z.object({ postId: z.string().uuid(), description: z.string().max(8000) });

const EDIT_PROBLEM = {
  nao_encontrado: [404, "Post não encontrado (ele pode ter saído da janela dos 90 dias)."],
  ocupada: [409, "A leitura dos posts está rodando agora. Tente de novo em alguns minutos."],
  erro: [500, "Não foi possível salvar a descrição. Tente de novo."],
} as const;

export async function PATCH(req: Request, ctx: RouteContext<"/api/bots/[id]/sources/[source]/posts">) {
  const { id: botId, source: sourceId } = await ctx.params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const sub = auth?.claims?.sub;
  const member = sub ? await activeMembership(createAdminClient(), sub) : null;
  if (!member || !can(member.role, "config")) return Response.json({ error: "forbidden", message: "O seu papel na equipe não altera a base de conhecimento." }, { status: 403 });
  if (!(await sourceOf(supabase, botId, sourceId))) return notFound();
  const body = EditBody.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "invalid_body", message: "Descrição inválida (até 8.000 caracteres)." }, { status: 400 });
  const r = await editPostDescription(createAdminClient(), { botId, sourceId, postId: body.data.postId, text: body.data.description, by: String(auth?.claims?.email ?? sub) });
  if (!r.ok) {
    const [status, message] = EDIT_PROBLEM[r.problem];
    return Response.json({ error: r.problem, message }, { status });
  }
  return Response.json({ ok: true, chunks: r.chunks });
}
