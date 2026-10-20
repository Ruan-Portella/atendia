import type { SupabaseClient } from "@supabase/supabase-js";
import type { Persona } from "./ai";
import type { ActionRow } from "./actions";
import { initials } from "./utils";

/*
 * Bot modelo com herança (D', parte 2a, 19/10/2026; spec, Peça 8).
 *
 * O modelo é um chatbot da conta (sem cliente, sem canais, sem tamanho) com a persona, as ações, os
 * roteiros e a base comuns. O derivado (template_id):
 * - usa as ações, os roteiros e a base do modelo (lidos do modelo na hora: configBotId, asBotAction,
 *   searchBots);
 * - recebe gravados os campos herdados (derivedColumns, aplicados por applyTemplate a cada mudança
 *   do modelo), e o chat lê o derivado como sempre;
 * - pode ter valor próprio no que o modelo libera (template_unlocked): o valor fica em overrides. Se
 *   o modelo travar o campo depois, o derivado volta a seguir o modelo e o valor fica guardado, para
 *   voltar se o campo for liberado de novo.
 * Sempre do modelo: tom, idioma, instruções, assuntos do negócio, ações e roteiros. Sempre do
 * derivado: contexto fixo, nome do cliente, horário e destino do atendimento, canais e membros.
 */

export const TEMPLATE_FIELDS = ["nome", "saudacao", "aparencia", "anuncio", "instrucoes", "base"] as const;
export type TemplateField = (typeof TEMPLATE_FIELDS)[number];
export const isTemplateField = (v: unknown): v is TemplateField => typeof v === "string" && (TEMPLATE_FIELDS as readonly string[]).includes(v);
/** Os campos com valor próprio guardado em overrides (instruções e base têm lugar próprio). */
export type OverrideField = "nome" | "saudacao" | "aparencia" | "anuncio";
export const OVERRIDE_FIELDS: readonly OverrideField[] = ["nome", "saudacao", "aparencia", "anuncio"];

export const TEMPLATE_FIELD_LABEL: Record<TemplateField, string> = {
  nome: "Nome do assistente",
  saudacao: "Saudação",
  aparencia: "Aparência do chat do site",
  anuncio: "Anúncio dos atendentes",
  instrucoes: "Instruções extras (somadas às do modelo)",
  base: "Base de conhecimento própria",
};

export interface TemplateRow {
  id: string;
  name: string;
  persona: Persona | null;
  appearance: Record<string, unknown> | null;
  human_handoff: Record<string, unknown> | null;
  business_topics: string | null;
  template_unlocked: string[] | null;
}

export interface DerivedRow {
  id: string;
  name: string;
  client_name: string;
  own_base: boolean | null;
  persona: Persona | null;
  appearance: Record<string, unknown> | null;
  human_handoff: Record<string, unknown> | null;
  business_topics: string | null;
  overrides: Partial<Record<OverrideField, unknown>> | null;
  extra_instructions: string | null;
}

export const TEMPLATE_COLS = "id, name, persona, appearance, human_handoff, business_topics, template_unlocked";
export const DERIVED_COLS = "id, name, client_name, own_base, persona, appearance, human_handoff, business_topics, overrides, extra_instructions";

/** O que o modelo libera. Pura. */
export const unlockedFields = (t: Pick<TemplateRow, "template_unlocked">): TemplateField[] => (t.template_unlocked ?? []).filter(isTemplateField);

/** O derivado usa o valor dele neste campo? (o modelo libera e há valor guardado) Pura. */
export function keepsOwn(t: Pick<TemplateRow, "template_unlocked">, d: Pick<DerivedRow, "overrides">, f: OverrideField): boolean {
  return unlockedFields(t).includes(f) && Object.prototype.hasOwnProperty.call(d.overrides ?? {}, f);
}

/**
 * O chatbot de onde vêm as ações e os roteiros: no derivado, a versão publicada em vigor do modelo
 * (config_bot_id, parte 3); antes da primeira versão, o próprio modelo. Pura.
 */
export const configBotId = (bot: { id: string; template_id?: string | null; config_bot_id?: string | null }) => bot.config_bot_id ?? bot.template_id ?? bot.id;

/**
 * A ação vista como do chatbot: a do modelo, num derivado, vai com o id do derivado (a cifra do
 * registro é a do cliente dele) e assina com o segredo do modelo. De outro chatbot: null. Pura.
 */
export function asBotAction(row: ActionRow, bot: { id: string; template_id?: string | null; config_bot_id?: string | null }): ActionRow | null {
  if (row.bot_id === bot.id) return row;
  // a ação de uma versão que não vale mais: o botão já não vale (republicar encerra as confirmações abertas)
  if (bot.template_id && row.bot_id === configBotId(bot)) return { ...row, bot_id: bot.id, signing_bot_id: bot.template_id };
  return null;
}

/** Ação lida pela consulta do chatbot (ou do modelo, no derivado): no derivado, vista como dele. Pura. */
export function ofConfigBot(row: ActionRow, bot: { id: string; template_id?: string | null; config_bot_id?: string | null }): ActionRow {
  // o segredo é sempre o do modelo (trocar o segredo vale na hora, sem publicar)
  return bot.template_id ? { ...row, bot_id: bot.id, signing_bot_id: bot.template_id } : row;
}

/** A busca do derivado: a base do modelo e a dele (own_base, gravado pela propagação). Pura. */
export function searchBots(bot: { id: string; template_id?: string | null; own_base?: boolean | null }): { botId: string; alsoBotId: string | null } {
  if (!bot.template_id) return { botId: bot.id, alsoBotId: null };
  return bot.own_base === false ? { botId: bot.template_id, alsoBotId: null } : { botId: bot.id, alsoBotId: bot.template_id };
}

/** {empresa} e {assistente} na saudação do modelo viram os do derivado. Pura. */
export const fillWelcome = (text: string | undefined, o: { company: string; assistant: string }) =>
  text ? text.replaceAll("{empresa}", o.company).replaceAll("{assistente}", o.assistant) : text;

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);

/** As colunas do derivado depois de aplicar o modelo. Pura. */
export interface DerivedColumns {
  name: string;
  own_base: boolean;
  persona: Persona;
  appearance: Record<string, unknown>;
  human_handoff: Record<string, unknown>;
  business_topics: string | null;
}

export function derivedColumns(t: TemplateRow, d: DerivedRow): DerivedColumns {
  const own = (f: OverrideField) => keepsOwn(t, d, f);
  const ov = d.overrides ?? {};
  const tp = t.persona ?? {};
  const name = own("nome") ? (str(ov.nome) ?? t.name) : t.name;
  const extra = unlockedFields(t).includes("instrucoes") ? (d.extra_instructions ?? "").trim() : "";
  const instructions = [tp.instructions?.trim(), extra].filter(Boolean).join("\n\n");
  const welcome = own("saudacao") ? str(ov.saudacao) : fillWelcome(tp.welcome, { company: d.client_name, assistant: name });
  const persona: Persona = { ...tp };
  delete persona.welcome;
  delete persona.instructions;
  if (welcome) persona.welcome = welcome;
  if (instructions) persona.instructions = instructions;
  const handoff = { ...(d.human_handoff ?? {}) };
  const notice = own("anuncio") ? str(ov.anuncio) : str(t.human_handoff?.entry_notice);
  if (notice) handoff.entry_notice = notice;
  else delete handoff.entry_notice;
  const appearance = own("aparencia") && ov.aparencia && typeof ov.aparencia === "object" ? (ov.aparencia as Record<string, unknown>) : { ...(t.appearance ?? {}), avatar_text: initials(d.client_name) };
  return {
    name,
    own_base: unlockedFields(t).includes("base"),
    persona,
    appearance,
    human_handoff: handoff,
    business_topics: t.business_topics,
  };
}

/**
 * Aplica o modelo nos derivados (todos, ou só os de onlyIds) e devolve quantos mudaram. Roda depois
 * de cada mudança do modelo, na criação do derivado e em cada valor próprio salvo ou desfeito.
 */
export async function applyTemplate(db: SupabaseClient, templateId: string, onlyIds?: string[]): Promise<number> {
  const { data: draft } = await db.from("bots").select(`${TEMPLATE_COLS}, published_bot_id`).eq("id", templateId).eq("is_template", true).maybeSingle<TemplateRow & { published_bot_id: string | null }>();
  if (!draft) return 0;
  // os derivados recebem a versão publicada em vigor (parte 3); o que o modelo libera vale na hora
  const { data: version } = draft.published_bot_id ? await db.from("bots").select(TEMPLATE_COLS).eq("id", draft.published_bot_id).maybeSingle<TemplateRow>() : { data: null };
  const t: TemplateRow = version ? { ...version, template_unlocked: draft.template_unlocked } : draft;
  let q = db.from("bots").select(DERIVED_COLS).eq("template_id", templateId);
  if (onlyIds) q = q.in("id", onlyIds);
  const { data: rows, error } = await q;
  if (error) throw new Error(`modelo: derivados não carregaram (${error.message})`);
  let changed = 0;
  const list = (rows ?? []) as DerivedRow[];
  for (let i = 0; i < list.length; i += 10) {
    await Promise.all(
      list.slice(i, i + 10).map(async (d) => {
        const cols = derivedColumns(t, d);
        const before = { name: d.name, own_base: d.own_base, persona: d.persona, appearance: d.appearance, human_handoff: d.human_handoff, business_topics: d.business_topics };
        if (JSON.stringify(before) === JSON.stringify(cols)) return;
        const { error: upd } = await db.from("bots").update(cols).eq("id", d.id);
        if (upd) throw new Error(`modelo: derivado não atualizado (${upd.message})`);
        changed += 1;
      }),
    );
  }
  return changed;
}

/* ------------------------------------------------------------------ operações */

/** Nome do modelo: o que aparece na lista (o assistente usa o nome do modelo até o derivado mudar). */
export const TEMPLATE_CLIENT_LABEL = "Modelo";

/** Cria um modelo vazio (sem cliente, sem tamanho, em rascunho). */
export async function createTemplate(db: SupabaseClient, o: { agencyId: string; name: string; brandColor: string | null }): Promise<string> {
  const { data, error } = await db
    .from("bots")
    .insert({
      agency_id: o.agencyId,
      is_template: true,
      client_id: null,
      client_name: TEMPLATE_CLIENT_LABEL,
      name: o.name,
      persona: { tone: "amigável, direto e profissional", welcome: "Olá! Sou {assistente}, assistente de {empresa}. Como posso ajudar?" },
      appearance: { color: o.brandColor ?? undefined, suggested_questions: ["Quais são os horários?", "Quanto custa?", "Como entro em contato?"] },
      human_handoff: { widget_button: true },
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`modelo não criado: ${error?.message ?? "sem linha"}`);
  return String(data.id);
}

/**
 * Cria um chatbot derivado do modelo para um cliente, já com os campos herdados. O contexto fixo
 * (a loja) e o site vêm de quem cria; o resto, do modelo.
 */
export async function createDerivedBot(
  db: SupabaseClient,
  o: { agencyId: string; templateId: string; client: { id: string; name: string; site: string | null }; fixedContext?: Record<string, unknown> | null; publishedBy?: string },
): Promise<string> {
  const { data: t } = await db.from("bots").select(`${TEMPLATE_COLS}, published_bot_id`).eq("id", o.templateId).eq("agency_id", o.agencyId).eq("is_template", true).is("version_of", null).maybeSingle<TemplateRow & { published_bot_id: string | null }>();
  if (!t) throw new Error("modelo não encontrado");
  // o derivado usa sempre uma versão publicada: a primeira nasce aqui, se o modelo nunca publicou
  const configBot = t.published_bot_id ?? (await publishVersion(db, o.templateId, o.publishedBy ?? "BoaVoz (primeira versão)"));
  const { data, error } = await db
    .from("bots")
    .insert({
      agency_id: o.agencyId,
      template_id: o.templateId,
      client_id: o.client.id,
      client_name: o.client.name,
      client_site: o.client.site,
      name: t.name,
      persona: t.persona ?? {},
      appearance: t.appearance ?? {},
      human_handoff: { widget_button: true },
      fixed_context: o.fixedContext ?? null,
      config_bot_id: configBot,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`chatbot não criado: ${error?.message ?? "sem linha"}`);
  await applyTemplate(db, o.templateId, [String(data.id)]);
  return String(data.id);
}

/** O que o modelo libera para os derivados; aplica em todos. */
export async function setTemplateUnlocked(db: SupabaseClient, templateId: string, fields: TemplateField[]): Promise<number> {
  const unique = TEMPLATE_FIELDS.filter((f) => fields.includes(f));
  const { error } = await db.from("bots").update({ template_unlocked: unique }).eq("id", templateId).eq("is_template", true);
  if (error) throw new Error(`modelo: liberação não salva (${error.message})`);
  return applyTemplate(db, templateId);
}

/** Guarda (value) ou desfaz (undefined: volta a seguir o modelo) o valor próprio de um campo do derivado. */
export async function setDerivedOverride(db: SupabaseClient, bot: { id: string; template_id: string; overrides: Record<string, unknown> | null }, field: OverrideField, value: unknown): Promise<void> {
  const next = { ...(bot.overrides ?? {}) };
  if (value === undefined) delete next[field];
  else next[field] = value;
  const { error } = await db.from("bots").update({ overrides: next }).eq("id", bot.id);
  if (error) throw new Error(`derivado: valor não salvo (${error.message})`);
  await applyTemplate(db, bot.template_id, [bot.id]);
}

/** O que o derivado tem agora nos campos que podem ser próprios (para saber o que mudou). */
export interface DerivedCurrent {
  name: string;
  welcome: string | null;
  appearance: Record<string, unknown> | null;
  entryNotice: string | null;
  overrides: Record<string, unknown> | null;
}

const appearanceKey = (a: Record<string, unknown> | null | undefined) =>
  JSON.stringify([a?.color ?? null, a?.avatar_text ?? null, a?.suggested_questions ?? [], a?.position ?? "right", Number(a?.offset ?? 20)]);

/**
 * O que o formulário do painel grava num derivado (D', parte 2c). O que o modelo libera vira valor
 * próprio (overrides), mas só o que mudou: salvar a aba sem mexer num campo não corta a herança
 * dele. As instruções extras vão para a coluna delas. O tom, as instruções e os assuntos do
 * negócio vêm sempre do modelo e saem do patch, assim como o anúncio (a propagação grava). Pura.
 */
export function derivedPatch(patch: Record<string, unknown>, form: Record<string, string>, unlocked: TemplateField[], current: DerivedCurrent): Record<string, unknown> {
  const out = { ...patch };
  const ov: Record<string, unknown> = { ...(current.overrides ?? {}) };
  const open = (f: TemplateField) => unlocked.includes(f);
  const has = (f: OverrideField) => Object.prototype.hasOwnProperty.call(current.overrides ?? {}, f);
  const keep = (f: OverrideField, value: unknown, same: boolean) => {
    if (!open(f)) return;
    if (has(f) || !same) ov[f] = value;
  };
  if ("name" in out) {
    keep("nome", out.name, out.name === current.name);
    delete out.name;
  }
  if ("welcome" in form) {
    const w = form.welcome.trim();
    keep("saudacao", w, w === (current.welcome ?? ""));
  }
  delete out.persona;
  delete out.business_topics;
  if ("extra_instructions" in form && open("instrucoes")) out.extra_instructions = form.extra_instructions.trim().slice(0, 4000) || null;
  if ("appearance" in out) {
    const a = out.appearance as Record<string, unknown>;
    keep("aparencia", a, appearanceKey(a) === appearanceKey(current.appearance));
    delete out.appearance;
  }
  if ("human_handoff" in out) {
    const h = { ...(out.human_handoff as Record<string, unknown>) };
    const notice = typeof h.entry_notice === "string" ? h.entry_notice : "";
    keep("anuncio", notice || null, notice === (current.entryNotice ?? ""));
    delete h.entry_notice;
    out.human_handoff = h;
  }
  out.overrides = ov;
  return out;
}

/* ------------------------------------------------------------------ versões (parte 3) */

/** Publica o rascunho do modelo como versão nova (cópia fixa); os derivados apontam para ela. Devolve o id da versão. */
export async function publishVersion(db: SupabaseClient, templateId: string, by: string): Promise<string> {
  const { data, error } = await db.rpc("publish_template", { p_template: templateId, p_by: by });
  if (error || !data) throw new Error(`modelo: versão não publicada (${error?.message ?? "sem id"})`);
  return String(data);
}

/** Publica e aplica nos derivados: devolve a versão e quantos derivados mudaram. */
export async function publishTemplate(db: SupabaseClient, templateId: string, by: string): Promise<{ versionId: string; changed: number }> {
  const versionId = await publishVersion(db, templateId, by);
  return { versionId, changed: await applyTemplate(db, templateId) };
}

/** Volta os derivados para uma versão anterior (só o ponteiro: as versões não mudam). */
export async function applyTemplateVersion(db: SupabaseClient, templateId: string, versionId: string): Promise<number | null> {
  const { data, error } = await db.rpc("use_template_version", { p_template: templateId, p_version: versionId });
  if (error) throw new Error(`modelo: versão não aplicada (${error.message})`);
  if (!data) return null;
  return applyTemplate(db, templateId);
}

export interface TemplateVersion {
  id: string;
  number: number;
  publishedAt: string;
  publishedBy: string | null;
}

/** As versões publicadas do modelo, a mais nova primeiro. */
export async function templateVersions(db: SupabaseClient, templateId: string): Promise<TemplateVersion[]> {
  const { data } = await db.from("bots").select("id, version_number, published_at, published_by").eq("version_of", templateId).order("version_number", { ascending: false }).limit(50);
  return (data ?? []).map((v) => ({ id: String(v.id), number: Number(v.version_number), publishedAt: String(v.published_at), publishedBy: (v.published_by as string | null) ?? null }));
}

/** O rascunho tem mudanças que os derivados ainda não receberam? Pura. */
export function hasUnpublished(draftChangedAt: string | null | undefined, version: Pick<TemplateVersion, "publishedAt"> | null): boolean {
  if (!version) return true;
  return Boolean(draftChangedAt && Date.parse(draftChangedAt) > Date.parse(version.publishedAt));
}
