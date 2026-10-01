import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { evalReport, evaluateQuestion } from "@/lib/eval";
import { casesReport, loadCases, runCases } from "@/lib/eval-cases";
import { chatModelId } from "@/lib/ai";
import { CHAT_TEMPERATURE, type BotRow } from "@/lib/chat";

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
 * Conjunto fixo: /api/eval?bot=ID&casos=1 (opcionais: n=3, categoria=escopo_fixo, model=, temp=)
 * Roda a pergunta N vezes pelo mesmo caminho do chat, sem gravar nada, e mostra os trechos que
 * a busca trouxe e cada resposta. Gasta IA de verdade (N respostas).
 */
export async function GET(req: Request) {
  const { data: claims } = await (await createClient()).auth.getClaims();
  if (!isPlatformAdmin(claims?.claims?.email as string | undefined)) return new Response("não autorizado", { status: 403 });

  const sp = new URL(req.url).searchParams;
  const botId = sp.get("bot") ?? "";
  // conjunto fixo (evals/casos.jsonl): &casos=1 roda tudo; &categoria=escopo_fixo filtra
  if (sp.get("casos") && /^[0-9a-f-]{36}$/i.test(botId)) {
    const db = createAdminClient();
    const { data: bot } = await db.from("bots").select("*").eq("id", botId).maybeSingle<BotRow>();
    if (!bot) return new Response("bot não encontrado", { status: 404 });
    const categoria = sp.get("categoria");
    const cases = loadCases().filter((c) => !categoria || c.categoria === categoria);
    const temp = sp.get("temp");
    const temperature = temp !== null && temp !== "" && Number.isFinite(Number(temp)) ? Math.min(Math.max(Number(temp), 0), 1.5) : undefined;
    const model = sp.get("model")?.trim() || undefined;
    const runs = Math.min(Math.max(Number(sp.get("n") ?? 3) || 3, 1), 5);
    const results = await runCases(db, bot, cases, { runs, model, temperature });
    return new Response(casesReport(results, { model: model ?? `${chatModelId()} (padrão)`, temperature: temperature ?? CHAT_TEMPERATURE, runs }), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }
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
