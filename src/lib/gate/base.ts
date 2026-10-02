import { after } from "next/server";
import { generateText } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chatModel, classifierModelId, modelCallOptions } from "../ai";
import { recordAiUsage, usageFrom, type UsageTokens } from "../ai-usage";
import { dictionaryHits } from "./match";
import { lmipCheck } from "./lmip-check";
import { CATEGORIES, RULES_VERSION, effectiveLevel, type GateCategory, type GateChannel } from "./rules";
import type { AgeStatus } from "./age";

/*
 * Portão, parte 6: a base de cada empresa classificada por IA, uma vez por trecho (depois da
 * leitura da fonte, sem atrasar nada). O dicionário só conhece nomes comuns ("Heineken",
 * "dipirona"); a IA pega o que ele não conhece ("Moscow Mule", "Colorado Appia", remédio de
 * marca). Cada frase guarda as categorias de item restrito que ela OFERECE; na hora da resposta,
 * o portão monta o texto que aquela pessoa pode ver, pelo canal, pelo país e pela idade. O
 * dicionário continua valendo por cima (as duas marcações juntas: errar para o lado seguro).
 * Remédio: a IA só lê fármaco, forma e concentração; isento ou com receita é a lista da Anvisa.
 */

/** Versão da classificação: muda com as regras (e a lista da Anvisa, que sobe RULES_VERSION) ou o prompt. */
export const BASE_GATE_VERSION = `${RULES_VERSION}/base-1`;

/** Frase de um trecho, com a linha (para remontar) e as categorias restritas que oferece. */
export interface Segment {
  t: string;
  l: number;
  c?: GateCategory[];
}

/** Frases do trecho: linha a linha, cada linha por frase (o mesmo corte do dicionário). */
export function splitSegments(text: string): Segment[] {
  const out: Segment[] = [];
  text.split("\n").forEach((line, l) => {
    for (const t of line.split(/(?<=[.!?;])\s+/)) if (t.trim()) out.push({ t: t.trim(), l });
  });
  return out;
}

/** Remonta o texto com as frases que ficaram. */
export function joinSegments(segs: Segment[]): string {
  const lines = new Map<number, string[]>();
  for (const s of segs) lines.set(s.l, [...(lines.get(s.l) ?? []), s.t]);
  return [...lines.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, ts]) => ts.join(" "))
    .join("\n");
}

/* ------------------------------------------------------------------ classificação (uma vez por trecho) */

/** O que a IA marca: tudo menos "remédio com receita" (isso quem decide é a lista da Anvisa). */
const AI_CATEGORIES: GateCategory[] = (Object.keys(CATEGORIES) as GateCategory[]).filter((c) => c !== "remedio_receita");

export interface BaseItem {
  n: number;
  categoria: string;
  farmaco?: string;
  forma?: string;
  concentracao?: string;
}

/** Lê a resposta da IA; item com número ou categoria que não existe fica de fora. Resposta quebrada: erro (tenta de novo depois). */
export function parseBaseItems(raw: string, segments: number): BaseItem[] {
  const json = JSON.parse(raw.replace(/^\s*```(?:json)?|```\s*$/g, "").trim()) as { itens?: BaseItem[] };
  return (json.itens ?? []).filter((i) => Number.isInteger(i?.n) && i.n >= 1 && i.n <= segments && AI_CATEGORIES.includes(i.categoria as GateCategory));
}

/** Categoria final de um item: remédio passa pela lista da Anvisa (sem nome do fármaco, conta como isento: 18+). */
export function itemCategory(item: BaseItem): GateCategory {
  if (item.categoria !== "medicamento") return item.categoria as GateCategory;
  if (!item.farmaco?.trim()) return "medicamento";
  return lmipCheck(item.farmaco, item.forma, item.concentracao).status === "mip" ? "medicamento" : "remedio_receita";
}

const MAX_SEGMENTS = 80;

function basePrompt(companyName: string, segs: Segment[]): string {
  const cats = AI_CATEGORIES.filter((c) => c !== "bebida" && c !== "medicamento").map((c) => `- ${c}: ${CATEGORIES[c].label}`).join("\n");
  return `Empresa: ${companyName}. Abaixo, frases numeradas de um trecho da base de conhecimento dela.
Marque só as frases que mostram, listam, oferecem ou dão preço de algum destes itens:
- bebida: bebida alcoólica (cerveja, chopp, vinho, destilado, drink com álcool), também pelo nome ou marca (ex.: "Moscow Mule", "Colorado Appia", "Aperol Spritz");
- medicamento: qualquer remédio, com ou sem receita, pelo nome comercial ou pelo princípio ativo. Informe "farmaco" (princípio ativo em português; associação com " + "), "forma" (comprimido, cápsula, solução oral, creme…) e "concentracao" (ex.: "500 mg", "200 mg/5 mL"), quando o texto disser;
${cats}
Não marque: menção sem oferta ("não vendemos bebida alcoólica"), prato feito com o item ("frango na cerveja"), bebida sem álcool, orientação geral de saúde.
Responda só: {"itens": [{"n": 2, "categoria": "bebida"}, {"n": 5, "categoria": "medicamento", "farmaco": "ibuprofeno", "forma": "comprimido", "concentracao": "600 mg"}]} (lista vazia se nada).

Frases:
${segs.map((s, i) => `${i + 1}. ${s.t.slice(0, 400)}`).join("\n")}`;
}

/**
 * Classifica um trecho. segments null = nada restrito (o trecho vale inteiro para todos).
 * Erro da IA sobe: o trecho fica sem classificação (vale o dicionário) e tenta de novo depois.
 */
export async function classifyChunk(content: string, companyName: string, opts: { model?: string; onUsage?: (u: UsageTokens) => void } = {}): Promise<{ segments: Segment[] | null; categories: GateCategory[] }> {
  const segs = splitSegments(content);
  const cats: Array<Set<GateCategory>> = segs.map((s) => new Set(dictionaryHits(s.t, { channel: "whatsapp" }).map((h) => h.category)));
  const asked = segs.slice(0, MAX_SEGMENTS);
  if (asked.length) {
    const modelId = opts.model ?? classifierModelId();
    const r = await generateText({
      model: chatModel(modelId),
      system: "Você classifica trechos da base de conhecimento de uma empresa para um filtro de conformidade. Responda só com JSON válido, sem texto antes ou depois.",
      prompt: basePrompt(companyName, asked),
      ...modelCallOptions(modelId, { temperature: 0, cacheKey: "boavoz-base" }),
      maxRetries: 4,
    });
    opts.onUsage?.(usageFrom(r.response?.modelId ?? modelId, r.totalUsage));
    for (const item of parseBaseItems(r.text, asked.length)) cats[item.n - 1].add(itemCategory(item));
  }
  const categories = [...new Set(cats.flatMap((c) => [...c]))];
  if (!categories.length) return { segments: null, categories: [] };
  return { segments: segs.map((s, i) => (cats[i].size ? { ...s, c: [...cats[i]] } : s)), categories };
}

/* ------------------------------------------------------------------ na hora da resposta */

export interface GatedHit {
  content: string;
  gate_version?: string | null;
  gate_segments?: Segment[] | null;
}

/**
 * Texto do trecho que esta pessoa pode ver: sem frase de item proibido; sem bebida e remédio
 * até o "Sim" do 18+ (e nunca no WhatsApp de fora do Brasil). Trecho sem classificação: inteiro
 * (o dicionário corta por cima).
 */
export function visibleText(hit: GatedHit, o: { channel: Exclude<GateChannel, "widget">; contactPhone?: string | null; age: AgeStatus }): { text: string; hidden: GateCategory[] } {
  if (!hit.gate_version || !hit.gate_segments?.length) return { text: hit.content, hidden: [] };
  const hidden = new Set<GateCategory>();
  const keep = hit.gate_segments.filter((s) => {
    const blocked = (s.c ?? []).filter((c) => {
      const level = effectiveLevel(c, o.channel, o.contactPhone);
      return level === "proibido" || (level === "regulamentado" && o.age !== "sim");
    });
    for (const c of blocked) hidden.add(c);
    return !blocked.length;
  });
  return { text: joinSegments(keep), hidden: [...hidden] };
}

/* ------------------------------------------------------------------ trabalho de classificação */

const PAGE = 20;
const PARALLEL = 5;

/**
 * Classifica os trechos sem classificação (ou de uma versão antiga), dentro do tempo dado.
 * Bots de demonstração da landing ficam de fora (só site, sem portão; e são criados por
 * visitantes). Falha num trecho não para os outros: ele fica para a próxima vez.
 */
export async function classifyPending(db: SupabaseClient, opts: { botId?: string; budgetMs: number }): Promise<{ classified: number; failed: number; remaining: number }> {
  const started = Date.now();
  const pendingFilter = `gate_version.is.null,gate_version.neq."${BASE_GATE_VERSION}"`;
  const company = new Map<string, string>();
  let classified = 0;
  let failed = 0;
  let lastId = 0;
  while (Date.now() - started < opts.budgetMs - 20_000) {
    let q = db.from("chunks").select("id, bot_id, content, bots!inner(client_name, agency_id, is_demo)").or(pendingFilter).eq("bots.is_demo", false).gt("id", lastId).order("id").limit(PAGE);
    if (opts.botId) q = q.eq("bot_id", opts.botId);
    const { data: rows, error } = await q;
    if (error) throw new Error(`classificação da base: ${error.message}`);
    if (!rows?.length) break;
    lastId = Number(rows.at(-1)!.id);
    for (let i = 0; i < rows.length; i += PARALLEL) {
      await Promise.all(
        rows.slice(i, i + PARALLEL).map(async (row) => {
          const bot = (Array.isArray(row.bots) ? row.bots[0] : row.bots) as { client_name?: string; agency_id?: string } | null;
          company.set(row.bot_id as string, bot?.client_name ?? "a empresa");
          try {
            const r = await classifyChunk(row.content as string, company.get(row.bot_id as string)!, {
              onUsage: (u) => void recordAiUsage(db, { agencyId: bot?.agency_id, botId: row.bot_id as string, kind: "classificacao", ...u }),
            });
            const { error: upd } = await db.from("chunks").update({ gate_version: BASE_GATE_VERSION, gate_segments: r.segments, gate_categories: r.categories }).eq("id", row.id);
            if (upd) throw new Error(upd.message);
            classified += 1;
          } catch (e) {
            failed += 1;
            console.error("classificação da base: trecho não classificado", row.id, (e as Error).message);
          }
        }),
      );
      if (Date.now() - started > opts.budgetMs - 20_000) break;
    }
  }
  let rq = db.from("chunks").select("id, bots!inner(is_demo)", { count: "exact", head: true }).or(pendingFilter).eq("bots.is_demo", false);
  if (opts.botId) rq = rq.eq("bot_id", opts.botId);
  const { count } = await rq;
  return { classified, failed, remaining: count ?? 0 };
}

/**
 * Classifica a base de um bot depois de responder (leitura de fonte nova ou atualizada). O que
 * não couber no tempo da requisição fica para a rotina diária ou para o botão do backoffice.
 * Fora de uma requisição (testes, scripts), não faz nada.
 */
export function classifyLater(db: SupabaseClient, botId: string, budgetMs = 200_000) {
  try {
    after(() => classifyPending(db, { botId, budgetMs }).catch((e) => console.error("classificação da base:", (e as Error).message)));
  } catch {
    // sem requisição em andamento: a rotina diária classifica
  }
}
