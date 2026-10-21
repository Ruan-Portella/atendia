import type { SupabaseClient } from "@supabase/supabase-js";
import { can, type AgencyRole, type Permission } from "./roles";
import { appUrl } from "./utils";
import { firstExceeded } from "./rate-limit";
import { activeSuppressions, blocks, suppressionScope } from "./suppression";
import { TEMPLATE_LANGUAGE, createTemplate, listTemplates, renderTemplate, sendTemplate, type Template, type TemplateChannel } from "./whatsapp-templates";
import { deliver } from "./send";
import { SYSTEM_AUTHOR } from "./chat";
import { assistantChannel, assistantConversationFor, confirmedTeamNumbers, templateValue, type NoticeTemplateStatus } from "./team-whatsapp";

/*
 * Avisos para a equipe no WhatsApp (leva de 19/10/2026, parte 3): pelo número do assistente da
 * BoaVoz, para quem confirmou o número e deixou o aviso ligado. Quem recebe segue o papel e o
 * escopo, como os e-mails (atendimento e lead: quem atende o chatbot; canal e cota: quem configura;
 * pagamento: o dono). Sem o conteúdo da conversa (minimização): só o que aconteceu e o botão para
 * a página certa do painel. Cada aviso sai por um modelo de utilidade aprovado (dentro da janela de
 * 24 horas ele não é cobrado), uma vez por acontecimento.
 */

export type NoticeKind = "urgente" | "atendente" | "lead" | "canal" | "pagamento" | "cota";

export interface NoticeKindInfo {
  /** Como a pessoa vê o aviso em Meu perfil. */
  label: string;
  template: string;
  body: string;
  examples: string[];
  button: string;
  /** Quem pode receber (o papel no painel). */
  permission: Permission;
  /** Um aviso por acontecimento nesse prazo (a mesma conversa, o mesmo chatbot, a mesma agência). */
  dedupeSeconds: number;
}

const DAY = 86_400;

export const NOTICE_KINDS: Record<NoticeKind, NoticeKindInfo> = {
  urgente: {
    label: "Atendimento urgente (possível risco à vida)",
    template: "boavoz_aviso_urgente",
    body: "Atendimento urgente no chatbot {{1}}: a IA chamou a equipe por um possível risco à vida. Veja a conversa no painel.",
    examples: ["Bar do Zé (Zé Lanches)"],
    button: "Abrir a conversa",
    permission: "attend",
    dedupeSeconds: DAY,
  },
  atendente: {
    label: "Pedido de atendente",
    template: "boavoz_aviso_atendente",
    body: "Pedido de atendente no chatbot {{1}}: um contato quer falar com a equipe. Veja a conversa no painel.",
    examples: ["Bar do Zé (Zé Lanches)"],
    button: "Abrir a conversa",
    permission: "attend",
    dedupeSeconds: DAY,
  },
  lead: {
    label: "Lead novo",
    template: "boavoz_aviso_lead",
    body: "Lead novo no chatbot {{1}}: um contato deixou um pedido para a equipe. Veja os dados no painel.",
    examples: ["Bar do Zé (Zé Lanches)"],
    button: "Abrir no painel",
    permission: "attend",
    dedupeSeconds: DAY,
  },
  canal: {
    label: "WhatsApp de um cliente desconectado",
    template: "boavoz_aviso_canal",
    body: "O WhatsApp do chatbot {{1}} foi desconectado e parou de receber mensagens. Veja como conectar de novo no painel.",
    examples: ["Bar do Zé (Zé Lanches)"],
    button: "Abrir no painel",
    permission: "config",
    dedupeSeconds: DAY,
  },
  pagamento: {
    label: "Pagamento da assinatura atrasado",
    template: "boavoz_aviso_pagamento",
    body: "O pagamento da assinatura da conta {{1}} falhou e a IA foi pausada nos chatbots. Pague a fatura em Cobrança, no painel.",
    examples: ["Norte Marketing"],
    button: "Abrir a Cobrança",
    permission: "billing",
    dedupeSeconds: DAY,
  },
  cota: {
    label: "Cota do mês no fim (95% e cheia)",
    template: "boavoz_aviso_cota",
    body: "O chatbot {{1}} usou {{2}} da cota de atendimentos do mês. Veja o uso e o excedente no painel.",
    examples: ["Bar do Zé (Zé Lanches)", "95%"],
    button: "Ver o uso",
    // a página de Uso é da cobrança (só o dono), como o e-mail da cota
    permission: "billing",
    dedupeSeconds: 31 * DAY,
  },
};

export const NOTICE_KIND_ORDER: NoticeKind[] = ["urgente", "atendente", "lead", "canal", "pagamento", "cota"];
export const isNoticeKind = (v: unknown): v is NoticeKind => typeof v === "string" && v in NOTICE_KINDS;

/** Teto de avisos por pessoa por dia (proteção contra enxurrada: um ataque de pedidos de atendente). */
const NOTICES_PER_DAY = 40;

/** Os avisos que a pessoa pode receber, pelo papel. Pura. */
export const kindsForRole = (role: AgencyRole): NoticeKind[] => NOTICE_KIND_ORDER.filter((k) => can(role, NOTICE_KINDS[k].permission));

/** O aviso está ligado? Sem escolha gravada, todos ligados. Pura. */
export const noticeOn = (prefs: Record<string, boolean> | null | undefined, kind: NoticeKind): boolean => prefs?.[kind] !== false;

/** "Bar do Zé (Zé Lanches)": o chatbot e o cliente, como vão no aviso. Pura. */
export function botTitle(bot: { name: string; client_name?: string | null }): string {
  const name = templateValue(bot.name, "chatbot");
  const client = (bot.client_name ?? "").trim();
  return client && client !== bot.name ? templateValue(`${name} (${client})`, name) : name;
}

/** A base do botão de link: o endereço do painel deste ambiente, com a barra no fim. Pura. */
export const noticeBaseUrl = (): string => appUrl("/").replace(/\/?$/, "/");

/** O estado de cada modelo de aviso na conta do assistente. Pura. */
export function noticeKindStatuses(templates: Template[]): Record<NoticeKind, NoticeTemplateStatus> {
  return Object.fromEntries(
    NOTICE_KIND_ORDER.map((k) => {
      const t = templates.find((x) => x.name === NOTICE_KINDS[k].template && x.language === TEMPLATE_LANGUAGE);
      const status: NoticeTemplateStatus = !t ? "ausente" : t.category !== "UTILITY" ? "reclassificado" : t.status === "APPROVED" ? "aprovado" : t.status === "REJECTED" || t.status === "DISABLED" || t.status === "PAUSED" ? "recusado" : "em_analise";
      return [k, status];
    }),
  ) as Record<NoticeKind, NoticeTemplateStatus>;
}

/** Cria na conta do assistente os modelos de aviso que faltam (o backoffice chama junto do de confirmação). */
export async function ensureNoticeKindTemplates(ch: TemplateChannel): Promise<Record<NoticeKind, NoticeTemplateStatus>> {
  const current = noticeKindStatuses(await listTemplates(ch));
  const base = noticeBaseUrl();
  for (const k of NOTICE_KIND_ORDER) {
    if (current[k] !== "ausente") continue;
    const i = NOTICE_KINDS[k];
    await createTemplate(ch, { name: i.template, category: "UTILITY", body: i.body, examples: i.examples, urlButton: { text: i.button, baseUrl: base, example: `${base}painel/clientes` } });
    current[k] = "em_analise";
  }
  return current;
}

let cachedTemplates: { at: number; wabaId: string; list: Template[] } | null = null;

/** Depois de criar os modelos (backoffice): a próxima consulta lê de novo da Meta. */
export function forgetNoticeTemplates(): void {
  cachedTemplates = null;
}

/** A lista de modelos do assistente, guardada por 5 minutos (cada aviso consultava a Meta). */
async function assistantTemplates(ch: TemplateChannel): Promise<Template[]> {
  if (cachedTemplates && cachedTemplates.wabaId === ch.waba_id && Date.now() - cachedTemplates.at < 5 * 60_000) return cachedTemplates.list;
  const list = await listTemplates(ch);
  cachedTemplates = { at: Date.now(), wabaId: ch.waba_id, list };
  return list;
}

/** Quem da agência pode receber o aviso: o papel e, com chatbot, o escopo (como os e-mails). */
async function eligibleMembers(db: SupabaseClient, n: { agencyId: string; kind: NoticeKind; botId?: string | null; clientId?: string | null }): Promise<string[]> {
  const { data } = await db.from("agency_members").select("id, role, scope").eq("agency_id", n.agencyId).is("removed_at", null).not("accepted_at", "is", null);
  const rows = ((data ?? []) as Array<{ id: string; role: AgencyRole; scope: string }>).filter((m) => can(m.role, NOTICE_KINDS[n.kind].permission));
  if (!n.botId) return rows.map((m) => m.id);
  const selected = rows.filter((m) => m.scope === "selected").map((m) => m.id);
  const inScope = new Set<string>();
  if (selected.length) {
    const { data: scopes } = await db.from("agency_member_scopes").select("member_id, client_id, bot_id").in("member_id", selected);
    for (const sc of (scopes ?? []) as Array<{ member_id: string; client_id: string | null; bot_id: string | null }>) {
      if (sc.bot_id === n.botId || (n.clientId && sc.client_id === n.clientId)) inScope.add(sc.member_id);
    }
  }
  return rows.filter((m) => m.scope === "all" || inScope.has(m.id)).map((m) => m.id);
}

/**
 * O atendimento ficou com o cliente (a agência escolheu: só as pessoas do cliente são avisadas):
 * pedido de atendente e lead não vão para a agência, como no e-mail (urgente vai sempre).
 */
async function delegatedToClient(db: SupabaseClient, clientId: string): Promise<boolean> {
  const { data: client } = await db.from("clients").select("allow_handoff, handoff_notify").eq("id", clientId).maybeSingle();
  if (!client?.allow_handoff || client.handoff_notify !== "client") return false;
  const { count } = await db.from("client_members").select("id", { count: "exact", head: true }).eq("client_id", clientId);
  return (count ?? 0) > 0;
}

export interface TeamNotice {
  kind: NoticeKind;
  agencyId: string;
  botId?: string | null;
  clientId?: string | null;
  /** As variáveis do modelo, na ordem ({{1}}, {{2}}…). */
  vars: string[];
  /** O caminho do painel que o botão abre (sem a barra do começo): "painel/bots/<id>/conversas/<id>". */
  path: string;
  /** O acontecimento (a conversa, o chatbot, a agência): o mesmo aviso não sai duas vezes no prazo. */
  ref: string;
  /** Só estas pessoas da equipe (o setor da conversa, ou quem recebeu pelo rodízio; Caixa de entrada, parte 2). */
  onlyMemberIds?: string[] | null;
}

/**
 * Manda o aviso para a equipe que pode recebê-lo, confirmou o número e deixou ligado (sem a
 * identidade do WhatsApp trocada, sem SAIR). Nunca derruba quem chamou: erro vai para o log.
 * Devolve quantos saíram.
 */
export async function sendTeamNotice(db: SupabaseClient, n: TeamNotice): Promise<number> {
  try {
    const a = await assistantChannel(db);
    if (!a) return 0;
    // a própria BoaVoz não se avisa pelo próprio assistente
    if (n.agencyId === a.agencyId && n.botId === a.botId) return 0;
    if ((n.kind === "atendente" || n.kind === "lead") && n.clientId && (await delegatedToClient(db, n.clientId))) return 0;
    const all = await eligibleMembers(db, n);
    const members = n.onlyMemberIds ? all.filter((id) => n.onlyMemberIds!.includes(id)) : all;
    if (!members.length) return 0;
    const numbers = (await confirmedTeamNumbers(db, members)).filter((x) => !x.identityChanged && x.phone && noticeOn(x.prefs, n.kind));
    if (!numbers.length) return 0;
    const info = NOTICE_KINDS[n.kind];
    const template = (await assistantTemplates(a.ch)).find((t) => t.name === info.template && t.language === TEMPLATE_LANGUAGE && t.status === "APPROVED" && t.category === "UTILITY");
    if (!template) {
      console.warn("avisos: modelo não aprovado", info.template);
      return 0;
    }
    const scope = suppressionScope({ wabaId: a.ch.waba_id, botId: a.botId });
    const vars = n.vars.map((v) => templateValue(v, "—"));
    let sent = 0;
    for (const x of numbers) {
      // SAIR no WhatsApp (ou "Não fui eu"): nada iniciado pela BoaVoz sai
      if (blocks((await activeSuppressions(db, { channel: "whatsapp", scope, contact: x.phone })).map((s) => s.kind), "UTILITY")) continue;
      const over = await firstExceeded(db, [
        { key: `aviso:${n.kind}:${x.memberId}:${n.ref}`, max: 1, windowSeconds: info.dedupeSeconds, message: "repetido" },
        { key: `aviso:dia:${x.memberId}`, max: NOTICES_PER_DAY, windowSeconds: DAY, message: "teto" },
      ]);
      if (over) continue;
      const convId = await assistantConversationFor(db, a, x.phone);
      try {
        const r = await deliver(db, {
          botId: a.botId,
          channel: "whatsapp",
          conversationId: convId,
          kind: "modelo",
          record: convId ? { insert: { role: "assistant", content: renderTemplate(info.body, vars), author: SYSTEM_AUTHOR, template_category: "UTILITY" } } : null,
          transport: async () => (await sendTemplate(a.ch, x.phone, template, vars, { urlSuffix: n.path.replace(/^\/+/, ""), timeoutMs: 15_000 })).messages?.[0]?.id ?? null,
        });
        if (r.status !== "blocked") sent++;
      } catch (e) {
        console.error("avisos: aviso não saiu", info.template, (e as Error).message);
      }
    }
    return sent;
  } catch (e) {
    console.error("avisos: falha ao avisar a equipe", n.kind, (e as Error).message);
    return 0;
  }
}
