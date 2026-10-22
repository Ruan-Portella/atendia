"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAgency } from "@/lib/agency";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { can } from "@/lib/team";
import { hasPack } from "@/lib/entitlements";
import { audit, requestMeta } from "@/lib/audit";
import { assistantName, clientFields, text } from "@/lib/validation";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { parseFixedContext } from "@/lib/bot-context";
import { TEMPLATE_FIELDS, createDerivedBot, createTemplate, publishTemplate, setTemplateUnlocked, applyTemplateVersion } from "@/lib/bot-template";

/*
 * Modelos de chatbot (D', parte 2b): só com o pacote Plataforma, para quem cuida da configuração e
 * vê a conta inteira (o modelo não tem cliente). Cada mudança fica na auditoria.
 */

const DENIED = "Os modelos são de quem cuida da configuração e vê todos os clientes da conta.";
const NO_PACK = "Os modelos de chatbot fazem parte do pacote Plataforma (Cobrança → Assinatura).";

async function templatesContext() {
  const ctx = await requireAgency();
  if (!can(ctx.role, "config") || ctx.member.scope !== "all") return { error: DENIED };
  const db = createAdminClient();
  if (!(await hasPack(db, ctx.agency.id, "plataforma"))) return { error: NO_PACK };
  return { ctx, db };
}

type Ctx = Exclude<Awaited<ReturnType<typeof templatesContext>>, { error: string }>["ctx"];

async function auditTemplate(ctx: Ctx, action: string, id: string, after: Record<string, unknown>) {
  await audit(createAdminClient(), { agencyId: ctx.agency.id, actorType: "user", actorId: ctx.userId, action, targetType: "bot", targetId: id, after, ...(await requestMeta()) });
}

/** O modelo da conta (confere a agência e se é modelo). */
async function ownTemplate(db: ReturnType<typeof createAdminClient>, agencyId: string, id: string) {
  const { data } = await db.from("bots").select("id, name").eq("id", String(id)).eq("agency_id", agencyId).eq("is_template", true).is("version_of", null).maybeSingle();
  return data;
}

/** Cria um modelo vazio e abre o editor dele. */
export async function createTemplateAction(fd: FormData): Promise<ActionResult> {
  const c = await templatesContext();
  if ("error" in c) return fail(c.error!);
  const n = assistantName(fd.get("name"));
  if ("error" in n) return fail(n.error);
  let id: string;
  try {
    id = await createTemplate(c.db, { agencyId: c.ctx.agency.id, name: n.name, brandColor: c.ctx.agency.brand_color ?? null });
  } catch (e) {
    console.error("modelos: criar", e);
    return fail("Não foi possível criar o modelo. Tente de novo.");
  }
  await auditTemplate(c.ctx, "modelo.criar", id, { nome: n.name });
  revalidatePath("/painel/modelos");
  redirect(`/painel/bots/${id}?tab=heranca`);
}

/** O que os derivados podem mudar; aplica em todos na hora. */
export async function setTemplateUnlockedAction(templateId: string, fd: FormData): Promise<ActionResult> {
  const c = await templatesContext();
  if ("error" in c) return fail(c.error!);
  const t = await ownTemplate(c.db, c.ctx.agency.id, templateId);
  if (!t) return fail("Modelo não encontrado.");
  const fields = TEMPLATE_FIELDS.filter((f) => fd.get(`f_${f}`) === "on");
  let changed: number;
  try {
    changed = await setTemplateUnlocked(c.db, t.id as string, fields);
  } catch (e) {
    console.error("modelos: liberar campos", e);
    return fail("Não foi possível salvar. Tente de novo.");
  }
  await auditTemplate(c.ctx, "modelo.liberar", t.id as string, { campos: fields });
  revalidatePath(`/painel/bots/${t.id}`);
  return ok(changed ? `Salvo e aplicado em ${changed} chatbot${changed === 1 ? "" : "s"} derivado${changed === 1 ? "" : "s"}.` : "Salvo.");
}

/** Cria um chatbot derivado do modelo, para um cliente existente ou novo, com o contexto fixo opcional. */
export async function createDerivedAction(templateId: string, fd: FormData): Promise<ActionResult> {
  const c = await templatesContext();
  if ("error" in c) return fail(c.error!);
  const t = await ownTemplate(c.db, c.ctx.agency.id, templateId);
  if (!t) return fail("Modelo não encontrado.");
  // o contexto fixo (a loja) é opcional; vazio, o derivado nasce sem
  const rawContext = text(fd.get("fixed_context"));
  let parsed: unknown = null;
  if (rawContext) {
    try {
      parsed = JSON.parse(rawContext);
    } catch {
      return fail('O contexto fixo precisa ser um JSON, como {"loja_id": "42"}.');
    }
  }
  const ctxValue = parseFixedContext(parsed);
  if ("error" in ctxValue) return fail(ctxValue.error);
  // o cliente: um da conta (pela sessão, com o escopo dela) ou um novo
  const supabase = await createClient();
  let client: { id: string; name: string; site: string | null };
  const clientId = text(fd.get("client_id"));
  if (clientId && clientId !== "new") {
    const { data } = await supabase.from("clients").select("id, name, site").eq("id", clientId).maybeSingle();
    if (!data) return fail("Cliente não encontrado. Recarregue a página e tente de novo.");
    client = { id: data.id as string, name: data.name as string, site: (data.site as string | null) ?? null };
  } else {
    const f = clientFields(fd, "new_client_");
    if ("error" in f) return fail(f.error);
    const { data, error } = await supabase.from("clients").insert({ agency_id: c.ctx.agency.id, ...f }).select("id, name, site").single();
    if (error || !data) return fail("Não foi possível criar o cliente. Tente de novo.");
    client = { id: data.id as string, name: data.name as string, site: (data.site as string | null) ?? null };
  }
  let id: string;
  try {
    id = await createDerivedBot(c.db, { agencyId: c.ctx.agency.id, templateId: t.id as string, client, fixedContext: ctxValue.value, publishedBy: c.ctx.email });
  } catch (e) {
    console.error("modelos: criar derivado", e);
    return fail("Não foi possível criar o chatbot. Tente de novo.");
  }
  await auditTemplate(c.ctx, "modelo.derivar", id, { modelo: t.id, cliente: client.id, contexto: ctxValue.value ? Object.keys(ctxValue.value) : [] });
  revalidatePath("/painel", "layout");
  redirect(`/painel/bots/${id}`);
}

/** Publica o rascunho do modelo: versão nova, e os derivados passam a usar ela (parte 3). */
export async function publishTemplateAction(templateId: string): Promise<ActionResult> {
  const c = await templatesContext();
  if ("error" in c) return fail(c.error!);
  const t = await ownTemplate(c.db, c.ctx.agency.id, templateId);
  if (!t) return fail("Modelo não encontrado.");
  let r: { versionId: string; changed: number };
  try {
    r = await publishTemplate(c.db, t.id as string, c.ctx.email);
  } catch (e) {
    console.error("modelos: publicar", e);
    return fail("Não foi possível publicar. Tente de novo.");
  }
  const { data: v } = await c.db.from("bots").select("version_number").eq("id", r.versionId).maybeSingle();
  await auditTemplate(c.ctx, "modelo.publicar", t.id as string, { versao: v?.version_number ?? null, derivados_mudaram: r.changed });
  revalidatePath("/painel", "layout");
  return ok(`Versão ${v?.version_number ?? ""} publicada.${r.changed ? ` ${r.changed} chatbot${r.changed === 1 ? "" : "s"} derivado${r.changed === 1 ? "" : "s"} já ${r.changed === 1 ? "recebeu" : "receberam"}.` : ""}`);
}

/** Volta os derivados para uma versão publicada antes (o rascunho não muda). */
export async function restoreVersionAction(templateId: string, versionId: string): Promise<ActionResult> {
  const c = await templatesContext();
  if ("error" in c) return fail(c.error!);
  const t = await ownTemplate(c.db, c.ctx.agency.id, templateId);
  if (!t) return fail("Modelo não encontrado.");
  let changed: number | null;
  try {
    changed = await applyTemplateVersion(c.db, t.id as string, String(versionId));
  } catch (e) {
    console.error("modelos: voltar versão", e);
    return fail("Não foi possível voltar a versão. Tente de novo.");
  }
  if (changed === null) return fail("Versão não encontrada.");
  const { data: v } = await c.db.from("bots").select("version_number").eq("id", String(versionId)).maybeSingle();
  await auditTemplate(c.ctx, "modelo.voltar_versao", t.id as string, { versao: v?.version_number ?? null });
  revalidatePath("/painel", "layout");
  return ok(`Os derivados voltaram para a versão ${v?.version_number ?? ""}.`);
}
