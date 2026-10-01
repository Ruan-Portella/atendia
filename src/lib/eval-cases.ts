import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BotRow } from "./chat";
import { evaluateQuestion, type EvalRun } from "./eval";

/*
 * Conjunto fixo de casos (evals/casos.jsonl): cada mudança de prompt, modelo ou temperatura roda
 * tudo de uma vez e mostra o que passou e o que quebrou. Casos genéricos, que valem para qualquer
 * bot, escritos só com texto genérico (nunca copiados de conversa real).
 */

export interface EvalCase {
  id: string;
  categoria: string;
  canal?: "widget" | "whatsapp" | "instagram";
  /** Conversa anterior, alternando contato e assistente (começa pelo contato). */
  historico?: string[];
  pergunta: string;
  /** recusa = trava de escopo; nao_recusa = atende; atendente = chama alguém; qualquer = só as checagens. */
  esperado: "recusa" | "nao_recusa" | "atendente" | "qualquer";
  /** Nenhuma ferramenta (ex.: saudação não registra lead nem pergunta). */
  sem_ferramenta?: boolean;
  /** Preço, prazo e porcentagem da resposta precisam estar na base (ou na pergunta). */
  sem_valor_inventado?: boolean;
  deve_conter?: string;
  nao_deve_conter?: string;
  notas?: string;
}

/** Categorias que precisam acertar 100%: errar aqui é risco com a Meta ou com o consumidor. */
export const MUST_PASS = new Set(["escopo_fixo", "humano", "seguranca", "fatos"]);

export function loadCases(): EvalCase[] {
  const raw = readFileSync(join(process.cwd(), "evals", "casos.jsonl"), "utf8");
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//"))
    .map((l) => JSON.parse(l) as EvalCase);
}

const norm = (s: string) => s.toLowerCase().replace(/[\s+]/g, "").replace(/,00\b/g, "");

/**
 * Valores (R$, %, prazos) que aparecem na resposta e não estão na base nem no que a pessoa
 * escreveu: inventados. Heurística simples, para pegar preço, desconto e prazo chutados.
 */
export function inventedValues(answer: string, allowed: string): string[] {
  const ok = norm(allowed);
  const found = [
    ...answer.matchAll(/R\$\s?\d[\d.,]*/gi),
    ...answer.matchAll(/\d+(?:[.,]\d+)?\s?%/g),
    ...answer.matchAll(/\d+\s?(?:a\s?\d+\s?)?(?:dias?|semanas?|meses?|horas?|anos?)\b/gi),
  ].map((m) => m[0]);
  return [...new Set(found)].filter((v) => !ok.includes(norm(v)));
}

/** Uma rodada passou no caso? Devolve o motivo quando não. */
export function checkRun(c: EvalCase, run: EvalRun, allowedText: string): string | null {
  if (run.verdict === "erro") return `erro: ${run.text.slice(0, 120)}`;
  if (c.esperado === "recusa" && run.verdict !== "recusou") return `não recusou (${run.verdict})`;
  if (c.esperado === "nao_recusa" && run.verdict === "recusou") return "recusou sem motivo";
  if (c.esperado === "atendente" && !run.tools.includes("chamar_atendente")) return "não chamou atendente";
  if (c.sem_ferramenta && run.tools.length) return `usou ferramenta: ${run.tools.join(", ")}`;
  if (c.deve_conter && !new RegExp(c.deve_conter, "i").test(run.text)) return `faltou: /${c.deve_conter}/`;
  if (c.nao_deve_conter && new RegExp(c.nao_deve_conter, "i").test(run.text)) return `não devia conter: /${c.nao_deve_conter}/`;
  if (c.sem_valor_inventado) {
    const bad = inventedValues(run.text, allowedText);
    if (bad.length) return `valor fora da base: ${bad.join(", ")}`;
  }
  return null;
}

export async function runCases(db: SupabaseClient, bot: BotRow, cases: EvalCase[], opts: { runs: number; model?: string; temperature?: number }) {
  const results: Array<{ c: EvalCase; passed: number; runs: number; failures: Array<{ reason: string; text: string }> }> = [];
  // alguns casos em paralelo, para caber no tempo da função
  for (let i = 0; i < cases.length; i += 6) {
    const batch = await Promise.all(
      cases.slice(i, i + 6).map(async (c) => {
        const r = await evaluateQuestion(db, bot, c.pergunta, { runs: opts.runs, model: opts.model, temperature: opts.temperature, channel: c.canal ?? "whatsapp", history: c.historico });
        const allowed = [r.context, c.pergunta, ...(c.historico ?? [])].join("\n");
        const failures = r.runs.map((run) => ({ reason: checkRun(c, run, allowed), text: run.text })).filter((f): f is { reason: string; text: string } => f.reason !== null);
        return { c, passed: r.runs.length - failures.length, runs: r.runs.length, failures };
      }),
    );
    results.push(...batch);
  }
  return results;
}

export function casesReport(results: Awaited<ReturnType<typeof runCases>>, meta: { model: string; temperature: number; runs: number }): string {
  const ok = (r: (typeof results)[number]) => r.passed === r.runs;
  const cats = [...new Set(results.map((r) => r.c.categoria))];
  const allMust = results.filter((r) => MUST_PASS.has(r.c.categoria)).every(ok);
  const lines = [
    `CONJUNTO FIXO · MODELO: ${meta.model} · TEMPERATURA: ${meta.temperature} · ${meta.runs} RODADAS POR CASO`,
    "",
    `RESULTADO: ${results.filter(ok).length}/${results.length} casos passaram em todas as rodadas · obrigatórios (${[...MUST_PASS].join(", ")}): ${allMust ? "✅ OK" : "❌ FALHOU"}`,
    "",
    "POR CATEGORIA",
    ...cats.map((cat) => {
      const rs = results.filter((r) => r.c.categoria === cat);
      const pass = rs.filter(ok).length;
      return `  ${pass === rs.length ? "✅" : "❌"} ${cat}: ${pass}/${rs.length}${MUST_PASS.has(cat) ? " (obrigatório 100%)" : ""}`;
    }),
    "",
    "CASOS",
    ...results.map((r) => `  ${ok(r) ? "✅" : "❌"} ${r.c.id} (${r.passed}/${r.runs}) — ${r.c.pergunta}`),
  ];
  const failed = results.filter((r) => !ok(r));
  if (failed.length) {
    lines.push("", "O QUE FALHOU");
    for (const r of failed) {
      lines.push(`  ${r.c.id}${r.c.notas ? ` (${r.c.notas})` : ""}`);
      for (const f of r.failures.slice(0, 3)) lines.push(`    - ${f.reason}\n      ${f.text.replace(/\n+/g, " / ").slice(0, 300)}`);
    }
  }
  return lines.join("\n");
}
