/*
 * Lista de clientes exportável do backoffice (L1; spec "Painel interno → Clientes"): uma linha por
 * chatbot, com a agência, o negócio, o número e a conta do WhatsApp, o portfólio da Meta
 * (business_id), o Instagram, a conformidade e os trechos da base. Mais o alerta, sem bloqueio,
 * do mesmo portfólio da Meta em clientes diferentes. Funções puras; a leitura fica em backoffice.ts.
 */

export interface ClientExportRow {
  agencyId: string;
  agencyName: string;
  ownerEmail: string | null;
  planName: string;
  agencySituation: string;
  clientId: string | null;
  clientName: string;
  botId: string;
  botName: string;
  botStatus: string;
  botCreatedAt: string;
  chunks: number;
  waPhone: string | null;
  wabaId: string | null;
  businessId: string | null;
  coexistence: boolean;
  waConnectedAt: string | null;
  waDisconnectedAt: string | null;
  waDisconnectReason: string | null;
  igUsername: string | null;
  igConnected: boolean | null;
  complianceStatus: string | null;
}

const COMPLIANCE_LABEL: Record<string, string> = { ativo: "ativo", em_revisao: "em revisão", aguardando_revisao: "aguardando revisão", bloqueado: "bloqueado" };
const BOT_STATUS: Record<string, string> = { live: "publicado", draft: "rascunho", training: "lendo fontes", error: "com erro" };

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "");

/** Situação do WhatsApp do chatbot, em texto. */
export function whatsappSituation(r: Pick<ClientExportRow, "waPhone" | "wabaId" | "waConnectedAt" | "waDisconnectedAt" | "waDisconnectReason">): string {
  if (!r.waConnectedAt && !r.wabaId && !r.waPhone) return "sem WhatsApp";
  if (r.waDisconnectedAt) return `desconectado em ${day(r.waDisconnectedAt)}${r.waDisconnectReason ? ` (${r.waDisconnectReason})` : ""}`;
  return `conectado desde ${day(r.waConnectedAt)}`;
}

export const EXPORT_COLUMNS: Array<[string, (r: ClientExportRow) => string | number]> = [
  ["Agência", (r) => r.agencyName],
  ["E-mail do dono", (r) => r.ownerEmail ?? ""],
  ["Plano", (r) => r.planName],
  ["Situação da agência", (r) => r.agencySituation],
  ["Negócio (cliente)", (r) => r.clientName],
  ["Conformidade", (r) => (r.complianceStatus ? (COMPLIANCE_LABEL[r.complianceStatus] ?? r.complianceStatus) : "sem resposta")],
  ["Chatbot", (r) => r.botName],
  ["Status do chatbot", (r) => BOT_STATUS[r.botStatus] ?? r.botStatus],
  ["Trechos da base", (r) => r.chunks],
  ["Número do WhatsApp", (r) => r.waPhone ?? ""],
  ["Conta do WhatsApp (WABA)", (r) => r.wabaId ?? ""],
  ["Portfólio da Meta (business_id)", (r) => r.businessId ?? ""],
  ["WhatsApp", whatsappSituation],
  ["No app do celular", (r) => (r.waPhone || r.wabaId ? (r.coexistence ? "sim" : "não") : "")],
  ["Instagram", (r) => (r.igUsername ? `@${r.igUsername}` : r.igConnected === null ? "" : "conectado")],
  ["Instagram situação", (r) => (r.igConnected === null ? "sem Instagram" : r.igConnected ? "conectado" : "desconectado")],
  ["Chatbot criado em", (r) => day(r.botCreatedAt)],
  ["ID do chatbot", (r) => r.botId],
];

/** Célula de CSV: aspas quando preciso, e sem fórmula (=, +, -, @ no começo viram texto). */
export function csvCell(v: string | number): string {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV com ponto e vírgula e BOM (abre direto no Excel em português). */
export function toCsv(rows: ClientExportRow[]): string {
  const lines = [EXPORT_COLUMNS.map(([h]) => csvCell(h)).join(";"), ...rows.map((r) => EXPORT_COLUMNS.map(([, get]) => csvCell(get(r))).join(";"))];
  return `﻿${lines.join("\r\n")}\r\n`;
}

export interface SharedPortfolio {
  businessId: string;
  clients: Array<{ agencyName: string; clientName: string; botName: string }>;
}

/**
 * Mesmo portfólio da Meta (business_id) em clientes diferentes: pode ser a agência conectando com
 * o portfólio dela (o cliente perde o número se sair; regra da Meta contra revenda) ou um negócio
 * com várias lojas. Só alerta.
 */
export function sharedPortfolios(rows: Array<Pick<ClientExportRow, "businessId" | "clientId" | "clientName" | "agencyName" | "botName" | "waDisconnectedAt">>): SharedPortfolio[] {
  const byBusiness = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!r.businessId || r.waDisconnectedAt) continue;
    byBusiness.set(r.businessId, [...(byBusiness.get(r.businessId) ?? []), r]);
  }
  const out: SharedPortfolio[] = [];
  for (const [businessId, list] of byBusiness) {
    const clients = new Set(list.map((r) => r.clientId ?? `${r.agencyName}:${r.clientName}`));
    if (clients.size > 1) out.push({ businessId, clients: list.map((r) => ({ agencyName: r.agencyName, clientName: r.clientName, botName: r.botName })) });
  }
  return out;
}
