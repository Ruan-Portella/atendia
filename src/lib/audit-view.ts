import type { SupabaseClient } from "@supabase/supabase-js";
import { SECURITY_ALERTS } from "./security-alerts";
import { memberName } from "./team";

/*
 * Auditoria na tela de Segurança (leva S): rótulos em português, filtros (período, quem, tipo,
 * cliente) e a lista com antes e depois. A agência lê só a dela (RLS de audit_log).
 */

export const ACTION_LABELS: Record<string, string> = {
  ...SECURITY_ALERTS,
  "aceite.registrar": "Aceite do negócio registrado",
  "acoes.apagar": "Ação de integração apagada",
  "agencia.estender_teste": "Teste estendido pela BoaVoz",
  "agencia.liberacao": "Recurso liberado pela BoaVoz",
  "agencia.pausar_ia": "IA da conta pausada pela BoaVoz",
  "agencia.religar_ia": "IA da conta religada pela BoaVoz",
  "analise.resolver": "Análise do bot revisada pela BoaVoz",
  "analise.rodar_agendadas": "Análises agendadas rodadas",
  "analise.rodar_de_novo": "Análise do bot rodada de novo",
  "bot.excluir": "Chatbot excluído",
  "bot.modo_sensivel": "Modo dados sensíveis alterado",
  "bot.pausar": "Chatbot pausado",
  "bot.retomar": "Chatbot retomado",
  "canal.conectar": "Canal conectado",
  "canal.desconectar": "Canal desconectado",
  "canal.link_gerar": "Link de conexão gerado",
  "canal.respostas_automaticas_desligadas": "Respostas automáticas do app desligadas",
  "cifra.recifrar": "Histórico recifrado",
  "cliente.excluir": "Cliente excluído",
  "cliente.retencao": "Prazo de guarda do cliente alterado",
  "cliente.sublimite": "Limite de atendimentos do cliente alterado",
  "contato.apagar_dados": "Dados de um contato apagados (painel)",
  "conversa.assumir": "Conversa assumida",
  "conversa.devolver": "Conversa devolvida ao assistente",
  "conversa.excluir": "Conversa excluída",
  "dados.exportar": "Dados exportados",
  "equipe.convidar": "Pessoa convidada para a equipe",
  "equipe.convite_aceitar": "Convite da equipe aceito",
  "equipe.convite_recusar": "Convite da equipe recusado",
  "equipe.papel": "Papel ou escopo de alguém da equipe alterado",
  "equipe.remover": "Pessoa removida da equipe",
  "idade.informar": "18+ informado pela empresa",
  "incidente.registrar": "Incidente de segurança registrado (BoaVoz)",
  "incidente.atualizar": "Incidente de segurança atualizado (BoaVoz)",
  "admin.exportar_clientes": "Lista de clientes exportada (BoaVoz)",
  "idade.zerar": "Resposta de 18+ zerada",
  "medida.levantar": "Medida levantada pela BoaVoz",
  "meta.levantar_ordem": "Ordem da Meta levantada",
  "meta.medida": "Medida da Meta recebida",
  "negocio.aprovar": "Negócio aprovado na revisão",
  "negocio.bloquear": "Negócio bloqueado na revisão",
  "pareamento.codigo": "Código de pareamento criado",
  "pareamento.desvincular": "Vínculo de contato desfeito",
  "plataforma.abrir_canal": "Canal aberto pela BoaVoz",
  "plataforma.desligar_whatsapp": "WhatsApp desligado pela BoaVoz",
  "plataforma.fechar_canal": "Canal fechado pela BoaVoz",
  "plataforma.pausar_ia": "IA pausada pela BoaVoz",
  "plataforma.religar_ia": "IA religada pela BoaVoz",
  "plataforma.religar_whatsapp": "WhatsApp religado pela BoaVoz",
  "portal.link_desligar": "Link do portal desligado",
  "portal.link_ligar": "Link do portal ligado",
  "portal.permissoes": "Permissões da área do cliente alteradas",
  "portal.pessoa_adicionar": "Pessoa adicionada à área do cliente",
  "portal.pessoa_remover": "Pessoa removida da área do cliente",
  "portao.aprovar_excecao": "Exceção de item restrito aprovada",
  "portao.pedir_revisao": "Revisão de item restrito pedida",
  "portao.recusar_excecao": "Exceção de item restrito recusada",
  "portao.revogar_excecao": "Exceção de item restrito revogada",
  "relatorio.totais_diarios": "Totais diários recalculados",
  "retencao.aumento": "Prazo de guarda aumentado",
  "retencao.aviso_padrao": "Prazo de guarda padrão agendado (12 meses)",
  "retencao.desfazer": "Redução do prazo de guarda desfeita",
  "retencao.promover": "Novo prazo de guarda passou a valer",
  "retencao.reducao": "Redução do prazo de guarda agendada",
  "retencao.rodar": "Limpeza por prazo rodada",
  "seguranca.encerrar_sessoes": "Outras sessões encerradas",
  "seguranca.mfa_cadastrar": "Segundo fator cadastrado",
  "suporte.encerrar": "Acesso do suporte encerrado",
  "suporte.ler_conversa": "Conversa lida pelo suporte BoaVoz",
  "suporte.ler_arquivo": "Arquivo aberto pelo suporte BoaVoz",
  "titular.confirmar": "Pedido de exclusão confirmado",
  "titular.pedido": "Pedido de exclusão recebido pelo chat",
  "webhook.apagar": "Webhook apagado",
  "webhook.reativar": "Webhook reativado",
};

/** Tipos de evento (o começo da ação) para o filtro. */
export const ACTION_GROUPS: Record<string, string> = {
  canal: "Canais",
  bot: "Chatbots",
  cliente: "Clientes",
  portal: "Área do cliente",
  conversa: "Conversas",
  contato: "Contatos",
  titular: "Pedidos do titular",
  dados: "Exportação",
  retencao: "Retenção",
  idade: "18+",
  portao: "Itens restritos",
  analise: "Análise do bot",
  negocio: "Conformidade",
  api: "Chaves de API",
  identidade: "Identidade",
  acoes: "Ações",
  webhook: "Webhooks",
  pareamento: "Pareamento",
  suporte: "Suporte BoaVoz",
  seguranca: "Segurança",
  equipe: "Equipe",
  plataforma: "Avisos da BoaVoz",
};

export const actionLabel = (action: string) => ACTION_LABELS[action] ?? action;

export const ACTORS: Record<string, string> = { user: "Equipe da agência", member: "Área do cliente", support: "Equipe BoaVoz", system: "Sistema", api_key: "Chave de API", link: "Link de conexão" };

export interface AuditFilters {
  days: number;
  actor: string;
  group: string;
  clientId: string;
}

export interface AuditRow {
  id: number;
  actor_type: string;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  created_at: string;
}

export const PERIODS = [7, 30, 90, 365] as const;

/** Lê os filtros da URL (valores fora da lista viram o padrão). Pura. */
export function auditFilters(sp: Record<string, string | string[] | undefined>): AuditFilters {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const days = Number(one("dias"));
  return {
    days: (PERIODS as readonly number[]).includes(days) ? days : 30,
    actor: one("quem") in ACTORS ? one("quem") : "",
    group: one("tipo") in ACTION_GROUPS ? one("tipo") : "",
    clientId: /^[0-9a-f-]{36}$/.test(one("cliente")) ? one("cliente") : "",
  };
}

/** Eventos da auditoria da agência, mais novos primeiro. targetIds: os do cliente filtrado (ele e os chatbots). */
export async function listAudit(db: SupabaseClient, agencyId: string, f: AuditFilters, opts: { limit: number; offset?: number; targetIds?: string[] }): Promise<AuditRow[]> {
  let q = db.from("audit_log").select("id, actor_type, actor_id, action, target_type, target_id, before, after, created_at").eq("agency_id", agencyId).gte("created_at", new Date(Date.now() - f.days * 86_400_000).toISOString());
  if (f.actor) q = q.eq("actor_type", f.actor);
  if (f.group) q = q.like("action", `${f.group}.%`);
  if (opts.targetIds) q = q.in("target_id", opts.targetIds.length ? opts.targetIds : ["-"]);
  const from = opts.offset ?? 0;
  const { data, error } = await q.order("created_at", { ascending: false }).range(from, from + opts.limit - 1);
  if (error) throw new Error(`auditoria: ${error.message}`);
  return (data ?? []) as AuditRow[];
}

/** Quem é quem na equipe, para nomear "quem fez": `me` é quem está vendo a tela. */
export interface AuditPeople {
  me: string;
  names: Map<string, string>;
}

/** Pessoas da equipe pelo id de usuário, inclusive quem já saiu (a auditoria guarda 1 ano). */
export async function auditPeople(db: SupabaseClient, agencyId: string, me: string): Promise<AuditPeople> {
  const { data } = await db.from("agency_members").select("user_id, email, display_name, removed_at").eq("agency_id", agencyId).not("user_id", "is", null);
  const rows = (data ?? []) as Array<{ user_id: string; email: string; display_name: string | null; removed_at: string | null }>;
  // quem saiu e voltou fica com o vínculo atual
  rows.sort((a, b) => Number(!a.removed_at) - Number(!b.removed_at));
  return { me, names: new Map(rows.map((m) => [m.user_id, `${memberName(m)}${m.removed_at ? " (saiu da equipe)" : ""}`])) };
}

/** Quem fez, para a tela: quem vê vira "Você"; a equipe pelo nome; membro e link mostram o e-mail. Pura. */
export function actorText(r: Pick<AuditRow, "actor_type" | "actor_id">, people: AuditPeople): string {
  if (r.actor_type === "user") return r.actor_id === people.me ? "Você" : (r.actor_id && people.names.get(r.actor_id)) || "Pessoa da agência";
  if ((r.actor_type === "member" || r.actor_type === "link") && r.actor_id) return `${ACTORS[r.actor_type]} (${r.actor_id})`;
  return ACTORS[r.actor_type] ?? r.actor_type;
}

const TARGET: Record<string, string> = { agency: "Conta", client: "Cliente", bot: "Chatbot", conversation: "Conversa", data_subject_request: "Pedido do titular", api_key: "Chave de API", webhook: "Webhook", identity_secret: "Segredo de identidade", measure: "Medida", support_grant: "Acesso do suporte" };

/** Nome do alvo: cliente e chatbot pelo nome; o resto pelo tipo. */
export function targetNamer(clients: Map<string, string>, bots: Map<string, string>) {
  return (r: Pick<AuditRow, "target_type" | "target_id">) => {
    const id = r.target_id ?? "";
    if (r.target_type === "client" && clients.has(id)) return `Cliente ${clients.get(id)}`;
    if (r.target_type === "bot" && bots.has(id)) return `Chatbot ${bots.get(id)}`;
    return r.target_type ? (TARGET[r.target_type] ?? r.target_type) : "";
  };
}

/** Os ids do cliente filtrado (ele e os chatbots dele), para filtrar pelo alvo. */
export async function clientTargetIds(supabase: SupabaseClient, clientId: string): Promise<string[] | undefined> {
  if (!clientId) return undefined;
  const { data } = await supabase.from("bots").select("id").eq("client_id", clientId);
  return [clientId, ...(data ?? []).map((b) => b.id as string)];
}

const csvCell = (v: unknown) => {
  const s = v == null ? "" : typeof v === "string" ? v : JSON.stringify(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV da auditoria (BOM e ponto e vírgula, para o Excel). Pura. */
export function auditCsv(rows: AuditRow[], people: AuditPeople, targetName: (r: AuditRow) => string): string {
  const lines = [["Data", "Quem", "Evento", "Código", "Alvo", "Antes", "Depois"].join(";")];
  for (const r of rows)
    lines.push([new Date(r.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }), actorText(r, people), actionLabel(r.action), r.action, targetName(r), r.before, r.after].map(csvCell).join(";"));
  return `﻿${lines.join("\r\n")}\r\n`;
}
