import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { evalReport, evaluateQuestion } from "@/lib/eval";
import type { BotRow } from "@/lib/chat";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Quem opera a plataforma (PLATFORM_ADMIN_EMAILS, separados por vírgula). Sem a lista, ninguém. */
function isPlatformAdmin(email: string | undefined): boolean {
  const list = (process.env.PLATFORM_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return Boolean(email) && list.includes(email!.toLowerCase());
}

/**
 * Avaliação de um bot, aberta no navegador por quem opera a plataforma (logado):
 * /api/eval?bot=ID&q=pergunta&n=10&temp=0.3&model=gpt-4.1-mini&canal=whatsapp&formato=json
 * Roda a pergunta N vezes pelo mesmo caminho do chat, sem gravar nada, e mostra os trechos que
 * a busca trouxe e cada resposta. Gasta IA de verdade (N respostas).
 */
export async function GET(req: Request) {
  const { data: claims } = await (await createClient()).auth.getClaims();
  if (!isPlatformAdmin(claims?.claims?.email as string | undefined)) return new Response("não autorizado", { status: 403 });

  const sp = new URL(req.url).searchParams;
  const botId = sp.get("bot") ?? "";
  const question = (sp.get("q") ?? "").trim().slice(0, 2000);
  if (!/^[0-9a-f-]{36}$/i.test(botId) || !question) {
    return new Response("Use: /api/eval?bot=ID_DO_BOT&q=pergunta&n=10 (opcionais: temp=0.3, model=gpt-4.1-mini, canal=whatsapp|instagram, formato=json)", { status: 400 });
  }
  const db = createAdminClient();
  const { data: bot } = await db.from("bots").select("*").eq("id", botId).maybeSingle<BotRow>();
  if (!bot) return new Response("bot não encontrado", { status: 404 });

  const temp = sp.get("temp");
  const canal = sp.get("canal");
  const result = await evaluateQuestion(db, bot, question, {
    runs: Number(sp.get("n") ?? 10) || 10,
    temperature: temp !== null && temp !== "" && Number.isFinite(Number(temp)) ? Math.min(Math.max(Number(temp), 0), 1.5) : undefined,
    model: sp.get("model")?.trim() || undefined,
    channel: canal === "whatsapp" || canal === "instagram" ? canal : "widget",
  });
  if (sp.get("formato") === "json") return Response.json(result);
  return new Response(evalReport(result), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
