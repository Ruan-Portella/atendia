import type { SupabaseClient } from "@supabase/supabase-js";

/*
 * Tela única de aceite (L1): antes da primeira conexão de um canal da Meta, no painel ou pelo link
 * de conexão, o próprio negócio aceita os termos do canal e a Política de Uso Aceitável e responde
 * "Seu negócio faz alguma destas atividades?" (uma vez só, gravada no cliente).
 *   - "sim" em vender IA como produto: o WhatsApp só ativa depois da revisão da BoaVoz;
 *   - "sim" nos outros itens, ou "não sei" em qualquer um: revisão com o canal funcionando;
 *   - tudo "não": ativo.
 * Cada aceite fica registrado (negócio, canal, versão, quem, quando). Pelo link, nasce pendente e
 * é confirmado quando a Meta conclui a conexão.
 */

/** Versão dos termos do canal e da Política de Uso Aceitável. Mudou o texto? Sobe a versão: pede de novo. */
export const ACCEPTANCE_VERSION = "2026-10-02";

export type AcceptanceChannel = "whatsapp" | "instagram";
export type ActivityAnswer = "nao" | "sim" | "nao_sei";
export type ComplianceStatus = "ativo" | "em_revisao" | "aguardando_revisao" | "bloqueado";

/** A pergunta de atividades: lista curta com exemplos, tirada das listas da política, mais a IA como produto. */
export const ACTIVITIES = [
  { id: "apostas_adulto", label: "Apostas, rifas ou sorteios pagos, namoro ou conteúdo adulto" },
  { id: "tabaco_armas", label: "Cigarro, vape ou tabacaria; armas ou munição" },
  { id: "saude", label: "Remédios com receita, suplementos, óculos ou lentes, produtos médicos ou procedimentos estéticos injetáveis" },
  { id: "dinheiro", label: "Empréstimo rápido, cobrança de dívidas de terceiros, criptomoedas, câmbio ou marketing multinível" },
  { id: "organizacoes", label: "Política (partido, candidato, campanha), órgão de governo, polícia ou forças militares" },
  { id: "animais_perigosos", label: "Venda de animais vivos (canil, gatil) ou de produtos perigosos" },
  { id: "ia_produto", label: "Vender acesso a um assistente de IA: tutor com IA, “ChatGPT no WhatsApp”, textos ou imagens sob encomenda" },
] as const;
export type ActivityId = (typeof ACTIVITIES)[number]["id"];
export type ActivityAnswers = Record<ActivityId, ActivityAnswer>;

export const AI_PRODUCT: ActivityId = "ia_produto";

/** Prazo da revisão que aparece para o cliente. */
export const REVIEW_BUSINESS_DAYS = 2;

const ANSWERS = new Set<ActivityAnswer>(["nao", "sim", "nao_sei"]);

/** As respostas do formulário (campo atividade_<id>); null se faltar alguma. */
export function parseAnswers(fd: FormData): ActivityAnswers | null {
  const out: Partial<ActivityAnswers> = {};
  for (const a of ACTIVITIES) {
    const v = String(fd.get(`atividade_${a.id}`) ?? "") as ActivityAnswer;
    if (!ANSWERS.has(v)) return null;
    out[a.id] = v;
  }
  return out as ActivityAnswers;
}

/** Estado do negócio a partir das respostas. Função pura. */
export function statusFor(answers: ActivityAnswers): Exclude<ComplianceStatus, "bloqueado"> {
  if (answers[AI_PRODUCT] === "sim") return "aguardando_revisao";
  return Object.values(answers).some((v) => v !== "nao") ? "em_revisao" : "ativo";
}

/** Dia útil (segunda a sexta) N dias depois, no mesmo horário. Feriados não entram (prazo de referência). */
export function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from);
  let left = days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return d;
}

export interface Compliance {
  status: ComplianceStatus;
  answers: ActivityAnswers;
  answeredAt: string;
  answeredBy: string | null;
  reviewDueAt: string | null;
  reviewNote: string | null;
}

export async function getCompliance(db: SupabaseClient, clientId: string): Promise<Compliance | null> {
  const { data } = await db.from("business_compliance").select("status, answers, answered_at, answered_by, review_due_at, review_note").eq("client_id", clientId).maybeSingle();
  if (!data) return null;
  return {
    status: data.status as ComplianceStatus,
    answers: data.answers as ActivityAnswers,
    answeredAt: data.answered_at as string,
    answeredBy: (data.answered_by as string | null) ?? null,
    reviewDueAt: (data.review_due_at as string | null) ?? null,
    reviewNote: (data.review_note as string | null) ?? null,
  };
}

/** Aceite confirmado deste negócio, neste canal, na versão atual? */
export async function hasAcceptance(db: SupabaseClient, clientId: string, channel: AcceptanceChannel): Promise<boolean> {
  const { data } = await db.from("business_acceptances").select("id").eq("client_id", clientId).eq("channel", channel).eq("version", ACCEPTANCE_VERSION).eq("status", "confirmed").limit(1);
  return Boolean(data?.length);
}

/** Aceite pendente feito por este link (ainda esperando a Meta concluir)? */
export async function pendingLinkAcceptance(db: SupabaseClient, linkTokenHash: string): Promise<boolean> {
  const { data } = await db.from("business_acceptances").select("id").eq("link_token_hash", linkTokenHash).eq("status", "pending").limit(1);
  return Boolean(data?.length);
}

/**
 * O que impede conectar este canal agora (texto para quem tenta), ou null. Vale no painel, no link
 * e no servidor (a tela pode estar velha): bloqueado, WhatsApp aguardando a revisão da IA como
 * produto, ou falta o aceite.
 */
export function connectBlock(o: { channel: AcceptanceChannel; compliance: Compliance | null; accepted: boolean; neutral?: boolean }): string | null {
  const reviewer = o.neutral ? "da revisão" : "da revisão da BoaVoz";
  if (o.compliance?.status === "bloqueado") return `Este negócio não pode usar o ${o.channel === "whatsapp" ? "WhatsApp" : "Instagram"} por aqui${o.compliance.reviewNote ? ` (${o.compliance.reviewNote})` : ""}.`;
  if (o.channel === "whatsapp" && o.compliance?.status === "aguardando_revisao") return `O WhatsApp só ativa depois ${reviewer}${o.compliance.reviewDueAt ? `, com resposta até ${dayLabel(o.compliance.reviewDueAt)}` : ""}.`;
  if (!o.accepted) return "Falta o aceite dos termos do canal e da Política de Uso Aceitável.";
  return null;
}

export const dayLabel = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });

export interface AcceptanceInput {
  agencyId: string;
  clientId: string;
  botId: string;
  channel: AcceptanceChannel;
  via: "painel" | "link";
  /** Membro logado (painel). */
  userId?: string | null;
  name?: string | null;
  email: string;
  declaresAuthority: boolean;
  /** Pelo link: o aceite fica pendente, preso ao token, até a Meta concluir. */
  linkTokenHash?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  /** Só na primeira vez do negócio (depois a pergunta não se repete). */
  answers?: ActivityAnswers | null;
}

/** Grava o aceite (e, na primeira vez, a resposta de atividades). Devolve o estado do negócio. Service role. */
export async function recordAcceptance(db: SupabaseClient, input: AcceptanceInput, now = new Date()): Promise<ComplianceStatus> {
  let compliance = await getCompliance(db, input.clientId);
  if (!compliance && input.answers) {
    const status = statusFor(input.answers);
    const row = {
      client_id: input.clientId,
      agency_id: input.agencyId,
      answers: input.answers,
      answered_at: now.toISOString(),
      answered_by: input.name ? `${input.name} <${input.email}>` : input.email,
      status,
      review_due_at: status === "ativo" ? null : addBusinessDays(now, REVIEW_BUSINESS_DAYS).toISOString(),
    };
    // a pergunta é uma vez só: se outra aba respondeu antes, vale a primeira resposta
    const { error } = await db.from("business_compliance").insert(row);
    if (error && !/duplicate|unique/i.test(error.message)) throw new Error(`atividades não gravadas: ${error.message}`);
    compliance = await getCompliance(db, input.clientId);
  }
  const pending = input.via === "link";
  // pelo link, um aceite pendente por token (refazer o formulário troca o anterior)
  if (pending && input.linkTokenHash) await db.from("business_acceptances").delete().eq("link_token_hash", input.linkTokenHash).eq("status", "pending");
  const { error } = await db.from("business_acceptances").insert({
    agency_id: input.agencyId,
    client_id: input.clientId,
    bot_id: input.botId,
    channel: input.channel,
    version: ACCEPTANCE_VERSION,
    via: input.via,
    status: pending ? "pending" : "confirmed",
    accepted_by_user: input.userId ?? null,
    accepted_by_name: input.name ?? null,
    accepted_by_email: input.email,
    declares_authority: input.declaresAuthority,
    link_token_hash: pending ? (input.linkTokenHash ?? null) : null,
    ip: input.ip ?? null,
    user_agent: input.userAgent?.slice(0, 300) ?? null,
    confirmed_at: pending ? null : now.toISOString(),
  });
  if (error) throw new Error(`aceite não gravado: ${error.message}`);
  return compliance?.status ?? "ativo";
}

/**
 * A Meta concluiu a conexão: o aceite pendente do link vira confirmado (com a conta da Meta), ou,
 * pelo painel, a conta entra no último aceite confirmado sem conta. Devolve o e-mail de quem
 * aceitou pelo link (para a cópia), se houver.
 */
export async function confirmAcceptance(
  db: SupabaseClient,
  o: { clientId: string; channel: AcceptanceChannel; linkTokenHash?: string | null; metaAccount: string | null; metaBusinessId?: string | null; metaVerifiedName?: string | null },
): Promise<{ email: string; name: string | null } | null> {
  const meta = { meta_account: o.metaAccount, meta_business_id: o.metaBusinessId ?? null, meta_verified_name: o.metaVerifiedName ?? null };
  if (o.linkTokenHash) {
    const { data } = await db
      .from("business_acceptances")
      .update({ ...meta, status: "confirmed", confirmed_at: new Date().toISOString() })
      .eq("link_token_hash", o.linkTokenHash)
      .eq("status", "pending")
      .select("accepted_by_email, accepted_by_name");
    const row = data?.[0];
    return row ? { email: row.accepted_by_email as string, name: (row.accepted_by_name as string | null) ?? null } : null;
  }
  const { data: last } = await db.from("business_acceptances").select("id").eq("client_id", o.clientId).eq("channel", o.channel).eq("status", "confirmed").is("meta_account", null).order("id", { ascending: false }).limit(1).maybeSingle();
  if (last) await db.from("business_acceptances").update(meta).eq("id", last.id);
  return null;
}

/** Aceites pendentes do link sem conclusão da Meta em 7 dias são apagados (rotina diária). */
export async function deleteStalePending(db: SupabaseClient, now = Date.now()) {
  const { data, error } = await db.from("business_acceptances").delete().eq("status", "pending").lt("created_at", new Date(now - 7 * 86_400_000).toISOString()).select("id");
  if (error) throw error;
  return { deleted: data?.length ?? 0 };
}

/** O que impede conectar, lendo do banco (servidor: painel, link e retorno do Instagram). */
export async function connectBlockFor(db: SupabaseClient, o: { clientId: string | null; channel: AcceptanceChannel; linkTokenHash?: string | null; neutral?: boolean }): Promise<string | null> {
  if (!o.clientId) return "Ligue este chatbot a um cliente (aba Personalidade) antes de conectar.";
  const [compliance, accepted, pending] = await Promise.all([
    getCompliance(db, o.clientId),
    hasAcceptance(db, o.clientId, o.channel),
    o.linkTokenHash ? pendingLinkAcceptance(db, o.linkTokenHash) : Promise.resolve(false),
  ]);
  return connectBlock({ channel: o.channel, compliance, accepted: accepted || pending, neutral: o.neutral });
}

/** Texto da cópia do aceite enviada ao e-mail informado no link. */
export function acceptanceEmail(o: { name: string | null; clientName: string; channel: AcceptanceChannel; agencyName: string; policyUrl: string }): { subject: string; lines: string[] } {
  const channel = o.channel === "whatsapp" ? "WhatsApp" : "Instagram";
  return {
    subject: `Cópia do seu aceite: ${channel} de ${o.clientName}`,
    lines: [
      `${o.name ? `Olá, ${o.name}. ` : ""}Esta é a cópia do aceite feito na conexão do ${channel} de ${o.clientName} ao assistente de atendimento de ${o.agencyName}.`,
      "",
      `Você aceitou os termos do canal e a Política de Uso Aceitável (versão ${ACCEPTANCE_VERSION}) e declarou ter poderes para aceitar em nome do negócio.`,
      `Política de Uso Aceitável: ${o.policyUrl}`,
      "",
      "Não precisa responder este e-mail. Se não foi você, fale com quem enviou o link de conexão.",
    ],
  };
}
