"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireAgency } from "@/lib/agency";
import { initials, slugify } from "@/lib/utils";

const list = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6);

/** Cria um chatbot (não demo) e vai para o editor. */
export async function createBot(formData: FormData) {
  const { agency, plan } = await requireAgency();
  const supabase = await createClient();
  const { count } = await supabase.from("bots").select("id", { count: "exact", head: true }).eq("agency_id", agency.id).eq("is_demo", false);
  if ((count ?? 0) >= plan.bots) redirect("/painel/cobranca?limite=bots");

  const d = z
    .object({ client_name: z.string().min(2).max(80), name: z.string().min(2).max(40), client_site: z.string().max(200).optional(), price: z.string().optional() })
    .parse(Object.fromEntries(formData));
  const { data: bot, error } = await supabase
    .from("bots")
    .insert({
      agency_id: agency.id,
      client_name: d.client_name,
      name: d.name,
      client_site: d.client_site || null,
      price_cents: d.price ? Math.round(Number(d.price.replace(",", ".")) * 100) : null,
      persona: { tone: "amigável, direto e profissional", welcome: `Olá! Sou ${d.name}, assistente de ${d.client_name}. Como posso ajudar?` },
      appearance: { color: agency.brand_color, avatar_text: initials(d.client_name), suggested_questions: ["Quais são os horários?", "Quanto custa?", "Como entro em contato?"] },
    })
    .select("id")
    .single();
  if (error || !bot) throw new Error(error?.message);
  redirect(`/painel/bots/${bot.id}`);
}

/** Salva personalidade, aparência, captura de leads e preço do bot. */
export async function updateBot(botId: string, formData: FormData) {
  const supabase = await createClient();
  const f = Object.fromEntries(formData) as Record<string, string>;
  const patch: Record<string, unknown> = {};
  if (f.name) patch.name = f.name.slice(0, 40);
  if (f.client_name) patch.client_name = f.client_name.slice(0, 80);
  if ("client_site" in f) patch.client_site = f.client_site || null;
  if ("price" in f) patch.price_cents = f.price ? Math.round(Number(f.price.replace(",", ".")) * 100) : null;
  if ("tone" in f) patch.persona = { tone: f.tone, welcome: f.welcome, instructions: f.instructions, language: "português do Brasil" };
  if ("color" in f) patch.appearance = { color: f.color, avatar_text: (f.avatar_text || "AI").slice(0, 2).toUpperCase(), suggested_questions: list(formData.get("suggested")) };
  if ("lead_enabled" in f || "notify_email" in f) patch.lead_capture = { enabled: f.lead_enabled === "on", notify_email: f.notify_email || null, notify_whatsapp: f.notify_whatsapp || null };
  const { error } = await supabase.from("bots").update(patch).eq("id", botId);
  if (error) throw new Error(error.message);
  revalidatePath(`/painel/bots/${botId}`);
}

export async function setBotStatus(botId: string, status: "live" | "draft") {
  const supabase = await createClient();
  await supabase.from("bots").update({ status }).eq("id", botId);
  revalidatePath(`/painel/bots/${botId}`);
  revalidatePath("/painel");
}

/** Converte uma demo em chatbot de verdade (mantém a base de conhecimento). */
export async function convertDemo(botId: string, formData: FormData) {
  const { agency, plan } = await requireAgency();
  const supabase = await createClient();
  const { count } = await supabase.from("bots").select("id", { count: "exact", head: true }).eq("agency_id", agency.id).eq("is_demo", false);
  if ((count ?? 0) >= plan.bots) redirect("/painel/cobranca?limite=bots");
  const price = String(formData.get("price") ?? "");
  await supabase.from("bots").update({ is_demo: false, demo_slug: null, status: "live", price_cents: price ? Math.round(Number(price.replace(",", ".")) * 100) : null }).eq("id", botId);
  revalidatePath("/painel");
  redirect(`/painel/bots/${botId}`);
}

export async function deleteBot(botId: string) {
  const supabase = await createClient();
  await supabase.from("bots").delete().eq("id", botId);
  revalidatePath("/painel");
  redirect("/painel");
}

export async function resolveUnanswered(id: string, botId: string) {
  const supabase = await createClient();
  await supabase.from("unanswered").update({ resolved: true }).eq("id", id);
  revalidatePath(`/painel/bots/${botId}`);
}

/** Marca da agência (white-label). */
export async function updateAgency(formData: FormData) {
  const { agency } = await requireAgency();
  const supabase = await createClient();
  const d = z
    .object({ name: z.string().min(2).max(80), brand_color: z.string().regex(/^#[0-9a-fA-F]{6}$/), support_whatsapp: z.string().max(30).optional(), logo_url: z.string().max(400).optional(), custom_domain: z.string().max(120).optional() })
    .parse(Object.fromEntries(formData));
  const { error } = await supabase
    .from("agencies")
    .update({ name: d.name, slug: agency.slug.startsWith(slugify(d.name)) ? agency.slug : `${slugify(d.name)}-${agency.slug.split("-").pop()}`, brand_color: d.brand_color, support_whatsapp: d.support_whatsapp || null, logo_url: d.logo_url || null, custom_domain: d.custom_domain || null })
    .eq("id", agency.id);
  if (error) throw new Error(error.message);
  revalidatePath("/painel", "layout");
}
