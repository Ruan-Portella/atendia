import { csvCell } from "@/lib/csv";
import { createClient } from "@/lib/supabase/server";
import { requireAgency } from "@/lib/agency";
import { can } from "@/lib/team";
import { mfaRedirect } from "@/lib/agency-mfa";
import { listLeads } from "@/lib/leads";

/** Exporta os leads da agência em CSV (abre direto no Excel/Sheets). ?cliente= filtra por cliente e ?bot= por chatbot. */
export async function GET(req: Request) {
  const { agency, role } = await requireAgency();
  if (!can(role, "export")) return new Response("só o dono ou um administrador da agência exporta os dados", { status: 403 });
  // exportação: segundo fator nesta sessão (cadastro na hora, na primeira vez)
  const verify = await mfaRedirect(req);
  if (verify) return verify;
  const supabase = await createClient();
  const params = new URL(req.url).searchParams;
  const botFilter = params.get("bot");
  const clientFilter = params.get("cliente");

  const { data: bots } = await supabase.from("bots").select("id, name, client_id, client_name").eq("agency_id", agency.id);
  const ids = (bots ?? []).filter((b) => (!botFilter || b.id === botFilter) && (!clientFilter || b.client_id === clientFilter)).map((b) => b.id);
  const byId = new Map((bots ?? []).map((b) => [b.id, b]));

  const leads = await listLeads(supabase, { botIds: ids, limit: 5000 });

  const esc = csvCell;
  const lines = [["Data", "Cliente", "Chatbot", "Nome", "Telefone", "E-mail", "Instagram", "Interesse", "Último pedido", "Pedidos"].join(";")];
  const when = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  for (const l of leads) {
    const history = l.requests.map((r) => `${when(r.at)}: ${r.text ?? "deixou o contato"}`).join(" | ");
    lines.push([when(l.created_at), byId.get(l.bot_id)?.client_name, byId.get(l.bot_id)?.name, l.name, l.phone, l.email, l.instagram, l.notes, when(l.last_request_at), history].map(esc).join(";"));
  }
  // BOM para o Excel reconhecer UTF-8; ponto e vírgula porque o Excel pt-BR usa vírgula decimal.
  const body = "﻿" + lines.join("\r\n");
  const date = new Date().toISOString().slice(0, 10);
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
