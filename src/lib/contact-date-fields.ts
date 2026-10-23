import type { SupabaseClient } from "@supabase/supabase-js";
import { dateFieldKey } from "./regua-kinds";

/*
 * As datas novas do contato (régua personalizada, 23/10/2026): os campos que a agência cria para
 * as réguas ("Renovação do plano", "Vacina do pet"), por chatbot. O valor fica no contato
 * (contacts.custom_dates, pela chave); a chave é o nome da coluna na planilha e na API. Tabela
 * interna (sem policy): quem chama já conferiu o chatbot pela RLS.
 */

export interface DateField {
  id: string;
  botId: string;
  key: string;
  label: string;
}

const row = (r: Record<string, unknown>): DateField => ({ id: r.id as string, botId: r.bot_id as string, key: r.key as string, label: r.label as string });

/** Os campos de data nova destes chatbots, na ordem em que foram criados. */
export async function listDateFields(db: SupabaseClient, botIds: string[]): Promise<DateField[]> {
  if (!botIds.length) return [];
  const { data, error } = await db.from("contact_date_fields").select("id, bot_id, key, label").in("bot_id", botIds).order("created_at");
  if (error) throw new Error(`datas novas: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).map(row);
}

/** O campo de data nova do chatbot com este nome (a chave sai do nome); criado se ainda não existe. */
export async function ensureDateField(db: SupabaseClient, botId: string, label: string): Promise<DateField> {
  const clean = label.replace(/\s+/g, " ").trim().slice(0, 60);
  const key = dateFieldKey(clean);
  const find = async () => (await listDateFields(db, [botId])).find((f) => f.key === key) ?? null;
  const current = await find();
  if (current) return current;
  const { data, error } = await db.from("contact_date_fields").insert({ bot_id: botId, key, label: clean }).select("id, bot_id, key, label").single();
  if (error || !data) {
    // duas abas ao mesmo tempo: a outra criou primeiro
    const again = await find();
    if (again) return again;
    throw new Error(`data nova: ${error?.message ?? "não gravada"}`);
  }
  return row(data as Record<string, unknown>);
}
