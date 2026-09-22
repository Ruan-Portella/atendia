import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ingestSource } from "@/lib/ingest";
import { normalizeUrl, slugify } from "@/lib/utils";

export const maxDuration = 60;

const bodySchema = z.object({
  url: z.string().min(4),
  clientName: z.string().max(80).optional(),
  contactName: z.string().max(80).optional(),
});

/**
 * Gera um chatbot de demonstração a partir de uma URL.
 * - Logado: a demo pertence à agência do usuário e aparece no painel dela.
 * - Anônimo (landing page): a demo pertence à agência "vitrine" da própria Atendia
 *   e expira; serve para o visitante experimentar.
 */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400 });
  const url = normalizeUrl(parsed.data.url);
  if (!url) return Response.json({ error: "invalid_url", message: "Cole um endereço válido, ex.: clinicasorriso.com.br" }, { status: 400 });

  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  const db = createAdminClient();

  let agencyId: string | null = null;
  if (user) {
    const { data: agency } = await db.from("agencies").select("id").eq("owner_id", user.id).maybeSingle();
    agencyId = agency?.id ?? null;
  }
  if (!agencyId) {
    // agência vitrine: criada uma vez, dona das demos anônimas
    const { data: showcase } = await db.from("agencies").select("id").eq("slug", "atendia").maybeSingle();
    if (showcase) agencyId = showcase.id;
    else return Response.json({ error: "showcase_missing", message: "Crie a agência vitrine (slug 'atendia') para demos anônimas." }, { status: 500 });
  }

  const host = new URL(url).hostname.replace(/^www\./, "");
  const clientName = parsed.data.clientName?.trim() || host.split(".")[0].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const demoSlug = `${slugify(clientName)}-${Math.random().toString(36).slice(2, 7)}`;

  const { data: bot, error } = await db
    .from("bots")
    .insert({
      agency_id: agencyId,
      name: "Assistente",
      client_name: clientName,
      client_site: url,
      is_demo: true,
      demo_slug: demoSlug,
      status: "training",
      persona: { tone: "amigável, direto e profissional", welcome: `Olá! Sou o assistente de ${clientName}. Como posso ajudar?` },
      appearance: { color: "#1f4e3d", avatar_text: clientName.slice(0, 2).toUpperCase(), suggested_questions: ["Quais são os horários?", "Quanto custa?", "Como entro em contato?"] },
      lead_capture: { enabled: true },
    })
    .select("id")
    .single();
  if (error || !bot) return Response.json({ error: "create_failed", message: error?.message }, { status: 500 });

  const { data: source } = await db
    .from("sources")
    .insert({ bot_id: bot.id, kind: "site", title: host, url })
    .select("id, bot_id, kind, title, url, content")
    .single();

  try {
    const r = await ingestSource(db, source!);
    await db.from("bots").update({ status: "live" }).eq("id", bot.id);
    return Response.json({ demoSlug, botId: bot.id, pages: r.pages, chunks: r.chunks, url: `/demo/${demoSlug}` });
  } catch (e) {
    await db.from("bots").update({ status: "error" }).eq("id", bot.id);
    return Response.json({ error: "ingest_failed", message: (e as Error).message }, { status: 422 });
  }
}
