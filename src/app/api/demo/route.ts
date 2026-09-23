import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ingestSource } from "@/lib/ingest";
import { normalizeUrl, slugify } from "@/lib/utils";
import { clientIp, firstExceeded, hashId, tooMany, type LimitRule } from "@/lib/rate-limit";

export const maxDuration = 60;

const bodySchema = z.object({
  url: z.string().min(4),
  clientName: z.string().max(80).optional(),
  contactName: z.string().max(80).optional(),
});

/**
 * Gera um chatbot de demonstração a partir de uma URL.
 * - Logado: a demo pertence à agência do usuário e aparece no painel dela.
 * - Anônimo (landing page): a demo pertence à agência "vitrine" da própria Boavoz
 *   e expira; serve para o visitante experimentar.
 *
 * Cada demo lê um site inteiro e gera embeddings (custa dinheiro de IA), então tem limite
 * por IP, por agência e um teto diário global para as anônimas.
 */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400 });
  const url = normalizeUrl(parsed.data.url);
  if (!url) return Response.json({ error: "invalid_url", message: "Cole um endereço válido, ex.: clinicasorriso.com.br" }, { status: 400 });

  const userClient = await createClient();
  const { data: claims } = await userClient.auth.getClaims();
  const userId = claims?.claims?.sub ?? null;
  const db = createAdminClient();

  let agencyId: string | null = null;
  if (userId) {
    const { data: agency } = await db.from("agencies").select("id").eq("owner_id", userId).maybeSingle();
    agencyId = agency?.id ?? null;
  }

  const ip = hashId(clientIp(req));
  const rules: LimitRule[] = agencyId
    ? [{ key: `demo:agency:${agencyId}`, max: 30, windowSeconds: 3600, message: "Você gerou muitas demos na última hora. Espere alguns minutos e tente de novo." }]
    : [
        { key: `demo:ip:${ip}:h`, max: 3, windowSeconds: 3600, message: "Você já gerou algumas demos agora há pouco. Crie sua conta grátis para gerar quantas quiser." },
        { key: `demo:ip:${ip}:d`, max: 8, windowSeconds: 86400, message: "Limite diário de demos sem conta atingido. Crie sua conta grátis para continuar." },
        { key: "demo:anon:global", max: Number(process.env.DEMO_ANON_DAILY_LIMIT ?? 150), windowSeconds: 86400, message: "Muita gente testando hoje! Crie sua conta grátis para gerar sua demo agora." },
      ];
  const exceeded = await firstExceeded(db, rules);
  if (exceeded) return tooMany(exceeded);

  if (!agencyId) {
    // agência vitrine: criada uma vez, dona das demos anônimas
    const { data: showcase } = await db.from("agencies").select("id").eq("slug", "boavoz").maybeSingle();
    if (showcase) agencyId = showcase.id;
    else return Response.json({ error: "showcase_missing", message: "Crie a agência vitrine (slug 'boavoz') para demos anônimas." }, { status: 500 });
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
