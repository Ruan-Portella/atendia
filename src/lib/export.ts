import type { SupabaseClient } from "@supabase/supabase-js";
import { exportContactsPage } from "./contacts";
import { exportLeadsPage } from "./leads";
import { loadMessages } from "./messages";

/*
 * Exportação dos dados do negócio (leva S): conversas (uma linha por mensagem), contatos e leads,
 * em CSV (abre no Excel) ou JSON, dos chatbots de um cliente (sem as demonstrações). Gerada em
 * páginas e enviada aos poucos (stream), com os campos cifrados já abertos. Quem chama já conferiu
 * que a pessoa pode ver este cliente (área do cliente ou agência dona).
 */

export const EXPORT_KINDS = ["conversas", "contatos", "leads"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];
export type ExportFormat = "csv" | "json";

type Row = Record<string, string | number | null>;

const COLUMNS: Record<ExportKind, Array<[key: string, label: string]>> = {
  conversas: [
    ["conversa", "Conversa"],
    ["assistente", "Assistente"],
    ["canal", "Canal"],
    ["inicio", "Início da conversa"],
    ["data", "Data da mensagem"],
    ["de", "De"],
    ["texto", "Texto"],
  ],
  contatos: [
    ["id", "Contato"],
    ["assistente", "Assistente"],
    ["canal", "Canal"],
    ["telefone", "Telefone"],
    ["whatsapp_id", "ID do WhatsApp"],
    ["instagram_id", "ID do Instagram"],
    ["id_externo", "ID no sistema da empresa"],
    ["nome", "Nome"],
    ["email", "E-mail"],
    ["primeira_mensagem", "Primeira mensagem"],
    ["ultima_mensagem", "Última mensagem"],
    ["criado_em", "Criado em"],
  ],
  leads: [
    ["data", "Data"],
    ["assistente", "Assistente"],
    ["conversa", "Conversa"],
    ["nome", "Nome"],
    ["telefone", "Telefone"],
    ["email", "E-mail"],
    ["interesse", "Interesse"],
  ],
};

const CHANNEL: Record<string, string> = { widget: "site", whatsapp: "WhatsApp", instagram: "Instagram" };
const WHO: Record<string, string> = { user: "contato", assistant: "assistente", agent: "equipe" };
const PAGE = 200;

/** As linhas de um conjunto, página por página. */
export async function* exportRows(db: SupabaseClient, bots: Array<{ id: string; name: string }>, kind: ExportKind): AsyncGenerator<Row> {
  const botIds = bots.map((b) => b.id);
  const botName = new Map(bots.map((b) => [b.id, b.name]));
  if (!botIds.length) return;
  if (kind === "contatos") {
    for (let after: string | null = null; ; ) {
      const page = await exportContactsPage(db, botIds, after, PAGE);
      for (const c of page)
        yield { id: c.id, assistente: botName.get(c.bot_id ?? "") ?? null, canal: CHANNEL[c.channel ?? ""] ?? c.channel, telefone: c.phone, whatsapp_id: c.whatsapp_user_id, instagram_id: c.instagram_id, id_externo: c.external_id, nome: c.name, email: c.email, primeira_mensagem: c.first_inbound_at, ultima_mensagem: c.last_inbound_at, criado_em: c.created_at };
      if (page.length < PAGE) return;
      after = page[page.length - 1].id;
    }
  }
  if (kind === "leads") {
    for (let after: string | null = null; ; ) {
      const page = await exportLeadsPage(db, botIds, after, PAGE);
      for (const l of page) yield { data: l.created_at, assistente: botName.get(l.bot_id) ?? null, conversa: l.conversation_id, nome: l.name, telefone: l.phone, email: l.email, interesse: l.notes };
      if (page.length < PAGE) return;
      after = page[page.length - 1].id;
    }
  }
  // conversas: uma linha por mensagem, na ordem
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from("conversations").select("id, bot_id, channel, started_at").in("bot_id", botIds).order("started_at").order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(`exportação das conversas: ${error.message}`);
    const convs = (data ?? []) as Array<{ id: string; bot_id: string; channel: string | null; started_at: string }>;
    for (const c of convs) {
      const messages = await loadMessages(db, { conversationId: c.id }, ["role", "content", "created_at", "deleted_at"] as const);
      for (const m of messages)
        yield { conversa: c.id, assistente: botName.get(c.bot_id) ?? null, canal: CHANNEL[c.channel ?? "widget"] ?? c.channel, inicio: c.started_at, data: m.created_at, de: WHO[m.role] ?? m.role, texto: m.deleted_at ? "(mensagem apagada pelo contato)" : m.content };
    }
    if (convs.length < PAGE) return;
  }
}

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Resposta em stream: CSV (BOM e ponto e vírgula, para o Excel em português) ou JSON (lista de objetos). */
export function exportResponse(rows: AsyncGenerator<Row>, kind: ExportKind, format: ExportFormat, filename: string, onDone?: (count: number) => void): Response {
  const enc = new TextEncoder();
  const cols = COLUMNS[kind];
  let count = 0;
  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      try {
        if (format === "csv") ctrl.enqueue(enc.encode(`﻿${cols.map(([, label]) => csvCell(label)).join(";")}\r\n`));
        else ctrl.enqueue(enc.encode("[\n"));
        for await (const r of rows) {
          const line = format === "csv" ? `${cols.map(([k]) => csvCell(r[k])).join(";")}\r\n` : `${count ? ",\n" : ""}${JSON.stringify(Object.fromEntries(cols.map(([k]) => [k, r[k] ?? null])))}`;
          ctrl.enqueue(enc.encode(line));
          count++;
        }
        if (format === "json") ctrl.enqueue(enc.encode("\n]\n"));
        onDone?.(count);
        ctrl.close();
      } catch (e) {
        console.error("exportação falhou", (e as Error).message);
        ctrl.error(e);
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}.${format}"`,
      "Cache-Control": "no-store",
    },
  });
}
