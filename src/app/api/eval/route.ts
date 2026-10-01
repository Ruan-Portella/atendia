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
 * (várias perguntas: repita &q=, até 8; aí cada uma roda no máximo 5 vezes)
 * (conversa anterior: &historico=fala do contato||resposta do assistente||… antes da pergunta)
 * Roda a pergunta N vezes pelo mesmo caminho do chat, sem gravar nada, e mostra os trechos que
 * a busca trouxe e cada resposta. Gasta IA de verdade (N respostas).
 */
export async function GET(req: Request) {
  const { data: claims } = await (await createClient()).auth.getClaims();
  if (!isPlatformAdmin(claims?.claims?.email as string | undefined)) return new Response("não autorizado", { status: 403 });

  const sp = new URL(req.url).searchParams;
  const botId = sp.get("bot") ?? "";
  // várias perguntas: &q=...&q=... (até 8), cada uma rodada N vezes
  const questions = sp.getAll("q").map((q) => q.trim().slice(0, 2000)).filter(Boolean).slice(0, 8);
  if (!/^[0-9a-f-]{36}$/i.test(botId) || !questions.length) {
    return new Response("Use: /api/eval?bot=ID_DO_BOT&q=pergunta&n=10 (opcionais: temp=0.3, model=gpt-4.1-mini, canal=whatsapp|instagram, formato=json)", { status: 400 });
  }
  const db = createAdminClient();
  const { data: bot } = await db.from("bots").select("*").eq("id", botId).maybeSingle<BotRow>();
  if (!bot) return new Response("bot não encontrado", { status: 404 });

  const temp = sp.get("temp");
  const canal = sp.get("canal");
  const opts = {
    // com várias perguntas, menos rodadas por pergunta para caber no tempo da função
    runs: Math.min(Number(sp.get("n") ?? 10) || 10, questions.length > 1 ? 5 : 20),
    temperature: temp !== null && temp !== "" && Number.isFinite(Number(temp)) ? Math.min(Math.max(Number(temp), 0), 1.5) : undefined,
    model: sp.get("model")?.trim() || undefined,
    channel: (canal === "whatsapp" || canal === "instagram" ? canal : "widget") as "widget" | "whatsapp" | "instagram",
    // conversa anterior: &historico=contato||assistente||contato… (separado por ||)
    history: sp.get("historico")?.split("||").map((t) => t.trim().slice(0, 2000)).filter(Boolean).slice(0, 12),
  };
  const results = await Promise.all(questions.map((q) => evaluateQuestion(db, bot, q, opts)));
  if (sp.get("formato") === "json") return Response.json(results.length === 1 ? results[0] : results);
  const overview = results.length > 1
    ? ["RESUMO", ...results.map((r, i) => `  ${i + 1}. respondeu ${r.summary.respondeu} · não tenho ${r.summary.nao_tenho} · recusou ${r.summary.recusou} · atendente ${r.summary.chamou_atendente} · ERRO ${r.summary.erro} · de ${r.summary.runs} — ${r.question}`), "", ""].join("\n")
    : "";
  return new Response(overview + results.map(evalReport).join("\n\n==========\n\n"), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
