import type { SupabaseClient } from "@supabase/supabase-js";
import { text } from "./validation";
import { BlockedUrlError, checkUrl } from "./safe-fetch";
import { WEBHOOK_EVENTS, type WebhookEvent } from "./webhooks";
import type { ApiKeyScope } from "./api-keys";
import type { ActionInput, ActionLevel } from "./actions";
import { parseCustomHeaders } from "./custom-headers";
import { seal, unseal } from "./secret-box";

/*
 * Formulários das Integrações (C pública): o mesmo cadastro de ação, escopo e webhook serve ao
 * painel da agência e ao backoffice (pilotos). Aqui só se lê e confere o formulário; quem chama
 * confere o acesso, grava, audita e avisa.
 */

/** O cadastro de ação como o formulário manda (o conteúdo é conferido por actionInputProblem). */
export interface ActionForm extends ActionInput {
  min_level: ActionLevel;
  context_required: "none" | "signed";
  outcomes: string[];
  active: boolean;
}

export function actionInputFromForm(fd: FormData): ActionForm | { error: string } {
  let schema: unknown;
  try {
    schema = JSON.parse(text(fd.get("params_schema")) || '{"type":"object","properties":{}}');
  } catch {
    return { error: "Os parâmetros não são um JSON válido." };
  }
  const level = text(fd.get("min_level"));
  return {
    name: text(fd.get("name")),
    description: String(fd.get("description") ?? "").trim(),
    url: text(fd.get("url")),
    params_schema: schema,
    min_level: (["anonimo", "canal", "usuario"].includes(level) ? level : "anonimo") as ActionLevel,
    context_required: fd.get("context_required") === "signed" ? "signed" : "none",
    outcomes: text(fd.get("outcomes"))
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean),
    active: fd.get("active") === "on",
  };
}

/**
 * Escopo de chave de API ou webhook: chatbots (um ou vários), todos os de um cliente ou todos da
 * agência (inclusive os futuros). allowedBotIds: os chatbots que quem está criando pode escolher.
 */
export async function scopeFromForm(db: SupabaseClient, agencyId: string, fd: FormData, allowedBotIds?: string[]): Promise<ApiKeyScope | { error: string }> {
  const type = text(fd.get("scope_type"));
  if (type === "all") return { type: "all" };
  if (type === "client") {
    const clientId = text(fd.get("client_id"));
    const { data: client } = clientId ? await db.from("clients").select("id").eq("id", clientId).eq("agency_id", agencyId).maybeSingle() : { data: null };
    return client ? { type: "client", clientId } : { error: "Escolha um cliente desta agência." };
  }
  const wanted = [...new Set([...fd.getAll("bot").map(String), text(fd.get("bot_id"))].filter(Boolean))].filter((id) => !allowedBotIds || allowedBotIds.includes(id));
  const { data: bots } = wanted.length ? await db.from("bots").select("id").in("id", wanted).eq("agency_id", agencyId).eq("is_demo", false) : { data: [] };
  const botIds = (bots ?? []).map((b) => b.id as string);
  return botIds.length ? { type: "bots", botIds } : { error: "Escolha ao menos um chatbot para o escopo." };
}

/** Nome, URL (só HTTPS, nunca endereço interno) e eventos de um webhook. */
export function webhookInputFromForm(fd: FormData, allowedEvents: readonly WebhookEvent[] = WEBHOOK_EVENTS): { name: string; url: string; events: WebhookEvent[] } | { error: string } {
  const name = text(fd.get("name"));
  if (!name || name.length > 80) return { error: "Dê um nome ao webhook (até 80 caracteres)." };
  const url = text(fd.get("url"));
  try {
    if (checkUrl(url).protocol !== "https:") return { error: "O webhook precisa ser HTTPS." };
  } catch (e) {
    return { error: e instanceof BlockedUrlError ? "Endereço interno não é aceito." : "URL inválida." };
  }
  const events = fd
    .getAll("event")
    .map(String)
    .filter((e): e is WebhookEvent => (allowedEvents as readonly string[]).includes(e));
  if (!events.length) return { error: "Marque ao menos um evento." };
  return { name, url, events };
}

/**
 * Cabeçalhos personalizados do formulário: texto novo troca todos, "apagar" tira, vazio mantém os
 * guardados (os valores nunca voltam à tela). headers: objeto = troca, null = apaga, undefined = mantém.
 */
export function headersFromForm(fd: FormData): { headers: Record<string, string> | null | undefined } | { error: string } {
  if (fd.get("headers_clear") === "on") return { headers: null };
  const text = String(fd.get("headers") ?? "").trim();
  if (!text) return { headers: undefined };
  const r = parseCustomHeaders(text);
  return "error" in r ? r : { headers: r.headers };
}

/** A coluna headers_enc para gravar (nada quando é para manter). */
export const headersColumn = (h: Record<string, string> | null | undefined): { headers_enc?: string | null } => (h === undefined ? {} : { headers_enc: h && Object.keys(h).length ? seal(JSON.stringify(h)) : null });

/** Nomes dos cabeçalhos personalizados guardados (os valores nunca voltam à tela). */
export const headerNames = (headersEnc: string | null | undefined): string[] => (headersEnc ? Object.keys(JSON.parse(unseal(headersEnc)) as Record<string, string>) : []);

/**
 * Quanto as ações ativas pesam em cada resposta da IA (as definições vão junto em toda chamada):
 * cerca de 4 caracteres por token, mais a moldura de cada ferramenta. Estimativa. Pura.
 */
export function actionsTokenWeight(actions: Array<{ name: string; description: string; params_schema: unknown; active: boolean }>): number {
  return actions.filter((a) => a.active).reduce((t, a) => t + Math.ceil(JSON.stringify({ name: `acao_${a.name}`, description: a.description, parameters: a.params_schema }).length / 4) + 10, 0);
}
