import { createClient } from "@/lib/supabase/server";
import { requireAgency } from "@/lib/agency";

/** Exporta os leads da agência em CSV (abre direto no Excel/Sheets). ?bot= filtra por chatbot. */
export async function GET(req: Request) {
  const { agency } = await requireAgency();
  const supabase = await createClient();
  const botFilter = new URL(req.url).searchParams.get("bot");

  const { data: bots } = await supabase.from("bots").select("id, client_name").eq("agency_id", agency.id);
  const ids = (bots ?? []).map((b) => b.id).filter((id) => !botFilter || id === botFilter);
  const nameOf = (id: string) => bots?.find((b) => b.id === id)?.client_name ?? "";

  const { data: leads } = ids.length
    ? await supabase.from("leads").select("bot_id, name, phone, email, notes, created_at").in("bot_id", ids).order("created_at", { ascending: false }).limit(5000)
    : { data: [] };

  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [["Data", "Cliente", "Nome", "Telefone", "E-mail", "Interesse"].join(";")];
  for (const l of leads ?? []) {
    lines.push([new Date(l.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }), nameOf(l.bot_id), l.name, l.phone, l.email, l.notes].map(esc).join(";"));
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
