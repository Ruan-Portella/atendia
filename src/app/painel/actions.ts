"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireAgency } from "@/lib/agency";
import { initials, slugify } from "@/lib/utils";
import { fail, ok, type ActionResult } from "@/lib/action-result";

const list = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6);

const toCents = (v: string | undefined | null) => (v ? Math.round(Number(String(v).replace(",", ".")) * 100) : null);

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
      price_cents: toCents(d.price),
      persona: { tone: "amigável, direto e profissional", welcome: `Olá! Sou ${d.name}, assistente de ${d.client_name}. Como posso ajudar?` },
      appearance: { color: agency.brand_color, avatar_text: initials(d.client_name), suggested_questions: ["Quais são os horários?", "Quanto custa?", "Como entro em contato?"] },
    })
    .select("id")
    .single();
  if (error || !bot) throw new Error(error?.message);
  redirect(`/painel/bots/${bot.id}`);
}

/** Salva personalidade, aparência, captura de leads e preço do bot. */
export async function updateBot(botId: string, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const f = Object.fromEntries(formData) as Record<string, string>;
  const patch: Record<string, unknown> = {};
  if ("name" in f) {
    if (f.name.trim().length < 2) return fail("O nome do assistente precisa ter pelo menos 2 letras.");
    patch.name = f.name.trim().slice(0, 40);
  }
  if ("client_name" in f) {
    if (f.client_name.trim().length < 2) return fail("O nome do cliente precisa ter pelo menos 2 letras.");
    patch.client_name = f.client_name.trim().slice(0, 80);
  }
  if ("client_site" in f) patch.client_site = f.client_site.trim() || null;
  if ("price" in f) patch.price_cents = toCents(f.price);
  if ("tone" in f) patch.persona = { tone: f.tone, welcome: f.welcome, instructions: f.instructions, language: "português do Brasil" };
  if ("color" in f) {
    const offset = Math.min(200, Math.max(0, Math.round(Number(f.offset)) || 20));
    patch.appearance = { color: f.color, avatar_text: (f.avatar_text || "AI").slice(0, 2).toUpperCase(), suggested_questions: list(formData.get("suggested")), position: f.position === "left" ? "left" : "right", offset };
  }
  if ("lead_enabled" in f || "notify_email" in f) patch.lead_capture = { enabled: f.lead_enabled === "on", notify_email: f.notify_email?.trim() || null, notify_whatsapp: f.notify_whatsapp?.trim() || null };
  if (!Object.keys(patch).length) return fail("Nada para salvar.");

  const { error, count } = await supabase.from("bots").update(patch, { count: "exact" }).eq("id", botId);
  if (error) return fail(error.message);
  if (!count) return fail("Chatbot não encontrado.");
  revalidatePath(`/painel/bots/${botId}`);
  revalidatePath("/painel");
  return ok("Alterações salvas.");
}

export async function setBotStatus(botId: string, status: "live" | "draft"): Promise<ActionResult> {
  const supabase = await createClient();
  if (status === "live") {
    const { count } = await supabase.from("sources").select("id", { count: "exact", head: true }).eq("bot_id", botId).eq("status", "ready");
    if (!count) return fail("Adicione pelo menos uma fonte pronta antes de publicar.");
  }
  const { error } = await supabase.from("bots").update({ status }).eq("id", botId);
  if (error) return fail(error.message);
  revalidatePath(`/painel/bots/${botId}`);
  revalidatePath("/painel");
  return ok(status === "live" ? "Chatbot publicado. Ele já responde no site." : "Chatbot fora do ar.");
}

/** Converte uma demo em chatbot de verdade (mantém a base de conhecimento). */
export async function convertDemo(botId: string, formData: FormData) {
  const { agency, plan } = await requireAgency();
  const supabase = await createClient();
  const { count } = await supabase.from("bots").select("id", { count: "exact", head: true }).eq("agency_id", agency.id).eq("is_demo", false);
  if ((count ?? 0) >= plan.bots) redirect("/painel/cobranca?limite=bots");
  const f = Object.fromEntries(formData) as Record<string, string>;
  const patch: Record<string, unknown> = { is_demo: false, demo_slug: null, status: "live", price_cents: toCents(f.price) };
  if (f.name?.trim()) patch.name = f.name.trim().slice(0, 40);
  if (f.client_name?.trim()) patch.client_name = f.client_name.trim().slice(0, 80);
  await supabase.from("bots").update(patch).eq("id", botId);
  revalidatePath("/painel");
  redirect(`/painel/bots/${botId}?tab=instalacao`);
}

/**
 * Apaga o chatbot (fontes, trechos, conversas e leads vão junto por cascade).
 * `redirectTo` quando chamado de dentro do editor; da lista, só revalida.
 */
export async function deleteBot(botId: string, redirectTo?: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error, count } = await supabase.from("bots").delete({ count: "exact" }).eq("id", botId);
  if (error) return fail(error.message);
  if (!count) return fail("Chatbot não encontrado.");
  revalidatePath("/painel", "layout");
  if (redirectTo) redirect(redirectTo);
  return ok("Chatbot excluído.");
}

export async function resolveUnanswered(id: string, botId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("unanswered").update({ resolved: true }).eq("id", id);
  if (error) return fail(error.message);
  revalidatePath(`/painel/bots/${botId}`);
  return ok("Marcada como resolvida.");
}

export async function deleteLead(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error, count } = await supabase.from("leads").delete({ count: "exact" }).eq("id", id);
  if (error) return fail(error.message);
  if (!count) return fail("Lead não encontrado.");
  revalidatePath("/painel/leads");
  return ok("Lead excluído.");
}

/** Marca da agência (white-label). */
export async function updateAgency(formData: FormData): Promise<ActionResult> {
  const { agency } = await requireAgency();
  const supabase = await createClient();
  const parsed = z
    .object({ name: z.string().trim().min(2, "Nome muito curto.").max(80), brand_color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Cor inválida."), support_whatsapp: z.string().max(30).optional(), logo_url: z.string().max(400).optional(), custom_domain: z.string().max(120).optional() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const d = parsed.data;
  const { error } = await supabase
    .from("agencies")
    .update({ name: d.name, slug: agency.slug.startsWith(slugify(d.name)) ? agency.slug : `${slugify(d.name)}-${agency.slug.split("-").pop()}`, brand_color: d.brand_color, support_whatsapp: d.support_whatsapp?.replace(/\D/g, "") || null, logo_url: d.logo_url || null, custom_domain: d.custom_domain?.trim().toLowerCase() || null })
    .eq("id", agency.id);
  if (error) return fail(error.message);
  revalidatePath("/painel", "layout");
  return ok("Marca atualizada.");
}
