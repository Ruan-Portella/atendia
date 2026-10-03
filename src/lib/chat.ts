import { convertToModelMessages, stepCountIs, streamText, tool, type UIMessage, type UIMessageChunk } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildPrompt, chatModel, chatModelId, embedText, modelCallOptions, scopeReminder, type Persona } from "./ai";
import { getPlan } from "./plans";
import { notifyHandoff, notifyLead } from "./notify";
import { findMessage, loadMessages, saveMessage, touchConversation } from "./messages";
import { isGapAnswer, isTeamCheckAnswer, looksUnanswered, recordUnanswered } from "./unanswered";
import { recordAiUsage, type UsageTokens } from "./ai-usage";
import { backNotice, contactLines, handoffNotice, hoursLines, renderAiNotice, type HumanHandoff } from "./handoff-hours";
import { RISK_TEXT, detectRisk } from "./risk";
import { isAiPaused } from "./ai-pause";
import { ageNote, type AgeStatus } from "./gate/age";
import { regulatedChannelNote, type RegulatedChannel } from "./gate/sales-channel";
import { gatedContext, gatedHistory, hiddenNote } from "./gate/context";
import { visibleText, type Segment } from "./gate/base";
import { CATEGORIES, type GateCategory } from "./gate/rules";
import { deliver } from "./send";
import { metaPhoneHash, typedPhoneHash } from "./contacts";
import { actionToolsFor } from "./action-tools";

export interface BotRow {
  id: string;
  agency_id: string;
  client_id?: string | null;
  name: string;
  client_name: string;
  client_site: string | null;
  public_key: string;
  is_demo: boolean;
  status: string;
  persona: Persona;
  appearance: { color?: string; avatar_text?: string; suggested_questions?: string[] };
  lead_capture: { enabled?: boolean; notify_email?: string | null; notify_whatsapp?: string | null };
  /** Caminho para humano: outros contatos e horário de atendimento (opcionais). */
  human_handoff?: HumanHandoff | null;
  /** "Assuntos do negócio": ampliam o nível flexível da trava de escopo. */
  business_topics?: string | null;
  /** Pausa pelo dono (botão de emergência): a IA para, a equipe responde. */
  paused_at?: string | null;
  pause_notify?: boolean | null;
  /** Onde o contato finaliza o pedido de bebida ou remédio (nunca no chat da Meta). */
  regulated_channel?: RegulatedChannel | null;
}

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function lastUserText(messages: UIMessage[]): string {
  const last = [...messages].reverse().find((m) => m.role === "user");
  if (!last) return "";
  return last.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join(" ")
    .trim();
}

/**
 * O navegador não recebe as chamadas de ferramenta (nome, WhatsApp e e-mail do lead, motivo do
 * pedido de atendente). O pedido de atendente vira só o sinal data-handoff para o widget.
 */
export function withoutToolParts() {
  // como no WhatsApp e no Instagram, só o primeiro reply da vez vai (duas ações em paralelo)
  let replied = false;
  return new TransformStream<UIMessageChunk, UIMessageChunk>({
    transform(chunk, ctrl) {
      if (!chunk.type.startsWith("tool-")) return ctrl.enqueue(chunk);
      if (chunk.type === "tool-input-available" && chunk.toolName === "chamar_atendente") ctrl.enqueue({ type: "data-handoff", data: true });
      // ação com reply: o texto exato vai para o visitante (a IA não escreve nada naquela vez)
      if (chunk.type === "tool-output-available") {
        const reply = (chunk.output as { resposta_exata?: unknown } | null)?.resposta_exata;
        if (typeof reply === "string" && reply && !replied) {
          replied = true;
          const id = `reply-${chunk.toolCallId}`;
          ctrl.enqueue({ type: "text-start", id });
          ctrl.enqueue({ type: "text-delta", id, delta: reply });
          ctrl.enqueue({ type: "text-end", id });
        }
      }
    },
  });
}

/**
 * Histórico da conversa vindo do banco, só texto, no formato do chat (o que a equipe escreveu
 * conta como resposta). Nunca do navegador: quem manda o histórico poderia inventar falas do
 * assistente ou da equipe.
 */
export async function conversationHistory(db: SupabaseClient, conversationId: string, limit = 12, maxChars = 2000): Promise<UIMessage[]> {
  // o que não chegou ao contato (barrado pela regra de estado ou recusado pelo canal) e o que ele desfez fica fora
  const rows = await loadMessages(db, { conversationId, delivered: true, newestFirst: true, limit }, ["id", "role", "content", "tool_results"] as const);
  // da mais nova para a mais antiga: a primeira vez que uma ação aparece é a última chamada dela
  const seen = new Set<string>();
  const notes = rows.map((r) => actionsNote(r.tool_results as ToolResultRow[] | null, seen));
  return rows
    .map((r, i) => {
      const text = String(r.content).slice(0, maxChars);
      // o modelo sabe o que já fez (ex.: lead registrado) e não pede os dados de novo
      const done = notes[i];
      return { id: String(r.id), role: r.role === "user" ? ("user" as const) : ("assistant" as const), parts: [{ type: "text" as const, text: done ? `${text}\n\n${done}` : text }] };
    })
    .reverse();
}

export interface ToolResultRow {
  name: string;
  /** Parâmetros (guardados só nas ações do dev, acao_<nome>). */
  input?: unknown;
  output: unknown;
}

/**
 * "(ações desta resposta: registrar_lead ok)" para o histórico do modelo; null sem ações. Ações do
 * dev (acao_<nome>): a última chamada de cada uma leva o data inteiro (a IA lembra para "e o mês
 * passado?"); as anteriores viram uma linha "ação(parâmetros) → ok". `seen` acumula da mais nova
 * para a mais antiga.
 */
export function actionsNote(results: ToolResultRow[] | null | undefined, seen = new Set<string>()): string | null {
  if (!results?.length) return null;
  const parts = results.map((r) => {
    const out = r.output as { ok?: boolean; data?: unknown; motivo?: string } | null;
    const status = out?.ok === false ? `falhou${out.motivo ? ` (${out.motivo})` : ""}` : "ok";
    if (!r.name.startsWith("acao_")) return `${r.name} ${status}`;
    const call = `${r.name}(${JSON.stringify(r.input ?? {}).slice(0, 300)}) → ${status}`;
    if (seen.has(r.name) || out?.ok === false) return call;
    seen.add(r.name);
    return `${call}: ${JSON.stringify(out?.data ?? null).slice(0, 4000)}`;
  });
  return `(ações desta resposta: ${parts.join(", ")})`;
}

/** Chave de cache da OpenAI por canal (o começo do prompt é igual em todos os bots do mesmo canal). */
export const chatCacheKey = (channel: string) => `boavoz-chat-${channel === "whatsapp" || channel === "instagram" ? channel : "site"}`;

/** Temperatura do modelo nas respostas (a avaliação mede o efeito de trocar). */
export const CHAT_TEMPERATURE = 0.3;

export interface ContextHit {
  content: string;
  metadata: { title?: string; url?: string };
  similarity: number;
  /** Classificação do portão (parte 6): versão, frases com as categorias e o resumo. */
  gate_version?: string | null;
  gate_segments?: Segment[] | null;
  gate_categories?: GateCategory[] | null;
}

/** Texto do contexto a partir dos trechos (o mesmo formato na busca e no portão). */
export function formatContext(hits: Array<Pick<ContextHit, "content" | "metadata">>): string {
  return hits.map((r, i) => `[${i + 1}] ${r.metadata?.title ? r.metadata.title + "\n" : ""}${r.content}`).join("\n\n---\n\n");
}

/** Trechos da base mais parecidos com a pergunta (busca exata no bot) e o texto do contexto. */
export async function retrieveContext(db: SupabaseClient, botId: string, question: string) {
  let context = "";
  const used: Array<{ title?: string; url?: string }> = [];
  let hits: ContextHit[] = [];
  let embeddingUsage: Awaited<ReturnType<typeof embedText>>["usage"] | null = null;
  if (question) {
    const { embedding, usage } = await embedText(question);
    embeddingUsage = usage;
    const { data } = await db.rpc("match_chunks", { p_bot_id: botId, p_query: JSON.stringify(embedding), p_count: 6, p_min_similarity: 0.15 });
    hits = (data ?? []) as ContextHit[];
    context = formatContext(hits);
    for (const r of hits) {
      const key = r.metadata?.url ?? r.metadata?.title;
      // fontes com o mesmo título (páginas diferentes do mesmo site) aparecem uma vez só
      if (key && !used.some((u) => (u.url ?? u.title) === key || (r.metadata?.title && u.title === r.metadata.title))) used.push({ title: r.metadata?.title, url: r.metadata?.url });
    }
  }
  return { context, used, hits, embeddingUsage };
}

/** Regra do canal no prompt (WhatsApp com ou sem telefone, Instagram; o site não tem). */
export function channelNoteFor(opts: { whatsapp?: { waId: string; profileName?: string | null }; instagram?: { igsid: string } }): string | undefined {
  const wa = opts.whatsapp;
  const waPhone = wa && /^\d+$/.test(wa.waId) ? wa.waId : null;
  return wa && !waPhone
    ? `A conversa é pelo WhatsApp, mas o número da pessoa não aparece para você: para registrar o contato, peça nome e telefone. Use a formatação do WhatsApp (*negrito*), nada de markdown. Mensagens que começam com 🎤 são áudios da pessoa já transcritos: responda normalmente, por texto, sem comentar que era áudio.`
    : wa
    ? `A conversa é pelo WhatsApp: você já tem o número da pessoa (${wa.waId}), então não peça WhatsApp, peça só o nome.${wa.profileName ? ` O nome no perfil do WhatsApp dela é "${wa.profileName}", mas pode não ser o nome real: não chame a pessoa por ele; quando for registrar o contato, pergunte se pode usar esse nome (ex.: "Posso anotar seu nome como ${wa.profileName}?").` : ""} Use a formatação do WhatsApp (*negrito*), nada de markdown. Mensagens que começam com 🎤 são áudios da pessoa já transcritos: responda normalmente, por texto, sem comentar que era áudio.`
    : opts.instagram
      ? "A conversa é pelo Direct do Instagram. Você não sabe o WhatsApp da pessoa: para registrar o contato, peça nome e WhatsApp. O Instagram não tem formatação: escreva texto simples, sem asteriscos nem markdown, em mensagens curtas. Mensagens que começam com 🎤 são áudios da pessoa já transcritos: responda normalmente, por texto, sem comentar que era áudio."
      : undefined;
}

/** Autor das mensagens fixas da plataforma (confirmações, avisos): não contam como fala da IA. */
export const SYSTEM_AUTHOR = "sistema";

/**
 * Aviso de IA (escolha da BoaVoz, por transparência), como prefixo da resposta, nunca como
 * mensagem própria (cada mensagem a mais é cobrada do negócio pela Meta):
 * - primeira resposta da IA na conversa (conversa nova também depois de 24 h sem mensagem):
 *   o aviso editável da aba Atendimento (padrão "Sou {nome}, assistente virtual de {empresa}.")
 * - a conversa voltou de um atendente (ou de alguém no celular): "Voltei! Sou {nome}, …"
 * null = a IA já falou por último, sem aviso.
 */
export async function aiDisclosure(db: SupabaseClient, bot: Pick<BotRow, "name" | "client_name" | "human_handoff">, conversationId: string): Promise<string | null> {
  const [last, ai] = await Promise.all([
    findMessage(db, { conversationId, notRole: "user", notAuthor: SYSTEM_AUTHOR, newestFirst: true }, ["role"] as const),
    findMessage(db, { conversationId, roles: ["assistant"], notAuthor: SYSTEM_AUTHOR }, ["id"] as const),
  ]);
  // a IA nunca falou nesta conversa (mesmo que a equipe tenha aberto com um modelo): apresenta
  if (!ai) return renderAiNotice(bot.human_handoff?.ai_notice, bot);
  if (last?.role === "agent") return backNotice(bot.name);
  return null;
}

/**
 * Pedido de atendente (ferramenta da IA ou botão "Falar com uma pessoa" do widget): marca a
 * conversa e avisa a equipe na primeira vez (ou de novo, se o atendimento anterior foi encerrado).
 * Devolve o aviso ao contato: fora do horário, diz quando a equipe volta; nunca promete resposta imediata.
 */
export async function requestHandoff(db: SupabaseClient, bot: BotRow, conversationId: string, reason: string): Promise<string> {
  const { data: updated } = await db
    .from("conversations")
    .update({ needs_human: true, handoff_requested_at: new Date().toISOString(), handled_at: null })
    .eq("id", conversationId)
    .or("handoff_requested_at.is.null,handled_at.not.is.null")
    .select("id");
  if (updated?.length) notifyHandoff({ db, bot, conversationId, reason }).catch(() => {});
  else await db.from("conversations").update({ needs_human: true, handled_at: null }).eq("id", conversationId);
  return handoffNotice(bot.human_handoff?.hours, new Date(), bot.human_handoff?.away_message);
}

/** Garante o texto fixo de risco à vida na resposta quando a IA chamou atendente com urgência. */
export function withRiskText(answer: string, urgent: boolean): string {
  if (!urgent || answer.includes("188")) return answer;
  return answer.trim() ? `${answer.trim()}\n\n${RISK_TEXT}` : RISK_TEXT;
}

/**
 * Risco à vida com a IA fora (atendente assumiu, alguém respondeu pelo celular, modo só humano):
 * dicionário + checagem barata de IA. Se confirmar, vira pedido de atendente urgente (equipe
 * avisada com destaque) e o contato recebe o texto fixo, a não ser que alguém da equipe tenha
 * escrito nos últimos 10 minutos (aí só o alerta). Devolve true se agiu.
 */
export async function handleRiskWithoutAi(
  db: SupabaseClient,
  bot: BotRow,
  conversationId: string,
  texts: Array<string | null>,
  /** Transporte do canal (devolve o id da mensagem na Meta); a camada única de envio confere e registra. */
  send: (text: string) => Promise<string | null>,
  channel: "whatsapp" | "instagram",
): Promise<boolean> {
  const text = texts.filter(Boolean).join("\n");
  const onUsage = (u: UsageTokens) => void recordAiUsage(db, { agencyId: bot.agency_id, botId: bot.id, conversationId, kind: "classificacao", channel, ...u });
  if (!text || !(await detectRisk(text, onUsage))) return false;
  const now = new Date().toISOString();
  await db.from("conversations").update({ needs_human: true, handoff_requested_at: now, handoff_urgent_at: now, handled_at: null }).eq("id", conversationId);
  notifyHandoff({ db, bot, conversationId, reason: text.slice(0, 300), urgent: true }).catch(() => {});
  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const recentAgent = await findMessage(db, { conversationId, roles: ["agent"], createdAfter: since }, ["id"] as const);
  if (!recentAgent) {
    // texto fixo de emergência: sai com gente atendendo (degraus 3 a 5), nunca com o canal bloqueado
    await deliver(db, { botId: bot.id, channel, conversationId, kind: "sistema", record: { insert: { role: "assistant", content: RISK_TEXT, author: SYSTEM_AUTHOR } }, transport: () => send(RISK_TEXT) });
  }
  return true;
}

/** Estado do portão para uma resposta nos canais da Meta. */
export interface GateState {
  age: AgeStatus;
  /** Instrução da entrada (ex.: não citar o item proibido que também foi pedido). */
  instruction?: string;
  /** A pergunta envolve item proibido ou regulamentado: as linhas do portão vão também no lembrete final. */
  remind?: boolean;
  /** Categorias liberadas pelo BoaVoz para este chatbot ("isto não é {categoria}"). */
  exempt?: GateCategory[];
}

/** Linhas do portão para o prompt: idade, itens ocultos, canal de venda dos itens 18+ e instrução da entrada. */
export function gateNotesFor(bot: Pick<BotRow, "regulated_channel" | "human_handoff">, gate?: GateState, hidden: GateCategory[] = []): string[] {
  const age = gate?.age ?? null;
  const hiddenLine = hiddenNote(hidden, age);
  // idade não confirmada e nenhuma bebida ou remédio na base desta pergunta: não há o que proteger,
  // e a instrução de pedir 18+ só atrapalhava ("qual remédio eu tomo?" virava pergunta de idade
  // em vez da regra de saúde)
  const regulatedInBase = hidden.some((c) => CATEGORIES[c].level === "regulamentado");
  const relevant = age !== null || regulatedInBase || Boolean(gate?.remind);
  return [
    ...(age !== null || regulatedInBase ? [ageNote(age)] : []),
    ...(hiddenLine ? [hiddenLine] : []),
    ...(relevant ? [regulatedChannelNote(bot.regulated_channel, bot.human_handoff?.address)] : []),
    ...(gate?.instruction ? [gate.instruction] : []),
  ];
}

/** O que o portão muda no prompt: a base sem os itens barrados, as linhas do portão e o lembrete final. */
export function gatePrompt(bot: Pick<BotRow, "regulated_channel" | "human_handoff">, retrieval: { context: string; hits: ContextHit[] }, o: { channel: "whatsapp" | "instagram"; contactPhone: string | null; gate?: GateState }) {
  const who = { channel: o.channel, contactPhone: o.contactPhone, age: o.gate?.age ?? null, exempt: o.gate?.exempt };
  // trechos classificados pela IA (parte 6) já saem sem o que esta pessoa não pode ver
  const parts = retrieval.hits.map((h) => visibleText(h, who));
  const base = retrieval.hits.length ? formatContext(retrieval.hits.map((h, i) => ({ ...h, content: parts[i].text }))) : retrieval.context;
  // o dicionário corta por cima (as duas marcações valem juntas)
  const view = gatedContext(base, who);
  const hidden = [...new Set([...parts.flatMap((p) => p.hidden), ...view.hidden])];
  const gateNotes = gateNotesFor(bot, o.gate, hidden);
  return { context: view.context, gateNotes, reminder: o.gate?.remind ? gateNotes : [] };
}

/** Contatos e horário da equipe para o prompt (caminho para humano). */
export function handoffPrompt(bot: Pick<BotRow, "human_handoff">) {
  return { humanContacts: contactLines(bot.human_handoff), hours: hoursLines(bot.human_handoff?.hours) };
}

type ToolExec<I> = (input: I) => Promise<{ ok: boolean; aviso?: string }>;

export type RefusalLevel = "fixo" | "flexivel";

/**
 * As ferramentas do assistente (descrição e formato iguais para o chat de verdade e para a
 * avaliação); quem chama decide o que cada uma faz.
 */
export function chatTools(exec: {
  registrar_lead: ToolExec<{ nome: string; whatsapp?: string; email?: string; interesse?: string }>;
  chamar_atendente: ToolExec<{ motivo?: string; urgente?: boolean }>;
  registrar_pergunta_sem_resposta: ToolExec<{ pergunta: string }>;
  registrar_recusa: ToolExec<{ nivel: RefusalLevel; pedido?: string }>;
  pedir_confirmacao_18: ToolExec<Record<string, never>>;
}) {
  return {
    registrar_lead: tool({
      description: "Registra o contato de um visitante interessado (nome e WhatsApp ou e-mail) para a equipe retornar.",
      inputSchema: z.object({
        nome: z.string().min(2),
        whatsapp: z.string().optional(),
        email: z.string().optional(),
        interesse: z.string().optional().describe("o que a pessoa quer: agendar, orçamento, etc."),
      }),
      execute: exec.registrar_lead,
    }),
    chamar_atendente: tool({
      description: "Avisa a equipe que o visitante quer falar com uma pessoa. Use quando ele pedir atendente, humano ou alguém da equipe, ou com urgente=true quando houver risco à vida ou à integridade.",
      inputSchema: z.object({
        motivo: z.string().optional().describe("resumo curto do que a pessoa precisa"),
        urgente: z.boolean().optional().describe("true só se a pessoa indicar risco à vida ou à integridade (suicídio, autolesão, emergência médica, violência)"),
      }),
      execute: exec.chamar_atendente,
    }),
    registrar_pergunta_sem_resposta: tool({
      description: "Registra uma pergunta que não pôde ser respondida com o conteúdo disponível, para a empresa completar depois.",
      inputSchema: z.object({ pergunta: z.string().min(3) }),
      execute: exec.registrar_pergunta_sem_resposta,
    }),
    // sempre na lista (ordem fixa ajuda o cache do provedor); só é usada com a trava de escopo
    registrar_recusa: tool({
      description: "Registra que você recusou um pedido fora do escopo do atendimento. nivel \"fixo\": tarefa sem relação com o negócio ou executar o serviço que a empresa vende; \"flexivel\": assunto distante do negócio. Chame junto com a sua resposta de recusa.",
      inputSchema: z.object({ nivel: z.enum(["fixo", "flexivel"]), pedido: z.string().optional().describe("resumo curto do que foi pedido") }),
      execute: exec.registrar_recusa,
    }),
    // sempre na lista (ordem fixa ajuda o cache do provedor); só tem efeito nos canais da Meta
    pedir_confirmacao_18: tool({
      description: "Pergunta à pessoa se ela tem 18 anos ou mais, com botões Sim e Não (barreira de idade). Use quando a idade não foi confirmada e ela pede bebida alcoólica ou remédio, ou você ia mostrar esses itens. Depois de chamar, não escreva mais nada: a pergunta vai sozinha.",
      inputSchema: z.object({}),
      execute: exec.pedir_confirmacao_18,
    }),
  };
}

/** Por que a IA está parada para esta agência (modo só humano), ou null se pode responder. */
export type AiBlockReason = "trial_expired" | "quota_exceeded" | "client_quota_exceeded" | "cancelled" | "paused" | "bot_paused";

/**
 * Conferido em TODA mensagem (não só na conversa nova): IA pausada pelo backoffice, plano
 * cancelado ou teste vencido param a IA também nas conversas abertas. A cota é por atendimento,
 * conferida antes de chamar a IA (openAtendimento): o atendimento aberto segue até o fim.
 */
export async function aiBlockedReason(db: SupabaseClient, agencyId: string): Promise<AiBlockReason | null> {
  if (await isAiPaused(db, agencyId)) return "paused";
  const { data: agency } = await db.from("agencies").select("plan, trial_ends_at").eq("id", agencyId).maybeSingle();
  const plan = getPlan(agency?.plan ?? "trial");
  if (plan.id === "cancelado") return "cancelled";
  if (plan.id === "trial" && agency?.trial_ends_at && new Date(agency.trial_ends_at) < new Date()) return "trial_expired";
  return null;
}

/** Motivo do pedido de atendente automático, para a equipe. */
export const AI_BLOCK_LABEL: Record<AiBlockReason, string> = {
  quota_exceeded: "Assistente parado: a cota de atendimentos do mês acabou.",
  client_quota_exceeded: "Assistente parado: este cliente chegou ao limite de atendimentos do mês que a agência definiu.",
  trial_expired: "Assistente parado: o teste grátis venceu.",
  cancelled: "Assistente parado: a assinatura foi cancelada.",
  paused: "Assistente pausado pela equipe BoaVoz: as mensagens ficam aqui para a sua equipe responder.",
  bot_paused: "Assistente pausado por vocês (botão de emergência): as mensagens ficam aqui para a sua equipe responder.",
};

/** Texto fixo do modo só humano (Textos legais, seção 6): uma vez por conversa, sem prometer prazo. */
export const HUMAN_ONLY_NOTICE = "Deixei sua mensagem registrada, e nossa equipe responde por aqui assim que possível.";

/**
 * IA fora da conversa (bot pausado pelo dono ou modo só humano): vira pedido de atendente e a
 * equipe é avisada na primeira vez. O aviso ao contato é da regra de estado (conversation-mode).
 */
export async function enterHumanOnly(db: SupabaseClient, bot: BotRow, conversationId: string, reason: AiBlockReason) {
  const { data: updated } = await db
    .from("conversations")
    .update({ needs_human: true, handoff_requested_at: new Date().toISOString(), handled_at: null })
    .eq("id", conversationId)
    .or("handoff_requested_at.is.null,handled_at.not.is.null")
    .select("id");
  if (updated?.length) notifyHandoff({ db, bot, conversationId, reason: AI_BLOCK_LABEL[reason] }).catch(() => {});
}

/**
 * Abre uma conversa nova. Não conta na cota: quem conta é o atendimento (openAtendimento, antes
 * de chamar a IA). Lança "trial_expired" quando o teste venceu.
 */
export async function openConversation(
  db: SupabaseClient,
  bot: Pick<BotRow, "id" | "agency_id">,
  opts: { channel: string; visitorId?: string | null; waId?: string; igsid?: string; contactId?: string | null },
): Promise<string> {
  const { data: agency } = await db.from("agencies").select("plan, trial_ends_at").eq("id", bot.agency_id).single();
  const plan = getPlan(agency?.plan ?? "trial");
  if (plan.id === "trial" && agency?.trial_ends_at && new Date(agency.trial_ends_at) < new Date()) {
    throw new Error("trial_expired");
  }
  const { data: conv, error } = await db
    .from("conversations")
    .insert({ bot_id: bot.id, visitor_id: opts.visitorId ?? null, channel: opts.channel, ...(opts.waId ? { wa_id: opts.waId } : {}), ...(opts.igsid ? { ig_id: opts.igsid } : {}), ...(opts.contactId ? { contact_id: opts.contactId } : {}) })
    .select("id")
    .single();
  if (error || !conv) throw new Error("Não foi possível abrir a conversa.");
  return conv.id as string;
}

/**
 * Executa uma rodada de chat para um bot: recupera contexto (RAG), responde em streaming,
 * registra lead/pergunta sem resposta/pedido de atendente via ferramentas e persiste as mensagens.
 */
export async function runChat(opts: {
  db: SupabaseClient;
  bot: BotRow;
  messages: UIMessage[];
  conversationId: string | null;
  visitorId: string | null;
  channel: "widget" | "demo" | "painel" | "whatsapp" | "instagram";
  /** Contato do WhatsApp: o número já é conhecido, o assistente só pede o nome. */
  whatsapp?: { waId: string; profileName?: string | null };
  /** Contato do Instagram Direct (IGSID). O WhatsApp da pessoa não é conhecido. */
  instagram?: { igsid: string };
  /** Evento da fila (inbound_events): a pergunta é gravada uma vez só, mesmo no reprocesso. */
  questionKey?: string;
  /** false: a pergunta já está gravada (ex.: depois do "Sim" do 18+, a IA responde à pergunta de antes). */
  storeQuestion?: boolean;
  /** Busca já feita (o portão da entrada usa o mesmo resultado; não busca duas vezes). */
  retrieval?: Awaited<ReturnType<typeof retrieveContext>>;
  /** Portão (canais da Meta): idade do contato e instrução da entrada. */
  gate?: GateState;
}) {
  const { db, bot, messages, channel } = opts;

  // 1. Conversa (cria na primeira mensagem; a cota é do atendimento, conferida por quem chama)
  const conversationId = opts.conversationId ?? (await openConversation(db, bot, { channel, visitorId: opts.visitorId, waId: opts.whatsapp?.waId, igsid: opts.instagram?.igsid }));

  // 2. Recuperação de contexto
  const question = lastUserText(messages);
  const retrieval = opts.retrieval ?? (await retrieveContext(db, bot.id, question));
  const { context, used, embeddingUsage } = retrieval;

  const leadEnabled = bot.lead_capture?.enabled !== false;
  // o que um atendente humano já escreveu (quando a conversa volta para o assistente)
  const agentRows = opts.conversationId ? await loadMessages(db, { conversationId, roles: ["agent"], newestFirst: true, limit: 6 }, ["content"] as const) : [];
  const agentMessages = agentRows.map((r) => r.content.slice(0, 500)).reverse();
  const wa = opts.whatsapp;
  const waPhone = wa && /^\d+$/.test(wa.waId) ? wa.waId : null;
  const channelNote = channelNoteFor(opts);
  // trava de escopo só nos canais da Meta (no widget do site não há trava)
  const scopeLock = channel === "whatsapp" || channel === "instagram";
  // no chat do site de um bot que também atende no WhatsApp: nunca mandar pedir item 18+ por lá
  const widgetWithWhatsapp = !scopeLock && Boolean((await db.from("whatsapp_channels").select("bot_id").eq("bot_id", bot.id).is("disconnected_at", null).maybeSingle()).data);
  // portão: a base sem os itens barrados para esta pessoa e as linhas do portão no prompt
  const gated = scopeLock ? gatePrompt(bot, retrieval, { channel: channel as "whatsapp" | "instagram", contactPhone: waPhone, gate: opts.gate }) : { context, gateNotes: [], reminder: [] };
  // regras primeiro (iguais em toda a plataforma: cache da OpenAI); o que é deste bot e desta conversa depois
  const prompt = buildPrompt({ assistantName: bot.name, clientName: bot.client_name, persona: bot.persona ?? {}, context: gated.context, leadCapture: leadEnabled, agentMessages, channelNote, ...handoffPrompt(bot), scopeLock, businessTopics: bot.business_topics, gateChannel: scopeLock ? (channel as "whatsapp" | "instagram") : null, widgetWithWhatsapp, gateNotes: gated.gateNotes });
  const convId = conversationId;

  // 3. Persiste a pergunta do visitante
  if (question && opts.storeQuestion !== false) {
    // com a chave do evento, o reprocesso não grava a mesma pergunta duas vezes
    // erro aqui sobe: na fila, o evento volta e é tentado de novo (a mensagem não some)
    await saveMessage(db, { conversation_id: convId, role: "user", content: question, inbound_key: opts.questionKey ?? null });
  }

  let unansweredRecorded = false;
  const refusalIds: number[] = [];
  let urgentCalled = false;
  let askAgeCalled = false;
  // resolve quando a resposta já está gravada (quem não usa o stream, como o WhatsApp, espera por ele)
  // resolve com o id da resposta gravada (null se não houve texto ou deu erro)
  let markSaved!: (id?: number | null) => void;
  const saved = new Promise<number | null>((resolve) => (markSaved = (id) => resolve(id ?? null)));
  let savedId: number | null = null;
  // ações do bot (Integrações): ferramentas acao_<nome>; com reply, o texto exato encerra a vez
  let actionReply: string | null = null;
  const actionTools = await actionToolsFor(db, {
    bot,
    conversationId: convId,
    channel,
    waPhone,
    age: opts.gate?.age ?? null,
    contactKey: opts.whatsapp?.waId ?? opts.instagram?.igsid ?? null,
    exempt: opts.gate?.exempt,
    messageKey: opts.questionKey ?? `${convId}|${question}`,
    onReply: (r) => void (actionReply ??= r),
  });
  // até 5 passos com ações (o último sem ferramentas, para sempre sair texto); sem ações, 3 como antes
  const hasActions = Object.keys(actionTools).length > 0;
  const maxSteps = hasActions ? 5 : 3;
  const result = streamText({
    model: chatModel(),
    system: prompt.fixed,
    // com a trava de escopo, o lembrete vai depois da última mensagem (pesa mais que o histórico);
    // o SDK recusa mensagem de sistema no meio da conversa sem allowSystemInMessages
    allowSystemInMessages: true,
    messages: [
      { role: "system" as const, content: prompt.variable },
      // respostas antigas do bot com o mesmo corte da base (sem o "Sim", nada de item 18+ do histórico)
      ...(await convertToModelMessages(scopeLock ? gatedHistory(messages.slice(-12), { channel: channel as "whatsapp" | "instagram", contactPhone: waPhone, age: opts.gate?.age ?? null, exempt: opts.gate?.exempt }) : messages.slice(-12))),
      ...(scopeLock ? [{ role: "system" as const, content: scopeReminder(bot.client_name, gated.reminder) }] : []),
    ],
    ...modelCallOptions(chatModelId(), { temperature: CHAT_TEMPERATURE, cacheKey: chatCacheKey(channel) }),
    stopWhen: [stepCountIs(maxSteps), () => actionReply !== null],
    prepareStep: hasActions ? ({ stepNumber }) => (stepNumber >= maxSteps - 1 ? { toolChoice: "none" as const } : undefined) : undefined,
    // limite de tokens por minuto da OpenAI (pico): o SDK tenta de novo com espera crescente
    maxRetries: 4,
    tools: {
    ...chatTools({
      registrar_lead: async (input) => {
        if (!leadEnabled) return { ok: false };
        const { data: lead } = await db
          .from("leads")
          .insert({ bot_id: bot.id, conversation_id: convId, name: input.nome, phone: input.whatsapp ?? waPhone, phone_hash: input.whatsapp ? typedPhoneHash(input.whatsapp) : metaPhoneHash(waPhone), email: input.email ?? null, notes: input.interesse ?? null })
          .select("id")
          .single();
        notifyLead({ db, bot, lead: { id: lead?.id, ...input } }).catch(() => {});
        return { ok: true };
      },
      chamar_atendente: async ({ motivo, urgente }) => {
        if (urgente) {
          // risco à vida: aviso destacado à equipe e o texto fixo com os telefones de emergência
          urgentCalled = true;
          await db.from("conversations").update({ needs_human: true, handoff_requested_at: new Date().toISOString(), handoff_urgent_at: new Date().toISOString(), handled_at: null }).eq("id", convId);
          notifyHandoff({ db, bot, conversationId: convId, reason: motivo ?? question, urgent: true }).catch(() => {});
          return { ok: true, aviso: RISK_TEXT };
        }
        return { ok: true, aviso: await requestHandoff(db, bot, convId, motivo ?? question) };
      },
      registrar_pergunta_sem_resposta: async ({ pergunta }) => {
        unansweredRecorded = true;
        await recordUnanswered(db, bot.id, convId, pergunta);
        return { ok: true };
      },
      registrar_recusa: async ({ nivel, pedido }) => {
        // registro próprio, separado das perguntas sem resposta (que são lacuna na base)
        const { data: row, error } = await db.from("scope_refusals").insert({ bot_id: bot.id, conversation_id: convId, level: nivel, request: pedido?.slice(0, 300) ?? null }).select("id").single();
        if (error) console.error("recusa não registrada", error.message);
        else refusalIds.push(row.id as number);
        return { ok: true };
      },
      pedir_confirmacao_18: async () => {
        // o canal troca a resposta pela pergunta fixa com botões (só se a idade não foi confirmada)
        askAgeCalled = true;
        return { ok: true };
      },
    }),
    ...actionTools,
  },
    onError: () => markSaved(),
    onFinish: async ({ text, steps, totalUsage, response }) => {
      // custo da resposta inteira (todos os passos + embedding da pergunta), sem atrasar nada
      void recordAiUsage(db, {
        agencyId: bot.agency_id,
        botId: bot.id,
        conversationId: convId,
        kind: "resposta",
        channel,
        model: response?.modelId,
        inputTokens: totalUsage?.inputTokens ?? 0,
        cachedInputTokens: totalUsage?.inputTokenDetails?.cacheReadTokens ?? 0,
        outputTokens: totalUsage?.outputTokens ?? 0,
        embeddingModel: embeddingUsage?.model,
        embeddingTokens: embeddingUsage?.tokens ?? 0,
      });
      try {
        // "Não tenho essa informação" e "vou confirmar com a equipe" são pergunta do negócio que falta
        // na base, não recusa: a IA às vezes chama registrar_recusa junto (ex.: depois de uma recusa
        // na conversa); desfaz a recusa
        const refusalStands = refusalIds.length > 0 && !isGapAnswer(text);
        if (refusalIds.length && !refusalStands) await db.from("scope_refusals").delete().in("id", refusalIds);
        // o modelo disse que não sabe mas esqueceu a ferramenta: registra do mesmo jeito
        if (!actionReply && !unansweredRecorded && !refusalStands && question && text && (looksUnanswered(text) || isTeamCheckAnswer(text))) await recordUnanswered(db, bot.id, convId, question);
        // com reply de ação, o que fica gravado é o texto exato (no WhatsApp e no Instagram o canal
        // ainda troca pelo que saiu de fato, depois do portão)
        const content = actionReply ? [text.trim(), actionReply].filter(Boolean).join("\n\n") : text;
        if (content) {
          const toolResults: ToolResultRow[] = steps.flatMap((s) => s.toolResults.map((t) => ({ name: t.toolName, ...(t.toolName.startsWith("acao_") ? { input: t.input } : {}), output: t.output })));
          savedId = await saveMessage(db, { conversation_id: convId, role: "assistant", content, sources: used.length ? used : null, tool_results: toolResults.length ? toolResults : null }).catch((e) => {
            console.error("chat: resposta não gravada", (e as Error).message);
            return null;
          });
        }
        await touchConversation(db, convId, { visitorSeen: true });
      } finally {
        markSaved(savedId);
      }
    },
  });

  // urgent(): a IA chamou atendente por risco à vida (o canal garante o texto fixo na resposta)
  // actionReply(): reply exato de uma ação (o canal confere no portão antes de enviar)
  return { result, conversationId: convId, sources: used, saved, urgent: () => urgentCalled, askAge: () => askAgeCalled, actionReply: () => actionReply };
}
