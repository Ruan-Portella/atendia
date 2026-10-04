import { sealNullable, scopeOfBot } from "./field-cipher";
import { createHash } from "node:crypto";
import { generateText } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chatModel, classifierModelId, modelCallOptions } from "./ai";
import { recordAiUsage, usageFrom } from "./ai-usage";
import { BASE_GATE_VERSION, CATEGORIES, RULES_VERSION, type GateCategory } from "./gate/rules";
import { notifyAgencyOwner, notifyPlatform } from "./notify";
import { appUrl } from "./utils";

/*
 * Análise do bot (logo depois da L1; spec "Conformidade Meta"). Um processo só por chatbot:
 *   - itens regulamentados e proibidos da base: o agregado da classificação dos trechos (parte 6
 *     do portão), uma fonte de verdade só;
 *   - fontes analisadas;
 *   - uma pergunta à IA: a conversa com a IA é o produto ("tutor com IA", "ChatGPT no WhatsApp",
 *     textos sob encomenda)? O modelo de negócio é proibido nos canais da Meta (e não um negócio
 *     misto, que ativa com o portão)?
 * O resultado vai para compliance_checks (interna) e clients.profile (a agência vê só os itens,
 * para consulta). "Sim" ou "incerto" numa das perguntas vira pendência no painel interno, sem
 * selo para o cliente e sem segurar nada. Gatilhos agrupados: cada mudança empurra a análise para
 * daqui a ~10 minutos; sem mudança no que é analisado, ela não roda de novo.
 */

export const ANALYSIS_VERSION = `${RULES_VERSION}/analise-1`;
export const ANALYSIS_DELAY_MS = 10 * 60_000;

export type Tri = "sim" | "nao" | "incerto";

export interface AnalysisAnswer {
  ia_como_produto: Tri;
  motivo_ia: string;
  modelo_proibido: Tri;
  categoria_principal: GateCategory | null;
  resumo: string;
}

export interface FoundCategory {
  categoria: GateCategory;
  nivel: "regulamentado" | "proibido";
  trechos: number;
  exemplos: string[];
}

/** Agrega a classificação dos trechos: quantos trechos oferecem cada categoria, com até 3 exemplos. Pura. */
export function aggregateCategories(chunks: Array<{ gate_segments: Array<{ t: string; c?: string[] }> | null }>): FoundCategory[] {
  const by = new Map<GateCategory, { n: number; ex: string[] }>();
  for (const ch of chunks) {
    const inChunk = new Set<GateCategory>();
    for (const s of ch.gate_segments ?? []) {
      for (const raw of s.c ?? []) {
        if (!(raw in CATEGORIES)) continue;
        const c = raw as GateCategory;
        const e = by.get(c) ?? { n: 0, ex: [] };
        if (!inChunk.has(c)) {
          e.n += 1;
          inChunk.add(c);
        }
        const t = s.t.trim().slice(0, 120);
        if (t && e.ex.length < 3 && !e.ex.includes(t)) e.ex.push(t);
        by.set(c, e);
      }
    }
  }
  return [...by]
    .map(([categoria, e]) => ({ categoria, nivel: CATEGORIES[categoria].level, trechos: e.n, exemplos: e.ex }))
    .sort((a, b) => b.trechos - a.trechos);
}

const PROHIBITED = (Object.keys(CATEGORIES) as GateCategory[]).filter((c) => CATEGORIES[c].level === "proibido");

/** O texto que a IA analisa (o hash dele decide se precisa rodar de novo). Pura. */
export function analysisPrompt(i: { company: string; instructions: string; topics: string; sources: string[]; found: FoundCategory[]; sample: string }): string {
  const found = i.found.length ? i.found.map((f) => `- ${CATEGORIES[f.categoria].label} (${f.nivel}, ${f.trechos} trecho(s)): ${f.exemplos.join(" | ")}`).join("\n") : "(nenhum)";
  return `Empresa: ${i.company}
Instruções do assistente (escritas pela agência): ${i.instructions.trim().slice(0, 2000) || "(nenhuma)"}
Assuntos do negócio: ${i.topics.trim().slice(0, 500) || "(não informado)"}
Fontes da base: ${i.sources.slice(0, 30).join("; ") || "(nenhuma)"}
Itens restritos que a classificação achou na base:
${found}
Amostra da base:
${i.sample.slice(0, 4000)}

Responda duas perguntas sobre o NEGÓCIO (não sobre o assistente):
1. ia_como_produto: a conversa com a IA é o próprio produto vendido? "sim" quando o negócio vende acesso a um assistente de IA (tutor ou professor com IA, "ChatGPT no WhatsApp", textos, imagens ou trabalhos feitos pela IA sob encomenda, companhia ou consulta virtual paga). "nao" quando a IA só atende os clientes de um negócio que vende outros produtos ou serviços. "incerto" se não der para saber.
2. modelo_proibido: a atividade PRINCIPAL do negócio é uma destas, proibidas no WhatsApp e no Instagram? ${PROHIBITED.map((c) => `${c} (${CATEGORIES[c].label})`).join(", ")}. "sim" só se for a atividade principal (ex.: tabacaria, casa de apostas, sex shop); "nao" se o negócio vende outras coisas e tem só alguns itens desses (negócio misto, que funciona com o filtro); "incerto" se não der para saber.
Responda só com JSON: {"ia_como_produto": "nao", "motivo_ia": "frase curta", "modelo_proibido": "nao", "categoria_principal": null, "resumo": "uma frase do que o negócio faz"}`;
}

const tri = (v: unknown): Tri => (v === "sim" || v === "nao" ? v : "incerto");

/** Lê a resposta da IA; o que vier fora do formato conta como "incerto" (lado seguro: vai para revisão). Pura. */
export function parseAnalysis(raw: string): AnalysisAnswer {
  let j: Record<string, unknown> = {};
  try {
    j = JSON.parse(raw.replace(/^\s*```(?:json)?|```\s*$/g, "").trim()) as Record<string, unknown>;
  } catch {
    // resposta quebrada: tudo incerto
  }
  const cat = typeof j.categoria_principal === "string" && j.categoria_principal in CATEGORIES ? (j.categoria_principal as GateCategory) : null;
  return {
    ia_como_produto: tri(j.ia_como_produto),
    motivo_ia: typeof j.motivo_ia === "string" ? j.motivo_ia.slice(0, 300) : "",
    modelo_proibido: tri(j.modelo_proibido),
    categoria_principal: cat,
    resumo: typeof j.resumo === "string" ? j.resumo.slice(0, 300) : "",
  };
}

/** "Sim" ou "incerto" numa das perguntas: pendência no painel interno. Pura. */
export const reviewNeeded = (a: Pick<AnalysisAnswer, "ia_como_produto" | "modelo_proibido">) => a.ia_como_produto !== "nao" || a.modelo_proibido !== "nao";

/** O que a agência vê (clients.profile.bots[botId]): só os itens achados, sem rótulo de perfil. */
export interface BotProfile {
  analisado_em: string;
  fontes: number;
  regulados: Array<{ categoria: GateCategory; trechos: number }>;
  proibidos: Array<{ categoria: GateCategory; trechos: number }>;
}

export interface ClientProfile {
  bots?: Record<string, BotProfile>;
  /** Cliente que já estava ativo quando a análise chegou: recebe um aviso único. */
  aviso_pendente?: boolean;
  avisado_em?: string;
}

/** Empurra a análise deste chatbot para daqui a ~10 minutos (várias mudanças seguidas viram uma análise só). */
export async function markAnalysisDue(db: SupabaseClient, botId: string): Promise<void> {
  const { error } = await db.from("bots").update({ analysis_due_at: new Date(Date.now() + ANALYSIS_DELAY_MS).toISOString() }).eq("id", botId).eq("is_demo", false);
  if (error) console.error("análise do bot: não agendou", error.message);
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export type AnalysisStatus = "feita" | "igual" | "sem_base" | "aguardando_classificacao" | "ignorado";

/** Analisa um chatbot. force: roda mesmo sem mudança (botão do backoffice). */
export async function analyzeBot(db: SupabaseClient, botId: string, opts: { force?: boolean } = {}): Promise<{ status: AnalysisStatus; pending?: boolean }> {
  const clearDue = () => db.from("bots").update({ analysis_due_at: null }).eq("id", botId);
  const { data: bot } = await db.from("bots").select("id, agency_id, client_id, name, client_name, persona, business_topics, is_demo").eq("id", botId).maybeSingle();
  if (!bot || bot.is_demo) {
    if (bot) await clearDue();
    return { status: "ignorado" };
  }
  const [{ data: sources }, { count: unclassified }, { data: classified }, { data: sample }] = await Promise.all([
    db.from("sources").select("title, url").eq("bot_id", botId).eq("status", "ready").order("created_at").limit(50),
    db.from("chunks").select("id", { count: "exact", head: true }).eq("bot_id", botId).or(`gate_version.is.null,gate_version.neq."${BASE_GATE_VERSION}"`),
    db.from("chunks").select("gate_segments").eq("bot_id", botId).not("gate_segments", "is", null).limit(2000),
    db.from("chunks").select("content").eq("bot_id", botId).order("id").limit(6),
  ]);
  if (!sources?.length) {
    await clearDue();
    return { status: "sem_base" };
  }
  // a base ainda não foi classificada inteira: a análise espera (a classificação reagenda)
  if (unclassified) {
    await markAnalysisDue(db, botId);
    return { status: "aguardando_classificacao" };
  }

  const found = aggregateCategories((classified ?? []) as Array<{ gate_segments: Array<{ t: string; c?: string[] }> | null }>);
  const prompt = analysisPrompt({
    company: bot.client_name as string,
    instructions: ((bot.persona as { instructions?: string } | null)?.instructions ?? "") as string,
    topics: (bot.business_topics as string | null) ?? "",
    sources: sources.map((s) => (s.title as string) || (s.url as string) || "fonte"),
    found,
    sample: (sample ?? []).map((s) => String(s.content)).join("\n---\n"),
  });
  const inputHash = sha(`${ANALYSIS_VERSION}\n${prompt}`);
  const { data: last } = await db.from("compliance_checks").select("id, input_hash").eq("bot_id", botId).eq("kind", "bot_analysis").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!opts.force && last?.input_hash === inputHash) {
    await clearDue();
    return { status: "igual" };
  }

  const modelId = classifierModelId();
  const r = await generateText({
    model: chatModel(modelId),
    system: "Você analisa o negócio de uma empresa para a conformidade com as regras do WhatsApp e do Instagram. Responda só com JSON válido.",
    prompt,
    ...modelCallOptions(modelId, { temperature: 0, cacheKey: "boavoz-analise" }),
    maxRetries: 3,
  });
  void recordAiUsage(db, { agencyId: bot.agency_id as string, botId, kind: "analise", ...usageFrom(r.response?.modelId ?? modelId, r.totalUsage) });
  const answer = parseAnalysis(r.text);
  const pending = reviewNeeded(answer);
  const now = new Date().toISOString();

  const { data: check, error } = await db
    .from("compliance_checks")
    .insert({
      agency_id: bot.agency_id,
      client_id: bot.client_id,
      bot_id: botId,
      kind: "bot_analysis",
      labels: { categorias: found, fontes: sources.length, ia_como_produto: answer.ia_como_produto, modelo_proibido: answer.modelo_proibido, categoria_principal: answer.categoria_principal },
      // resumo do negócio escrito pela IA: cifrado com a chave do cliente
      summary_enc: await sealNullable("compliance_checks.summary_enc", [answer.resumo, answer.motivo_ia].filter(Boolean).join(" · ") || null, await scopeOfBot(botId)),
      summary_expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      rules_version: RULES_VERSION,
      input_hash: inputHash,
      review_state: pending ? "pending" : "none",
    })
    .select("id")
    .single();
  if (error || !check) throw new Error(`análise do bot não gravada: ${error?.message}`);
  // a análise nova substitui a pendência anterior deste chatbot
  await db.from("compliance_checks").update({ review_state: "resolved", resolved_by: "sistema", resolved_at: now, resolution: "substituída pela análise nova" }).eq("bot_id", botId).eq("kind", "bot_analysis").eq("review_state", "pending").neq("id", check.id);

  if (bot.client_id) await updateProfile(db, bot as { agency_id: string; client_id: string; name: string; client_name: string }, botId, { analisado_em: now, fontes: sources.length, regulados: pick(found, "regulamentado"), proibidos: pick(found, "proibido") });
  if (pending) {
    await notifyPlatform(`Análise do bot: revisar ${bot.client_name}`, [
      `${bot.client_name} (${bot.name}): IA como produto = ${answer.ia_como_produto}; modelo proibido = ${answer.modelo_proibido}${answer.categoria_principal ? ` (${CATEGORIES[answer.categoria_principal].label})` : ""}.`,
      answer.resumo && `Resumo: ${answer.resumo}`,
      answer.motivo_ia && `Motivo: ${answer.motivo_ia}`,
      "",
      "Decida em /admin/conformidade (Análise do bot). Nada foi bloqueado.",
    ].filter((l): l is string => typeof l === "string")).catch(() => false);
  }
  await clearDue();
  return { status: "feita", pending };
}

const pick = (found: FoundCategory[], nivel: FoundCategory["nivel"]) => found.filter((f) => f.nivel === nivel).map((f) => ({ categoria: f.categoria, trechos: f.trechos }));

/** Grava o resultado no perfil do cliente e, se ele já era ativo, manda o aviso único à agência. */
async function updateProfile(db: SupabaseClient, bot: { agency_id: string; client_id: string; name: string; client_name: string }, botId: string, p: BotProfile) {
  const { data: client } = await db.from("clients").select("profile").eq("id", bot.client_id).maybeSingle();
  const profile = ((client?.profile ?? {}) as ClientProfile) ?? {};
  const next: ClientProfile = { ...profile, bots: { ...(profile.bots ?? {}), [botId]: p } };
  if (profile.aviso_pendente) {
    const items = [...p.regulados, ...p.proibidos].map((x) => `${CATEGORIES[x.categoria].label} (${x.trechos} trecho${x.trechos === 1 ? "" : "s"})`);
    const sent = await notifyAgencyOwner(db, bot.agency_id, `O BoaVoz analisou o assistente de ${bot.client_name}`, [
      `Analisamos a base de conhecimento do assistente ${bot.name} (${bot.client_name}), como fazemos com todos os assistentes que atendem pelo WhatsApp e pelo Instagram.`,
      "",
      items.length ? `Itens com regras especiais encontrados: ${items.join(", ")}.` : "Não encontramos itens com regras especiais (bebida alcoólica, remédio e outros).",
      items.length ? "No WhatsApp e no Instagram, bebida e remédio só aparecem para quem confirma ter 18 anos ou mais e a compra não fecha no chat; os itens proibidos ficam de fora das respostas. Isso já funcionava assim." : "",
      "",
      "Não precisa fazer nada. O resultado fica em Clientes → Negócio e conformidade.",
      appUrl(`/painel/clientes/${bot.client_id}?tab=conformidade`),
    ]).catch(() => false);
    if (sent) Object.assign(next, { aviso_pendente: false, avisado_em: new Date().toISOString() });
  }
  const { error } = await db.from("clients").update({ profile: next }).eq("id", bot.client_id);
  if (error) console.error("análise do bot: perfil não gravado", error.message);
}

/** Roda as análises agendadas (rotina diária e botão do backoffice), dentro do tempo dado. */
export async function runDueAnalyses(db: SupabaseClient, opts: { budgetMs: number; limit?: number }): Promise<{ feitas: number; puladas: number; falhas: number; restantes: number }> {
  const started = Date.now();
  const { data: due } = await db.from("bots").select("id").eq("is_demo", false).lte("analysis_due_at", new Date().toISOString()).order("analysis_due_at").limit(opts.limit ?? 20);
  let feitas = 0;
  let puladas = 0;
  let falhas = 0;
  for (const b of due ?? []) {
    if (Date.now() - started > opts.budgetMs - 15_000) break;
    try {
      const r = await analyzeBot(db, b.id as string);
      if (r.status === "feita") feitas += 1;
      else puladas += 1;
    } catch (e) {
      falhas += 1;
      console.error("análise do bot:", b.id, (e as Error).message);
    }
  }
  const { count } = await db.from("bots").select("id", { count: "exact", head: true }).eq("is_demo", false).lte("analysis_due_at", new Date().toISOString());
  return { feitas, puladas, falhas, restantes: count ?? 0 };
}

/**
 * Fonte nova não dispara a análise completa: só se a classificação achou uma categoria proibida
 * que não estava na última análise deste chatbot.
 */
export async function flagNewProhibited(db: SupabaseClient, botId: string, categories: GateCategory[]): Promise<void> {
  const prohibited = categories.filter((c) => CATEGORIES[c]?.level === "proibido");
  if (!prohibited.length) return;
  const { data: last } = await db.from("compliance_checks").select("labels").eq("bot_id", botId).eq("kind", "bot_analysis").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const known = new Set(((last?.labels as { categorias?: FoundCategory[] } | null)?.categorias ?? []).map((f) => f.categoria));
  if (prohibited.some((c) => !known.has(c))) await markAnalysisDue(db, botId);
}
