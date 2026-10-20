import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateText, stepCountIs, type UIMessage } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildPrompt, chatModel, chatModelId, chatReasoningEffort, fixedInstructions, modelCallOptions, offTopicReminder, scopeReminder, type ReasoningEffort } from "./ai";
import { CHAT_TEMPERATURE, chatCacheKey, channelNoteFor, chatTools, conversationHistory, gatePrompt, handoffPrompt, linkHostsFor, postNoteFor, refusalAck, retrieveContext, withRiskText, type BotRow, type ToolResultRow } from "./chat";
import { postPriceRuleOf } from "./post-context";
import { ACTIONS_PROMPT_NOTE, actionToolsFor, offeredMatch } from "./action-tools";
import { readResponse, type ActionLevel, type ActionRow, type CallInput, type CallResult, type ParamsSchema } from "./actions";
import { joinShownText, normalizeLink, normalizeOptions, optionsFromText, type MessageComponent, type OptionItem } from "./components";
import { handoffNotice } from "./handoff-hours";
import { RISK_TEXT } from "./risk";
import { checkLeadInput, leadSavedNote } from "./lead-input";
import { costUsd, usageFrom, type UsageTokens } from "./ai-usage";
import { photoMatchesStep } from "./photo-reading";
import type { PhotoReading } from "./photo-note";
import { gatedHistory } from "./gate/context";
import { botGateExemptions } from "./gate/exceptions";
import { historyUpTo } from "./gate/flow";
import type { GateCategory } from "./gate/rules";
import { endActiveRoutine, routinePreTurn, routineSession } from "./routine-engine";
import { accountLabel, identityPort, identityPreTurn, loadConversationIdentity, markConsentAsked } from "./routine-identity";
import { identityPromptNote } from "./widget-identity";
import { externalIdHash } from "./contacts";
import { contextHashOf } from "./identity";
import { normalizeKeyword, routineProblem, type RoutineInput } from "./routines";
import type { EndReason } from "./routine-run";
import { memoryDb, type MemRow } from "./memory-db";
import type { EvalRun } from "./eval";

/*
 * Avaliação de roteiros (B2', parte 4): cada caso é uma conversa inteira (mensagens do contato,
 * toques em botões e fotos) rodada pelo caminho do canal (identificação, roteiro, ferramentas e IA)
 * num banco em memória: nada é gravado. As ações dos passos são simuladas pelo caso (a resposta sai
 * pelos parâmetros ou pela conta da conversa) e passam pela mesma leitura, pelo mesmo portão e pelo
 * mesmo roteiro de uma chamada de verdade. A conferência da foto do passo é a de verdade
 * (classificador); a leitura da foto não roda (o caso já traz a descrição). O portão da entrada fica
 * de fora (os casos de portão estão nos outros arquivos).
 */

/** Uma mensagem do contato no caso: texto, toque num botão ou foto (com o texto junto como legenda). */
export interface RoutineCaseTurn {
  contato?: string;
  /** Botão da última mensagem com botões, pelo título ("Av. Brasil, 200") ou pela posição ("2"). */
  toque?: string;
  /** A descrição que a leitura de fotos daria (a foto em si não existe). */
  foto?: string;
  espera?: TurnExpectation;
}

/** O que conferir depois da mensagem (tudo opcional). */
export interface TurnExpectation {
  /** Roteiro em andamento depois da vez (null: nenhum). */
  roteiro?: string | null;
  /** Passo do roteiro em andamento (1 em diante). */
  passo?: number;
  /** Um roteiro acabou nesta vez: concluido ou o motivo do abandono (cancelled, handoff, replaced...). */
  fim?: "concluido" | EndReason;
  /** Ferramenta usada pela IA ("a|b": qualquer uma; lista: todas). */
  ferramenta?: string | string[];
  /** Ferramentas que a IA não pode usar ("a|b"). */
  nao_usar?: string;
  /** Ação chamada com estes parâmetros (texto: contém, sem diferença de maiúsculas). */
  parametros?: Record<string, unknown>;
  /** Títulos dos botões da vez, juntos por " | " (expressão regular). */
  botoes?: string;
  sem_botoes?: boolean;
  deve_conter?: string;
  nao_deve_conter?: string;
  /** A resposta é texto fixo do BoaVoz (sem a IA). */
  fixo?: boolean;
  /** Saiu o pedido de licença para lembrar o número. */
  licenca?: boolean;
  /** A conversa foi passada para a equipe nesta vez. */
  equipe?: boolean;
  /** Há número lembrado pelo roteiro para o contato depois da vez. */
  numero_lembrado?: boolean;
  /** A conversa está identificada depois da vez. */
  identificado?: boolean;
  /** A conta escolhida na conversa (expressão regular contra o nome da conta). */
  conta?: string;
}

/** Campos do caso de roteiro (o resto vem de EvalCase). */
export interface RoutineCaseFields {
  /** A conversa, mensagem a mensagem. */
  turnos?: RoutineCaseTurn[];
  /** Os roteiros ligados (nomes em evals/roteiros.json); sem o campo, todos. */
  roteiros?: string[];
  /** Pessoa de evals/roteiros.json com o número já lembrado (a conversa começa pelo "Estou falando com...?"). */
  lembrado?: string;
  /** false: o canal não recebe foto (leitura de fotos desligada). Padrão: recebe no WhatsApp e no Instagram. */
  fotos?: boolean;
}

/** Quem o sistema da empresa identifica (o identity da resposta de uma ação). */
export interface BasePerson {
  external_id: string;
  name: string | null;
  accounts: Array<{ label: string | null; context: Record<string, unknown> | null }>;
}

/** Uma resposta simulada: vale a primeira cujos parâmetros (quando) e conta da conversa (conta) batem. */
export interface SimResponse {
  quando?: Record<string, unknown>;
  conta?: Record<string, unknown>;
  status: number;
  corpo?: Record<string, unknown>;
  /** Pessoa da base que vai no identity da resposta. */
  pessoa?: string;
}

export interface SimAction {
  name: string;
  description: string;
  min_level: ActionLevel;
  context_required: "none" | "signed";
  routine_only?: boolean;
  outcomes?: string[];
  params_schema: ParamsSchema;
  respostas: SimResponse[];
}

/** evals/roteiros.json: as pessoas, as ações simuladas e os roteiros dos casos. */
export interface RoutineBase {
  pessoas: Record<string, BasePerson>;
  acoes: SimAction[];
  roteiros: RoutineInput[];
}

/** O que está errado na base (os roteiros passam pela mesma conferência do painel), ou null. Pura. */
export function baseProblem(b: RoutineBase): string | null {
  for (const r of b.roteiros) {
    const p = routineProblem(r, { actions: b.acoes.map((a) => ({ name: a.name, outcomes: a.outcomes ?? [] })), others: b.roteiros.filter((o) => o !== r).map((o) => ({ id: o.name, name: o.name, keywords: o.keywords })), integrations: true });
    if (p) return `roteiro "${r.name}": ${p}`;
  }
  for (const a of b.acoes) for (const r of a.respostas) if (r.pessoa && !b.pessoas[r.pessoa]) return `ação ${a.name}: pessoa "${r.pessoa}" não existe`;
  return null;
}

export function loadRoutineBase(): RoutineBase {
  const b = JSON.parse(readFileSync(join(process.cwd(), "evals", "roteiros.json"), "utf8")) as RoutineBase;
  const p = baseProblem(b);
  if (p) throw new Error(`evals/roteiros.json: ${p}`);
  return b;
}

/** A resposta simulada para a chamada (null: nenhuma bate). Pura. */
export function simulatedResponse(a: SimAction, params: Record<string, unknown>, context: Record<string, unknown> | null): SimResponse | null {
  const fits = (want: Record<string, unknown> | undefined, got: Record<string, unknown> | null) => !want || (got !== null && Object.entries(want).every(([k, v]) => String(got[k] ?? "") === String(v)));
  return a.respostas.find((r) => fits(r.quando, params) && fits(r.conta, context)) ?? null;
}

/** O botão que o contato toca: pelo título (sem diferença de maiúsculas e acentos) ou pela posição. Pura. */
export function tapOption(c: MessageComponent | null, wanted: string): OptionItem | null {
  if (c?.type !== "options") return null;
  const w = normalizeKeyword(wanted);
  if (/^\d{1,2}$/.test(w)) return c.options[Number(w) - 1] ?? null;
  return c.options.find((o) => normalizeKeyword(o.title) === w) ?? null;
}

/** O que aconteceu numa mensagem do caso, para conferir. */
export interface TurnOutcome {
  /** O que o contato recebeu (a resposta e, depois dela, o pedido de licença). */
  messages: Array<{ text: string; component: MessageComponent | null }>;
  fixed: boolean;
  tools: string[];
  /** As chamadas de ferramenta desta vez, em uma linha cada (com os parâmetros e a recusa), para o relatório. */
  log?: string[];
  calls: Array<{ action: string; params: Record<string, unknown> }>;
  consent: boolean;
  handoff: boolean;
  run: { name: string; step: number } | null;
  ended: Array<{ status: string; reason: string | null }>;
  remembered: boolean;
  identified: boolean;
  account: string | null;
}

const titlesOf = (o: Pick<TurnOutcome, "messages">) => o.messages.flatMap((m) => (m.component?.type === "options" ? m.component.options.map((x) => x.title) : [])).join(" | ");

/** A mensagem passou no que o caso espera? Devolve o motivo quando não. Pura. */
export function checkTurn(e: TurnExpectation | undefined, o: TurnOutcome): string | null {
  if (!e) return null;
  const text = o.messages.map((m) => m.text).join("\n");
  const titles = titlesOf(o);
  if (e.fixo !== undefined && e.fixo !== o.fixed) return e.fixo ? "a resposta devia ser o texto fixo do BoaVoz (sem a IA)" : "a resposta devia vir da IA";
  if (e.roteiro === null && o.run) return `roteiro em andamento: ${o.run.name}, passo ${o.run.step} (esperado nenhum)`;
  if (e.roteiro && o.run?.name !== e.roteiro) return `roteiro em andamento: ${o.run ? o.run.name : "nenhum"} (esperado ${e.roteiro})`;
  if (e.passo !== undefined && o.run?.step !== e.passo) return `passo ${o.run?.step ?? "nenhum"} (esperado ${e.passo})`;
  if (e.fim && !o.ended.some((x) => (e.fim === "concluido" ? x.status === "completed" : x.reason === e.fim))) return `nenhum roteiro acabou como ${e.fim} (${o.ended.map((x) => x.reason ?? x.status).join(", ") || "nenhum acabou"})`;
  for (const f of Array.isArray(e.ferramenta) ? e.ferramenta : e.ferramenta ? [e.ferramenta] : []) {
    if (!f.split("|").some((t) => o.tools.includes(t))) return `não usou ${f} (ferramentas: ${o.tools.join(", ") || "nenhuma"})`;
  }
  const bad = (e.nao_usar ?? "").split("|").filter((t) => t && o.tools.includes(t));
  if (bad.length) return `usou ${bad.join(", ")}`;
  if (e.parametros) {
    const want = Object.entries(e.parametros);
    const hit = o.calls.some((c) => want.every(([k, v]) => (typeof v === "string" ? String(c.params[k] ?? "").toLowerCase().includes(v.toLowerCase()) : JSON.stringify(c.params[k]) === JSON.stringify(v))));
    if (!hit) return `nenhuma ação chamada com ${JSON.stringify(e.parametros)} (${o.calls.map((c) => `${c.action} ${JSON.stringify(c.params)}`).join("; ") || "nenhuma chamada"})`;
  }
  if (e.botoes && !new RegExp(e.botoes, "i").test(titles)) return `botões: ${titles || "nenhum"} (esperado /${e.botoes}/)`;
  if (e.sem_botoes && titles) return `não devia ter botões (${titles})`;
  if (e.deve_conter && !new RegExp(e.deve_conter, "i").test(text)) return `faltou: /${e.deve_conter}/`;
  if (e.nao_deve_conter && new RegExp(e.nao_deve_conter, "i").test(text)) return `não devia conter: /${e.nao_deve_conter}/`;
  if (e.licenca !== undefined && e.licenca !== o.consent) return e.licenca ? "não pediu licença para lembrar o número" : "pediu licença para lembrar o número sem motivo";
  if (e.equipe !== undefined && e.equipe !== o.handoff) return e.equipe ? "não passou para a equipe" : "passou para a equipe sem motivo";
  if (e.numero_lembrado !== undefined && e.numero_lembrado !== o.remembered) return e.numero_lembrado ? "o número não ficou lembrado" : "o número continua lembrado";
  if (e.identificado !== undefined && e.identificado !== o.identified) return e.identificado ? "a conversa não ficou identificada" : "a conversa continua identificada";
  if (e.conta && !(o.account && new RegExp(e.conta, "i").test(o.account))) return `conta da conversa: ${o.account ?? "nenhuma"} (esperado /${e.conta}/)`;
  return null;
}

/** A mensagem do caso numa linha (para o relatório). Pura. */
export function turnLine(t: RoutineCaseTurn, o: Pick<TurnOutcome, "messages" | "fixed" | "log"> | null): string {
  const said = t.toque ? `toque: ${t.toque}` : t.foto ? `📷 ${t.foto}${t.contato ? ` (legenda: ${t.contato})` : ""}` : `contato: ${t.contato ?? ""}`;
  if (!o) return said;
  const got = o.messages.map((m) => `${m.text.replace(/\s*\n+\s*/g, " / ")}${m.component?.type === "options" ? ` [botões: ${m.component.options.map((x) => x.title).join(" | ")}]` : ""}`).join(" + ");
  return `${said} → ${o.fixed ? "(fixo) " : ""}${got}${o.log?.length ? ` {${o.log.join("; ")}}` : ""}`;
}

/** Recusas de uma ação antes de chamar o endpoint (as outras respostas ok: false vêm da chamada). */
const REFUSED_BEFORE_CALL = new Set(["precisa_identificar", "so_no_roteiro", "faltam_dados", "rate_limited", "uma_por_vez", "indisponivel"]);

/**
 * A chamada foi recusada sem efeito (iniciar_roteiro do roteiro aberto, mostrar_opcoes no passo de
 * botões, ação sem a pessoa identificada): uma ida a mais ao modelo. Pura.
 */
export function refusedCall(name: string, output: unknown): boolean {
  const out = output && typeof output === "object" ? (output as { ok?: unknown; motivo?: unknown }) : null;
  if (out?.ok !== false) return false;
  return name.startsWith("acao_") ? REFUSED_BEFORE_CALL.has(String(out.motivo)) : true;
}

/** Uma chamada de ferramenta em uma linha: nome, parâmetros e, sem ok, o motivo. Pura. */
export function toolLogLine(name: string, input: unknown, output: unknown): string {
  const args = input && typeof input === "object" && Object.keys(input).length ? ` ${JSON.stringify(input).slice(0, 100)}` : "";
  const out = output && typeof output === "object" ? (output as { ok?: unknown; motivo?: unknown; instrucao?: unknown }) : null;
  if (out?.ok !== false) return `${name}${args}`;
  const why = out.motivo ? String(out.motivo) : typeof out.instrucao === "string" ? out.instrucao.slice(0, 80) : "";
  return `${name}${args} → ${refusedCall(name, output) ? "recusada" : "ok: false"}${why ? ` (${why})` : ""}`;
}

/** As chamadas recusadas das rodadas de roteiro, por ferramenta ("iniciar_roteiro 3 · mostrar_opcoes 1"). Pura. */
export function refusedTally(runs: Array<Pick<EvalRun, "tools">>): { total: number; line: string } {
  const counts = new Map<string, number>();
  for (const r of runs) for (const t of r.tools) if (t.endsWith("_recusada")) counts.set(t.slice(0, -"_recusada".length), (counts.get(t.slice(0, -"_recusada".length)) ?? 0) + 1);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  return { total, line: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(" · ") };
}

/* ------------------------------------------------------------------ a conversa */

class TurnProblem extends Error {}

const WA_PHONE = "5521999990000";
const IGSID = "ig-avaliacao";
const textOf = (m: UIMessage) => m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");

interface Run {
  bot: BotRow;
  db: SupabaseClient;
  base: RoutineBase;
  channel: "whatsapp" | "instagram" | "widget";
  photosOn: boolean;
  exempt: GateCategory[];
  actions: ActionRow[];
  model?: string;
  temperature?: number;
  effort?: ReasoningEffort;
  onUsage?: (u: UsageTokens) => void;
}

/** As tabelas da conversa: roteiros, pacote, conversa, contato e o número lembrado (se o caso pede). */
function seed(r: Run, c: RoutineCaseFields, ids: { conversationId: string; contactId: string }): Record<string, MemRow[]> {
  const iso = (ms: number) => new Date(ms).toISOString();
  const now = Date.now();
  const tables: Record<string, MemRow[]> = {
    routines: r.base.roteiros.filter((x) => !c.roteiros || c.roteiros.includes(x.name)).map((x) => ({ ...x, id: randomUUID(), bot_id: r.bot.id, active: true, template: null, created_at: iso(now - 3_600_000), updated_at: iso(now - 3_600_000) })),
    agency_packs: [{ agency_id: r.bot.agency_id, pack: "integracoes", ends_at: null }],
    conversations: [{ id: ids.conversationId, bot_id: r.bot.id, contact_id: ids.contactId, channel: r.channel, last_message_at: iso(now), context_since: null, takeover_at: null, ai_paused_at: null, regulated_at: null }],
    contacts: [{ id: ids.contactId, bot_id: r.bot.id, active_link_id: null, display: null }],
    contact_links: [],
    conversation_identities: [],
    routine_runs: [],
    messages: [],
  };
  const p = c.lembrado ? r.base.pessoas[c.lembrado] : null;
  if (c.lembrado && !p) throw new TurnProblem(`pessoa lembrada "${c.lembrado}" não existe em evals/roteiros.json`);
  if (p) {
    for (const a of p.accounts.length ? p.accounts : [{ label: null, context: null }]) {
      tables.contact_links.push({
        id: randomUUID(),
        bot_id: r.bot.id,
        contact_id: ids.contactId,
        channel: r.channel,
        external_id_hash: externalIdHash(p.external_id),
        external_id_enc: p.external_id,
        context_hash: contextHashOf(a.context),
        context_enc: a.context ? JSON.stringify(a.context) : null,
        display: { ...(p.name ? { name: p.name } : {}), ...(a.label ? { workspace_name: a.label } : {}) },
        source: "routine",
        pairing_id: null,
        linked_at: iso(now - 3 * 86_400_000),
        unlinked_at: null,
        last_used_at: null,
      });
    }
    tables.contacts[0].active_link_id = tables.contact_links[0].id;
  }
  return tables;
}

/** Ações da base como as do banco (consulta, ativas). */
function actionRows(base: RoutineBase, botId: string): ActionRow[] {
  return base.acoes.map((a) => ({
    id: randomUUID(),
    bot_id: botId,
    name: a.name,
    description: a.description,
    type: "query",
    min_level: a.min_level,
    context_required: a.context_required,
    outcomes: a.outcomes ?? [],
    params_schema: a.params_schema,
    supports_preview: false,
    routine_only: Boolean(a.routine_only),
    url: "https://avaliacao.invalid/acao",
    secret_enc: null,
    headers_enc: null,
    active: true,
    creates_order: false,
  }));
}

/**
 * Uma conversa do caso, mensagem a mensagem. Para na primeira mensagem que não passa (as seguintes
 * dependem dela). Erro de chamada (OpenAI) sobe.
 */
async function conversation(r: Run, c: RoutineCaseFields & { id: string }): Promise<{ run: EvalRun; failure: { reason: string; text: string } | null }> {
  const conversationId = randomUUID();
  const contactId = randomUUID();
  const tables = seed(r, c, { conversationId, contactId });
  const mem = memoryDb(tables);
  const waPhone = r.channel === "whatsapp" ? WA_PHONE : null;
  const offerRemember = r.bot.offer_remember_number !== false;
  const channelNote = r.channel === "whatsapp" ? channelNoteFor({ whatsapp: { waId: WA_PHONE } }) : r.channel === "instagram" ? channelNoteFor({ instagram: { igsid: IGSID } }) : undefined;
  const scopeLock = r.channel !== "widget";
  const notice = () => handoffNotice(r.bot.human_handoff?.hours, new Date(), r.bot.human_handoff?.away_message);
  const totals = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, costUsd: 0 };
  let msgId = 0;
  let lastAt = 0;
  // botões da última mensagem que teve botões (o toque do caso é num deles)
  let lastOptions: MessageComponent | null = null;
  const push = (m: { role: "user" | "assistant"; content: string; component?: MessageComponent | null; toolResults?: ToolResultRow[] | null; photos?: PhotoReading[] | null }) => {
    lastAt = Math.max(Date.now(), lastAt + 1);
    tables.messages.push({
      id: ++msgId,
      conversation_id: conversationId,
      role: m.role,
      content: m.content,
      components_enc: m.component ? JSON.stringify(m.component) : null,
      tool_results: m.toolResults?.length ? m.toolResults : null,
      photo_reading_enc: m.photos?.length ? JSON.stringify(m.photos) : null,
      created_at: new Date(lastAt).toISOString(),
      blocked_reason: null,
      failed_at: null,
      deleted_at: null,
      author: null,
    });
    if (m.component?.type === "options") lastOptions = m.component;
  };

  /** Uma mensagem do contato, pelo caminho do canal (gate/flow.ts). */
  const turn = async (t: RoutineCaseTurn): Promise<Omit<TurnOutcome, "run" | "ended" | "remembered" | "identified" | "account">> => {
    let text = t.contato ?? "";
    let buttonId: string | null = null;
    let photos: PhotoReading[] | null = null;
    if (t.toque) {
      const opt = tapOption(lastOptions, t.toque);
      if (!opt) throw new TurnProblem(`o botão "${t.toque}" não está na última mensagem com botões (${lastOptions ? titlesOf({ messages: [{ text: "", component: lastOptions }] }) : "nenhuma"})`);
      text = opt.title;
      buttonId = opt.id;
    } else if (t.foto) {
      photos = [{ kind: "comum", description: t.foto }];
      text = text.trim() ? `📷 (foto) ${text.trim()}` : "📷 (foto)";
    }
    push({ role: "user", content: text, photos });
    const fixed = (reply: string, component: MessageComponent | null, handoff = false) => {
      push({ role: "assistant", content: reply, component });
      return { messages: [{ text: reply, component }], fixed: true, tools: [], calls: [], consent: false, handoff };
    };

    // 1. identificação pelo roteiro: escolha da conta, licença e "Estou falando com...?"
    const idTurn = await identityPreTurn(mem, { bot: r.bot, channel: r.channel, conversationId, contactId, buttonId, text, texts: [text], consume: true, external: false, offerRemember });
    if (idTurn.kind === "fixed") return fixed(idTurn.text, idTurn.component);
    let question = text;
    let turnTexts = [text];
    let routineButton = buttonId;
    if (idTurn.kind === "resume") {
      // a IA responde agora à mensagem que esperava o "Sim, sou eu"
      question = idTurn.text;
      turnTexts = idTurn.texts.length ? idTurn.texts : [idTurn.text];
      routineButton = null;
    }
    const port = identityPort(mem, { conversationId, botId: r.bot.id, contactId, channel: r.channel, initial: await loadConversationIdentity(mem, conversationId), external: null, offerRemember });

    // 2. roteiro antes da IA: botão do passo, escolha digitada, dado conferido, foto e palavra-chave
    let handoff = false;
    const consumed = idTurn.kind === "none" && idTurn.consumed;
    const routineTurn = await routinePreTurn(mem, {
      bot: r.bot,
      conversationId,
      texts: turnTexts,
      buttonId: routineButton,
      waPhone,
      consume: !consumed,
      identity: { identified: port.identified(), choosing: port.choosing() },
      photos: idTurn.kind === "resume" ? null : photos,
      canPhotos: r.photosOn,
      checkPhoto: (asked, seen) => photoMatchesStep(asked, seen, { onUsage: r.onUsage }),
    });
    if (routineTurn.fixed) {
      if (routineTurn.fixed.kind === "handoff") return fixed(notice(), null, true);
      return fixed(routineTurn.fixed.text, null);
    }

    // 3. a IA, com a base, o histórico da conversa, o roteiro, as ações simuladas e a identidade
    const loaded = await conversationHistory(mem, conversationId, 12, 2000, (tables.conversations[0].context_since as string | null) ?? null);
    const history = idTurn.kind === "resume" ? historyUpTo(loaded, question) : loaded;
    const searched = photos ? `${question} ${t.foto ?? ""}` : question;
    const retrieval = await retrieveContext(r.db, r.bot.id, searched, null, null, postPriceRuleOf(r.bot));
    if (retrieval.embeddingUsage?.tokens) r.onUsage?.({ embeddingModel: retrieval.embeddingUsage.model, embeddingTokens: retrieval.embeddingUsage.tokens });
    const gateChannel = r.channel === "widget" ? null : r.channel;
    const gated = gateChannel ? gatePrompt(r.bot, retrieval, { channel: gateChannel, contactPhone: waPhone, gate: { age: null, exempt: r.exempt } }) : { context: retrieval.context, gateNotes: [], reminder: [] };
    const prompt = buildPrompt({
      assistantName: r.bot.name,
      clientName: r.bot.client_name,
      persona: r.bot.persona ?? {},
      context: gated.context,
      leadCapture: r.bot.lead_capture?.enabled !== false,
      agentMessages: [],
      channelNote,
      ...handoffPrompt(r.bot),
      scopeLock,
      businessTopics: r.bot.business_topics,
      gateChannel,
      gateNotes: gated.gateNotes,
      postNote: postNoteFor(r.bot, retrieval.hits, searched),
    });
    const session = routineSession(mem, {
      bot: r.bot,
      conversationId,
      waPhone,
      turn: routineTurn,
      texts: turnTexts,
      requestHandoff: async () => {
        handoff = true;
        return notice();
      },
      identity: port,
    });
    const identity = port.current();
    let actionReply: string | null = null;
    let replyComponent: MessageComponent | null = null;
    let offeredComponent: MessageComponent | null = null;
    let shown: MessageComponent | null = null;
    let shownText: string | null = null;
    let urgent = false;
    const calls: TurnOutcome["calls"] = [];
    const actionTools = await actionToolsFor(mem, {
      bot: r.bot,
      conversationId,
      channel: r.channel,
      waPhone,
      age: null,
      contactKey: waPhone ?? IGSID,
      identity,
      exempt: r.exempt,
      messageKey: `${conversationId}|${randomUUID()}`,
      onReply: (reply, comp) => {
        if (actionReply !== null) return;
        actionReply = reply;
        replyComponent = comp;
      },
      onComponent: (comp) => void (offeredComponent ??= comp),
      agencyId: r.bot.agency_id,
      ...(session ? { routine: { step: () => session.actionStep(), onResult: (a, res, d) => session.onActionResult(a, res, d), upcoming: () => session.upcoming(), stepActions: () => session.stepActions() } } : {}),
      identityNow: () => port.current(),
      simulated: {
        actions: r.actions,
        call: async (a: ActionRow, input: CallInput): Promise<CallResult> => {
          calls.push({ action: a.name, params: input.params });
          const sim = r.base.acoes.find((x) => x.name === a.name);
          const res = sim ? simulatedResponse(sim, input.params, input.context?.data ?? null) : null;
          const status = res?.status ?? 404;
          const person = res?.pessoa ? r.base.pessoas[res.pessoa] : null;
          const body = { ...(res?.corpo ?? { error: "sem resposta simulada para esta chamada" }), ...(person ? { identity: person } : {}) };
          return { ...readResponse(status, JSON.stringify(body)), callId: `call_avaliacao_${calls.length}`, httpStatus: status, durationMs: 0, warnings: [] };
        },
      },
    });
    // a ação do passo que não veio entre as ferramentas segue o destino de erro (antes do prompt)
    await session?.prepare(new Set(Object.keys(actionTools)));
    const hasActions = Object.keys(actionTools).length > 0;
    const multiStep = hasActions || Boolean(session);
    const maxSteps = multiStep ? 5 : 3;
    const modelId = r.model ?? chatModelId();
    const said = tables.messages.filter((m) => m.role === "user").map((m) => String(m.content));
    const res = await generateText({
      model: chatModel(r.model),
      system: fixedInstructions(modelId, prompt.fixed),
      allowSystemInMessages: true,
      messages: [
        { role: "system" as const, content: [prompt.variable, hasActions ? ACTIONS_PROMPT_NOTE : null, identityPromptNote(identity), idTurn.note].filter(Boolean).join("\n\n") },
        ...(gateChannel ? gatedHistory(history.slice(-12), { channel: gateChannel, contactPhone: waPhone, age: null, exempt: r.exempt }) : history.slice(-12)).map((m) => ({ role: m.role === "user" ? ("user" as const) : ("assistant" as const), content: textOf(m) })),
        // roteiro em andamento: o passo atual depois do histórico (pesa mais que ele)
        ...(session?.prompt() ? [{ role: "system" as const, content: session.prompt()! }] : []),
        { role: "system" as const, content: scopeLock ? scopeReminder(r.bot.client_name, hasActions ? [...gated.reminder, ACTIONS_PROMPT_NOTE] : gated.reminder) : offTopicReminder(r.bot.client_name) },
      ],
      ...modelCallOptions(modelId, { temperature: r.temperature ?? CHAT_TEMPERATURE, cacheKey: chatCacheKey(r.channel), effort: r.effort ?? chatReasoningEffort(modelId) }),
      stopWhen: [stepCountIs(maxSteps), () => actionReply !== null, () => shown !== null],
      prepareStep: multiStep ? ({ stepNumber }) => (stepNumber >= maxSteps - 1 ? { toolChoice: "none" as const } : undefined) : undefined,
      maxRetries: 6,
      tools: {
        ...chatTools({
          registrar_lead: async (input) => {
            const lead = checkLeadInput(input, { phone: waPhone, instagram: r.channel === "instagram", said });
            return lead.ok ? { ok: true, instrucao: leadSavedNote(r.channel) } : lead;
          },
          chamar_atendente: async ({ urgente }) => {
            session?.stop();
            await endActiveRoutine(mem, conversationId, "handoff");
            handoff = true;
            if (urgente) urgent = true;
            return { ok: true, aviso: urgente ? RISK_TEXT : notice() };
          },
          registrar_pergunta_sem_resposta: async () => ({ ok: true }),
          registrar_recusa: async () => ({ ok: true, instrucao: refusalAck(r.bot.client_name) }),
          pedir_confirmacao_18: async () => ({ ok: true }),
          mostrar_opcoes: async ({ texto, opcoes }) => {
            if (session?.blocksOptions()) return { ok: false, instrucao: "Os botões deste passo do roteiro já vão sozinhos: escreva só a pergunta, sem as opções." };
            const fromAction = offeredMatch(offeredComponent, { opcoes });
            const options = fromAction ? null : normalizeOptions(opcoes);
            if (!fromAction && !options) return { ok: false, instrucao: "Opções insuficientes: responda em texto." };
            shown ??= fromAction ?? { type: "options", options: options! };
            shownText ??= texto;
            return { ok: true, componente: shown, texto };
          },
          mostrar_link: async ({ texto, url, rotulo }) => {
            const link = offeredMatch(offeredComponent, { url }) ?? normalizeLink(url, rotulo, linkHostsFor(r.bot, retrieval.context));
            if (!link) return { ok: false, instrucao: "Esse endereço não está na base: responda em texto, sem o link." };
            shown ??= link;
            shownText ??= texto;
            return { ok: true, componente: shown, texto };
          },
        }),
        ...(session?.tools ?? {}),
        ...actionTools,
        ...port.switchTool(),
      },
    });
    r.onUsage?.(usageFrom(res.response?.modelId ?? modelId, res.totalUsage));
    const u = res.totalUsage;
    const usage = { inputTokens: u?.inputTokens ?? 0, outputTokens: u?.outputTokens ?? 0, cachedInputTokens: u?.inputTokenDetails?.cacheReadTokens ?? 0, cacheWriteTokens: u?.inputTokenDetails?.cacheWriteTokens ?? 0 };
    totals.inputTokens += usage.inputTokens;
    totals.outputTokens += usage.outputTokens;
    totals.cachedInputTokens += usage.cachedInputTokens;
    totals.cacheWriteTokens += usage.cacheWriteTokens;
    totals.costUsd += costUsd({ model: res.response?.modelId ?? modelId, ...usage }) ?? 0;
    // a chamada recusada sem efeito não conta como usada (fica no relatório como _recusada)
    const tools = res.steps.flatMap((s) => s.toolResults.map((x) => (refusedCall(x.toolName, x.output) ? `${x.toolName}_recusada` : x.toolName)));
    // ferramenta que quebrou é defeito do caminho (ou da avaliação), não da IA: vira erro de chamada
    const broken = res.steps.flatMap((s) => s.content.flatMap((p) => (p.type === "tool-error" ? [`${p.toolName}: ${p.error instanceof Error ? p.error.message : String(p.error)}`] : [])));
    if (broken.length) throw new Error(`ferramenta com erro: ${broken.join("; ")}`);
    const log = res.steps.flatMap((s) => s.toolResults.map((x) => toolLogLine(x.toolName, x.input, x.output)));

    // o que o contato recebe, como no runChat: o texto da ferramenta junto, a lista do texto vira
    // opções e os botões do passo do roteiro vêm antes dos da IA
    let written = actionReply ? res.text : joinShownText(res.text, shownText);
    if (!shown && !actionReply && !session?.component()) {
      const fromList = optionsFromText(written);
      if (fromList) {
        shown = (fromList.component.type === "options" ? offeredMatch(offeredComponent, { opcoes: fromList.component.options.map((x) => x.title) }) : null) ?? fromList.component;
        if (scopeLock) written = fromList.text;
        tools.push("opcoes_do_texto");
      }
    }
    const component = actionReply ? (replyComponent ?? session?.component() ?? null) : (session?.component() ?? shown);
    const content = withRiskText(actionReply ? [written.trim(), actionReply].filter(Boolean).join("\n\n") : written, urgent);
    const toolResults: ToolResultRow[] = res.steps.flatMap((s) => s.toolResults.map((x) => ({ name: x.toolName, ...(x.toolName.startsWith("acao_") ? { input: x.input } : {}), output: x.output })));
    push({ role: "assistant", content, component, toolResults });
    const messages = [{ text: content, component }];
    // a licença para lembrar o número, logo depois da primeira resposta sem botões
    let consent = false;
    if (!component) {
      const ask = port.consentPrompt();
      if (ask) {
        push({ role: "assistant", content: ask.text, component: ask.component });
        await markConsentAsked(mem, { conversationId, botId: r.bot.id, contactId });
        messages.push({ text: ask.text, component: ask.component });
        consent = true;
      }
    }
    return { messages, fixed: false, tools, log, calls, consent, handoff };
  };

  const lines: string[] = [];
  const allTools: string[] = [];
  let failure: { reason: string; text: string } | null = null;
  const endedBefore = new Set<unknown>();
  for (const [k, t] of (c.turnos ?? []).entries()) {
    let got: Awaited<ReturnType<typeof turn>>;
    try {
      got = await turn(t);
    } catch (e) {
      if (!(e instanceof TurnProblem)) throw e;
      failure = { reason: `mensagem ${k + 1}: ${e.message}`, text: turnLine(t, null) };
      lines.push(`${k + 1}. ${turnLine(t, null)}`);
      break;
    }
    // o estado depois da vez, no banco em memória
    const active = tables.routine_runs.find((x) => x.status === "active");
    const ended = tables.routine_runs.filter((x) => x.status !== "active" && !endedBefore.has(x.id));
    for (const x of ended) endedBefore.add(x.id);
    const { state } = await loadConversationIdentity(mem, conversationId);
    const outcome: TurnOutcome = {
      ...got,
      run: active ? { name: String(active.routine_name), step: Number(active.step_index) } : null,
      ended: ended.map((x) => ({ status: String(x.status), reason: (x.end_reason as string | null) ?? null })),
      remembered: tables.contact_links.some((l) => l.contact_id === contactId && l.source === "routine" && !l.unlinked_at),
      identified: Boolean(state),
      account: state && state.active !== null && state.accounts[state.active] ? accountLabel(state.accounts[state.active], state.active) : null,
    };
    allTools.push(...outcome.tools);
    const line = turnLine(t, outcome);
    lines.push(`${k + 1}. ${line}`);
    const why = checkTurn(t.espera, outcome);
    if (why) {
      failure = { reason: `mensagem ${k + 1}: ${why}`, text: line };
      break;
    }
  }
  return { run: { verdict: "respondeu", text: lines.join("\n"), tools: allTools, ...totals }, failure };
}

/**
 * Roda o caso de roteiro N vezes (cada vez uma conversa nova, em paralelo). Devolve as rodadas e,
 * para cada uma, o motivo da falha (null: passou). Erro de chamada vira rodada "erro".
 */
export async function evaluateRoutineCase(
  db: SupabaseClient,
  bot: BotRow,
  c: RoutineCaseFields & { id: string; canal?: "widget" | "whatsapp" | "instagram" },
  o: { runs: number; model?: string; temperature?: number; effort?: ReasoningEffort; onUsage?: (u: UsageTokens) => void; base?: RoutineBase },
): Promise<Array<{ run: EvalRun; failure: { reason: string; text: string } | null }>> {
  const base = o.base ?? loadRoutineBase();
  const channel = c.canal ?? "whatsapp";
  const r: Run = {
    bot,
    db,
    base,
    channel,
    photosOn: channel !== "widget" && c.fotos !== false,
    exempt: await botGateExemptions(db, bot.id),
    actions: actionRows(base, bot.id),
    model: o.model,
    temperature: o.temperature,
    effort: o.effort,
    onUsage: o.onUsage,
  };
  const n = Math.min(Math.max(o.runs, 1), 5);
  return Promise.all(
    Array.from({ length: n }, () =>
      conversation(r, c).catch((e: unknown) => ({ run: { verdict: "erro" as const, text: (e as Error).message, tools: [], inputTokens: 0, outputTokens: 0, costUsd: 0 }, failure: null })),
    ),
  );
}
