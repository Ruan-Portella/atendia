import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface LimitRule {
  /** Identifica o que está sendo contado, ex.: `demo:ip:<hash>`. */
  key: string;
  max: number;
  windowSeconds: number;
  /** Mensagem mostrada quando o limite estoura. */
  message: string;
}

/** IP de quem chamou (Vercel preenche x-forwarded-for / x-real-ip). */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

/** Hash curto para não guardar IP puro no banco (LGPD). */
export function hashId(value: string): string {
  const salt = process.env.RATE_LIMIT_SALT ?? process.env.SUPABASE_SERVICE_ROLE_KEY?.slice(-16) ?? "atendia";
  return createHash("sha256").update(`${salt}:${value}`).digest("hex").slice(0, 24);
}

/**
 * Confere todas as regras em paralelo e devolve a primeira que estourou (ou null).
 * Se o banco falhar (ex.: migração 0005 ainda não rodada), deixa passar: limite de uso
 * nunca pode derrubar o chat de um cliente.
 */
export async function firstExceeded(db: SupabaseClient, rules: LimitRule[]): Promise<LimitRule | null> {
  const results = await Promise.all(
    rules.map(async (r) => {
      const { data, error } = await db.rpc("hit_rate_limit", { p_key: r.key, p_max: r.max, p_window_seconds: r.windowSeconds });
      if (error) {
        console.warn("rate limit indisponível:", error.message);
        return true;
      }
      return data !== false;
    }),
  );
  const i = results.findIndex((allowed) => !allowed);
  return i === -1 ? null : rules[i];
}

/** Resposta 429 padrão, com Retry-After para clientes que respeitam. */
export function tooMany(rule: LimitRule, headers: Record<string, string> = {}): Response {
  return Response.json(
    { error: "rate_limited", message: rule.message },
    { status: 429, headers: { ...headers, "Retry-After": String(Math.min(rule.windowSeconds, 3600)) } },
  );
}
