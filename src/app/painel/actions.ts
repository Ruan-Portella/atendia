"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireAgency } from "@/lib/agency";
import { initials, slugify } from "@/lib/utils";
import { fail, ok, type ActionResult } from "@/lib/action-result";

type Db = Awaited<ReturnType<typeof createClient>>;

const list = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6);

const text = (v: FormDataEntryValue | null | undefined) => String(v ?? "").trim();

/**
 * Lê o "quanto você cobra" do formulário. Aceita "55", "55,90" ou "1.250,00".
 * Vazio vira null; valor inválido devolve uma mensagem para o toast.
 */
function parsePrice(v: FormDataEntryValue | null | undefined): { cents: number | null } | { error: string } {
  let s = text(v).replace(/^R\$\s*/i, "");
  if (!s) return { cents: null };
  // vírgula é decimal; ponto só é decimal quando não parece separador de milhar (1.250)
  if (s.includes(",") || /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return { error: "Informe um valor válido para o preço (ex.: 55 ou 55,90)." };
  if (n > 1_000_000) return { error: "O preço mensal parece alto demais. Confira o valor." };
  return { cents: Math.round(n * 100) };
}

/** Valida nome, site e preço de um cliente (campos com `prefix`, ex.: "new_client_"). */
function clientFields(fd: FormData, prefix = ""): { name: string; site: string | null; price_cents: number | null } | { error: string } {
  const name = text(fd.get(`${prefix}name`));
  const site = text(fd.get(`${prefix}site`));
  if (name.length < 2) return { error: "O nome do cliente precisa ter pelo menos 2 caracteres." };
  if (name.length > 80) return { error: "O nome do cliente pode ter no máximo 80 caracteres." };
  if (site.length > 200) return { error: "O site do cliente pode ter no máximo 200 caracteres." };
  const price = parsePrice(fd.get(`${prefix}price`));
  if ("error" in price) return price;
  return { name, site: site || null, price_cents: price.cents };
}

function assistantName(v: FormDataEntryValue | null | undefined): { name: string } | { error: string } {
  const name = text(v);
  if (name.length < 2) return { error: "O nome do assistente precisa ter pelo menos 2 caracteres." };
  if (name.length > 40) return { error: "O nome do assistente pode ter no máximo 40 caracteres." };
  return { name };
}

/**
 * Resolve o cliente de um formulário com o seletor de cliente: `client_id` de um cliente
 * existente, ou `client_id=new` + campos `new_client_*`, que criam o cliente na hora.
 */
async function resolveClient(supabase: Db, agencyId: string, fd: FormData): Promise<{ id: string; name: string; site: string | null } | { error: string }> {
  const clientId = text(fd.get("client_id"));
  if (clientId && clientId !== "new") {
    const { data } = await supabase.from("clients").select("id, name, site").eq("id", clientId).maybeSingle();
    if (!data) return { error: "Cliente não encontrado. Recarregue a página e tente de novo." };
    return data;
  }
  const f = clientFields(fd, "new_client_");
  if ("error" in f) return f;
  const { data, error } = await supabase.from("clients").insert({ agency_id: agencyId, ...f }).select("id, name, site").single();
  if (error || !data) return { error: "Não foi possível criar o cliente. Tente de novo." };
  return data;
}

async function botLimitReached(supabase: Db, agencyId: string, limit: number) {
  const { count } = await supabase.from("bots").select("id", { count: "exact", head: true }).eq("agency_id", agencyId).eq("is_demo", false);
  return (count ?? 0) >= limit;
}

/* ------------------------------------------------------------------ clientes */

export async function createClientRecord(formData: FormData): Promise<ActionResult> {
  const { agency } = await requireAgency();
  const supabase = await createClient();
  const f = clientFields(formData);
  if ("error" in f) return fail(f.error);
  const { data, error } = await supabase.from("clients").insert({ agency_id: agency.id, ...f }).select("id").single();
  if (error || !data) return fail("Não foi possível criar o cliente. Tente de novo.");
  revalidatePath("/painel", "layout");
  redirect(`/painel/clientes/${data.id}`);
}

export async function updateClientRecord(clientId: string, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const f = clientFields(formData);
  if ("error" in f) return fail(f.error);
  const { error, count } = await supabase.from("clients").update(f, { count: "exact" }).eq("id", clientId);
  if (error) return fail("Não foi possível salvar. Tente de novo.");
  if (!count) return fail("Cliente não encontrado.");
  revalidatePath("/painel", "layout");
  return ok("Cliente atualizado.");
}

/** Só apaga cliente sem chatbots, para ninguém perder base de conhecimento sem querer. */
export async function deleteClientRecord(clientId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { count: bots } = await supabase.from("bots").select("id", { count: "exact", head: true }).eq("client_id", clientId);
  if (bots) return fail(`Este cliente tem ${bots} chatbot${bots > 1 ? "s" : ""}. Exclua ${bots > 1 ? "os chatbots" : "o chatbot"} antes.`);
  const { error, count } = await supabase.from("clients").delete({ count: "exact" }).eq("id", clientId);
  if (error) return fail("Não foi possível excluir. Tente de novo.");
  if (!count) return fail("Cliente não encontrado.");
  revalidatePath("/painel", "layout");
  redirect("/painel/clientes");
}

/* ------------------------------------------------------------------ chatbots */

/** Cria um chatbot (não demo) para um cliente e vai para o editor. */
export async function createBot(formData: FormData): Promise<ActionResult> {
  const { agency, plan } = await requireAgency();
  const supabase = await createClient();
  if (await botLimitReached(supabase, agency.id, plan.bots)) redirect("/painel/cobranca?limite=bots");

  const n = assistantName(formData.get("name"));
  if ("error" in n) return fail(n.error);
  const site = text(formData.get("client_site"));
  if (site.length > 200) return fail("O site pode ter no máximo 200 caracteres.");
  const client = await resolveClient(supabase, agency.id, formData);
  if ("error" in client) return fail(client.error);

  const { data: bot, error } = await supabase
    .from("bots")
    .insert({
      agency_id: agency.id,
      client_id: client.id,
      client_name: client.name,
      name: n.name,
      client_site: site || client.site,
      persona: { tone: "amigável, direto e profissional", welcome: `Olá! Sou ${n.name}, assistente de ${client.name}. Como posso ajudar?` },
      appearance: { color: agency.brand_color, avatar_text: initials(client.name), suggested_questions: ["Quais são os horários?", "Quanto custa?", "Como entro em contato?"] },
    })
    .select("id")
    .single();
  if (error || !bot) return fail("Não foi possível criar o chatbot. Tente de novo.");
  revalidatePath("/painel", "layout");
  redirect(`/painel/bots/${bot.id}`);
}

/** Salva personalidade, aparência, captura de leads e cliente do bot. */
export async function updateBot(botId: string, formData: FormData): Promise<ActionResult> {
  const { agency } = await requireAgency();
  const supabase = await createClient();
  const f = Object.fromEntries(formData) as Record<string, string>;
  const patch: Record<string, unknown> = {};
  if ("name" in f) {
    const n = assistantName(f.name);
    if ("error" in n) return fail(n.error);
    patch.name = n.name;
  }
  if ("client_id" in f) {
    const client = await resolveClient(supabase, agency.id, formData);
    if ("error" in client) return fail(client.error);
    patch.client_id = client.id;
    patch.client_name = client.name;
  }
  if ("client_site" in f) {
    if (f.client_site.trim().length > 200) return fail("O site pode ter no máximo 200 caracteres.");
    patch.client_site = f.client_site.trim() || null;
  }
  if ("tone" in f) {
    if (f.tone.length > 200) return fail("O tom de voz pode ter no máximo 200 caracteres.");
    if ((f.welcome ?? "").length > 300) return fail("A mensagem de boas-vindas pode ter no máximo 300 caracteres.");
    if ((f.instructions ?? "").length > 4000) return fail("As instruções podem ter no máximo 4.000 caracteres.");
    patch.persona = { tone: f.tone, welcome: f.welcome, instructions: f.instructions, language: "português do Brasil" };
  }
  if ("color" in f) {
    if (!/^#[0-9a-fA-F]{6}$/.test(f.color)) return fail("Cor inválida.");
    const offset = Math.min(200, Math.max(0, Math.round(Number(f.offset)) || 20));
    patch.appearance = { color: f.color, avatar_text: (f.avatar_text || "AI").slice(0, 2).toUpperCase(), suggested_questions: list(formData.get("suggested")), position: f.position === "left" ? "left" : "right", offset };
  }
  if ("lead_enabled" in f || "notify_email" in f) {
    const email = f.notify_email?.trim() || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("E-mail de aviso inválido.");
    patch.lead_capture = { enabled: f.lead_enabled === "on", notify_email: email, notify_whatsapp: f.notify_whatsapp?.trim() || null };
  }
  if (!Object.keys(patch).length) return fail("Nada para salvar.");

  const { error, count } = await supabase.from("bots").update(patch, { count: "exact" }).eq("id", botId);
  if (error) return fail("Não foi possível salvar. Tente de novo.");
  if (!count) return fail("Chatbot não encontrado.");
  revalidatePath("/painel", "layout");
  return ok("Alterações salvas.");
}

export async function setBotStatus(botId: string, status: "live" | "draft"): Promise<ActionResult> {
  const supabase = await createClient();
  if (status === "live") {
    const { count } = await supabase.from("sources").select("id", { count: "exact", head: true }).eq("bot_id", botId).eq("status", "ready");
    if (!count) return fail("Adicione pelo menos uma fonte pronta antes de publicar.");
  }
  const { error } = await supabase.from("bots").update({ status }).eq("id", botId);
  if (error) return fail("Não foi possível mudar o status. Tente de novo.");
  revalidatePath("/painel", "layout");
  return ok(status === "live" ? "Chatbot publicado. Ele já responde no site." : "Chatbot fora do ar. O balão some do site do cliente em até um minuto.");
}

/** Converte uma demo em chatbot de verdade (mantém a base de conhecimento), ligado a um cliente. */
export async function convertDemo(botId: string, formData: FormData): Promise<ActionResult> {
  const { agency, plan } = await requireAgency();
  const supabase = await createClient();
  if (await botLimitReached(supabase, agency.id, plan.bots)) redirect("/painel/cobranca?limite=bots");
  const n = text(formData.get("name")) ? assistantName(formData.get("name")) : null;
  if (n && "error" in n) return fail(n.error);
  const client = await resolveClient(supabase, agency.id, formData);
  if ("error" in client) return fail(client.error);
  const patch: Record<string, unknown> = { is_demo: false, demo_slug: null, status: "live", client_id: client.id, client_name: client.name };
  if (n) patch.name = n.name;
  const { error } = await supabase.from("bots").update(patch).eq("id", botId);
  if (error) return fail("Não foi possível converter a demo. Tente de novo.");
  revalidatePath("/painel", "layout");
  redirect(`/painel/bots/${botId}?tab=instalacao`);
}

/**
 * Apaga o chatbot (fontes, trechos, conversas e leads vão junto por cascade).
 * `redirectTo` quando chamado de dentro do editor; da lista, só revalida.
 */
export async function deleteBot(botId: string, redirectTo?: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error, count } = await supabase.from("bots").delete({ count: "exact" }).eq("id", botId);
  if (error) return fail("Não foi possível excluir. Tente de novo.");
  if (!count) return fail("Chatbot não encontrado.");
  revalidatePath("/painel", "layout");
  if (redirectTo) redirect(redirectTo);
  return ok("Chatbot excluído.");
}

export async function resolveUnanswered(id: string, botId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("unanswered").update({ resolved: true }).eq("id", id);
  if (error) return fail("Não foi possível marcar como resolvida.");
  revalidatePath(`/painel/bots/${botId}`);
  return ok("Marcada como resolvida.");
}

export async function deleteLead(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error, count } = await supabase.from("leads").delete({ count: "exact" }).eq("id", id);
  if (error) return fail("Não foi possível excluir o lead.");
  if (!count) return fail("Lead não encontrado.");
  revalidatePath("/painel", "layout");
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
  if (error) return fail("Não foi possível salvar a marca. Tente de novo.");
  revalidatePath("/painel", "layout");
  return ok("Marca atualizada.");
}
