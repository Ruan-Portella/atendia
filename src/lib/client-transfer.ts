import type { SupabaseClient } from "@supabase/supabase-js";
import { audit } from "./audit";
import { notifyAgencyOwner } from "./notify";
import { syncSubscriptionSafe } from "./billing-sync";
import { appUrl } from "./utils";

/*
 * Transferência de cliente entre contas (D', parte 5, 20/10/2026; spec, "Transferência de
 * cliente"). Não tem fluxo de aceite no produto: o suporte do BoaVoz faz a mudança a pedido do
 * negócio (o controlador dos dados), no painel interno, também quando a agência de origem sumiu. A
 * função SQL transfer_client faz tudo numa transação (migração 0128); aqui fica o que vem depois:
 * as duas assinaturas, a auditoria nas duas contas e os avisos aos dois donos.
 *
 * TRANSFER_TABLES classifica toda tabela com agency_id: "muda" (vai para a conta nova, só o
 * agency_id) ou "fica" (histórico da origem). Um teste lê as migrações e falha se aparecer uma
 * tabela com agency_id fora desta lista: a tabela nova precisa decidir o que acontece na
 * transferência (e, se muda, entrar em transfer_client).
 */

export const TRANSFER_TABLES: Record<string, { muda: boolean; por: string }> = {
  clients: { muda: true, por: "o próprio cliente" },
  bots: { muda: true, por: "os chatbots do cliente (com conversas, leads, base, canais e vínculos, presos ao chatbot)" },
  contacts: { muda: true, por: "os contatos dos chatbots" },
  marketing_consents: { muda: true, por: "os aceites de novidades dos contatos" },
  data_subject_requests: { muda: true, por: "os pedidos do titular" },
  report_daily: { muda: true, por: "os relatórios" },
  widget_opens: { muda: true, por: "as aberturas do chat do site (funil do relatório)" },
  sectors: { muda: true, por: "os setores do cliente (a equipe da origem sai deles)" },
  attachments: { muda: true, por: "os arquivos das conversas" },
  business_compliance: { muda: true, por: "a revisão do negócio (é do negócio, não da agência)" },
  enforcement_actions: { muda: true, por: "as medidas de cada chatbot (as da conta de origem ficam)" },
  compliance_checks: { muda: true, por: "as análises de cada chatbot" },
  gate_review_requests: { muda: true, por: "os pedidos de revisão do portão de cada chatbot" },
  campaigns: { muda: true, por: "as campanhas e lembretes (as agendadas ficam pausadas)" },
  reguas: { muda: true, por: "as réguas dos chatbots (chegam desligadas, para a conta nova conferir)" },
  access_log: { muda: false, por: "registro de acesso (histórico)" },
  audit_log: { muda: false, por: "auditoria (histórico)" },
  agency_members: { muda: false, por: "a equipe é da conta (os escopos neste cliente saem)" },
  agency_packs: { muda: false, por: "pacotes da conta" },
  ai_usage: { muda: false, por: "medição de IA (histórico)" },
  ai_usage_monthly: { muda: false, por: "medição de IA (histórico)" },
  api_keys: { muda: false, por: "chaves da origem (deixam de alcançar o cliente)" },
  api_requests: { muda: false, por: "registro das chamadas à API da origem (histórico, 30 dias)" },
  atendimentos: { muda: false, por: "uso já contado (os novos contam no destino)" },
  billing_changes: { muda: false, por: "cobrança da origem" },
  fiscal_invoices: { muda: false, por: "as notas fiscais dos pagamentos da origem" },
  business_acceptances: { muda: false, por: "o aceite vale para a conta que recebeu; a nova precisa de outro" },
  credit_lots: { muda: false, por: "crédito da conta" },
  credit_redemptions: { muda: false, por: "indicações da conta" },
  identity_secrets: { muda: false, por: "segredos da origem (os deste cliente são revogados)" },
  roadmap_suggestions: { muda: false, por: "sugestões da conta" },
  support_access_grants: { muda: false, por: "autorizações de suporte (histórico)" },
  team_whatsapp: { muda: false, por: "os números da equipe da conta" },
  usage: { muda: false, por: "uso do mês da conta" },
  webhooks: { muda: false, por: "webhooks da origem (deixam de receber os eventos do cliente)" },
};

export interface TransferInput {
  clientId: string;
  toAgencyId: string;
  /** Quem pediu, do lado do negócio (nome e como pediu). */
  requestedBy: string;
  /** Quem fez, no suporte do BoaVoz. */
  doneBy: string;
  reason: string | null;
}

export interface TransferSummary {
  fromAgencyId: string;
  botIds: string[];
  counts: Record<string, number | boolean>;
}

/** Transfere e faz o que vem depois. Erro da função SQL (cliente ou conta não encontrados, mesma conta) sobe com a mensagem. */
export async function transferClient(db: SupabaseClient, o: TransferInput): Promise<TransferSummary> {
  const { data, error } = await db.rpc("transfer_client", { p_client: o.clientId, p_to: o.toAgencyId, p_requested_by: o.requestedBy, p_done_by: o.doneBy, p_reason: o.reason });
  if (error || !data) throw new Error(error?.message ?? "transferência sem resposta");
  const r = data as Record<string, unknown>;
  const fromAgencyId = String(r.from_agency_id);
  const botIds = (r.bot_ids as string[] | null) ?? [];
  const counts = Object.fromEntries(Object.entries(r).filter(([k]) => k !== "from_agency_id" && k !== "bot_ids")) as Record<string, number | boolean>;
  const { data: client } = await db.from("clients").select("name").eq("id", o.clientId).maybeSingle();
  const name = String(client?.name ?? "cliente");
  const [{ data: from }, { data: to }] = await Promise.all([
    db.from("agencies").select("name").eq("id", fromAgencyId).maybeSingle(),
    db.from("agencies").select("name").eq("id", o.toAgencyId).maybeSingle(),
  ]);
  // as duas assinaturas acompanham na próxima fatura (sem proporcional: a origem já pagou o mês)
  await Promise.all([syncSubscriptionSafe(db, fromAgencyId), syncSubscriptionSafe(db, o.toAgencyId)]);
  const record = { cliente: name, pedido_por: o.requestedBy, motivo: o.reason, ...counts };
  await audit(db, { agencyId: fromAgencyId, actorType: "support", actorId: o.doneBy, action: "cliente.transferir_saida", targetType: "client", targetId: o.clientId, after: { ...record, para: to?.name ?? o.toAgencyId } });
  await audit(db, { agencyId: o.toAgencyId, actorType: "support", actorId: o.doneBy, action: "cliente.transferir_entrada", targetType: "client", targetId: o.clientId, after: { ...record, de: from?.name ?? fromAgencyId } });
  await notifyAgencyOwner(db, fromAgencyId, `${name} saiu da sua conta BoaVoz`, [
    `A pedido do negócio, o suporte do BoaVoz transferiu ${name} (e ${botIds.length} chatbot${botIds.length === 1 ? "" : "s"}) para outra conta.`,
    "",
    "As suas chaves de API, webhooks e segredos de identidade deixaram de alcançar este cliente, e a equipe da sua conta perdeu o acesso a ele. A auditoria, o uso já contado e a cobrança até aqui ficam com a sua conta.",
  ]).catch(() => false);
  await notifyAgencyOwner(db, o.toAgencyId, `${name} entrou na sua conta BoaVoz: confira antes de usar`, [
    `A pedido do negócio, o suporte do BoaVoz transferiu ${name} para a sua conta, com ${botIds.length} chatbot${botIds.length === 1 ? "" : "s"}, as conversas, os contatos e a base.`,
    "",
    "Antes de seguir, confira em cada chatbot (a faixa \"veio de outra conta\" mostra o que revisar):",
    "- as ações estão desligadas, sem segredo e sem cabeçalhos: gere um segredo novo e ligue as que forem do negócio;",
    "- o destino do atendimento humano e o aviso de leads (o e-mail que não era de alguém do cliente saiu);",
    "- o excedente está desligado, as campanhas e lembretes agendados estão pausados e as réguas estão desligadas;",
    "- o negócio precisa fazer o aceite do canal de novo para os dados irem para os seus webhooks e a sua API.",
    ...(counts.destino_com_assinatura === false ? ["", "A sua conta ainda não tem assinatura: os chatbots ficam sem tamanho a partir do dia 1º. Escolha os tamanhos em Cobrança → Assinatura."] : []),
    appUrl(`/painel/clientes/${o.clientId}`),
  ]).catch(() => false);
  return { fromAgencyId, botIds, counts };
}
