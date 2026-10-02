import type { SupabaseClient } from "@supabase/supabase-js";
import { hashId } from "./rate-limit";

/*
 * Auditoria mínima (L1): quem fez o quê, só inserção, guardada 1 ano (ver a migração 0044).
 * Nunca guarda conteúdo de conversa; segredos aparecem só pelo nome e URLs sem a query.
 * Gravar a auditoria nunca derruba a ação: se falhar, fica no log do servidor.
 */

export type AuditActor = "user" | "member" | "api_key" | "support" | "system" | "link";

export interface AuditEvent {
  agencyId: string | null;
  actorType: AuditActor;
  /** id do usuário, e-mail do membro do portal, e-mail de quem usou o link de conexão… */
  actorId: string | null;
  /** verbo curto com o objeto: "bot.pausar", "canal.conectar", "idade.zerar"… */
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
}

const SECRET_KEY = /token|secret|segredo|senha|password|key|chave|_enc$|authorization|cookie/i;

/** Tira segredos (fica só o nome) e a query das URLs. Função pura. */
export function sanitize(value: unknown, depth = 0): unknown {
  if (value == null || depth > 4) return value ?? null;
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value)) {
      try {
        const u = new URL(value);
        return u.search || u.hash ? `${u.origin}${u.pathname}` : value;
      } catch {
        return value;
      }
    }
    return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitize(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = SECRET_KEY.test(k) ? (v == null ? null : "[segredo]") : sanitize(v, depth + 1);
    return out;
  }
  return value;
}

export async function audit(db: SupabaseClient, e: AuditEvent): Promise<void> {
  try {
    const { error } = await db.from("audit_log").insert({
      agency_id: e.agencyId,
      actor_type: e.actorType,
      actor_id: e.actorId,
      action: e.action,
      target_type: e.targetType ?? null,
      target_id: e.targetId ?? null,
      before: e.before ? sanitize(e.before) : null,
      after: e.after ? sanitize(e.after) : null,
      ip_hash: e.ip ? hashId(e.ip) : null,
      user_agent: e.userAgent?.slice(0, 300) ?? null,
    });
    if (error) console.error("auditoria não gravada", e.action, error.message);
  } catch (err) {
    console.error("auditoria não gravada", e.action, err);
  }
}

/** IP e navegador da requisição atual (server actions e rotas). */
export async function requestMeta(): Promise<{ ip: string | null; userAgent: string | null }> {
  const { headers } = await import("next/headers");
  const h = await headers();
  return { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null, userAgent: h.get("user-agent") };
}
