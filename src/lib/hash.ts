import { createHmac } from "node:crypto";

/*
 * Hash com chave da plataforma (HMAC-SHA256), para buscar sem guardar o dado em texto: telefone,
 * BSUID, id do Instagram, ids de mensagem da Meta (o wamid contém o telefone). Não é hash simples,
 * para não dar para testar números conhecidos. A chave nunca muda depois da primeira supressão.
 */

/** CONTACT_HASH_KEY (32 bytes, própria); sem ela, derivada da chave de cifra dos tokens. */
export function platformHashKey(): string {
  const k = process.env.CONTACT_HASH_KEY ?? (process.env.WHATSAPP_TOKEN_KEY ? `hash:${process.env.WHATSAPP_TOKEN_KEY}` : "");
  if (k.length < 16) throw new Error("CONTACT_HASH_KEY (ou WHATSAPP_TOKEN_KEY) não configurada");
  return k;
}

export const hmacHex = (text: string) => createHmac("sha256", platformHashKey()).update(text).digest("hex");

/** JSON canônico (chaves em ordem): o mesmo objeto dá sempre o mesmo texto (hashes de parâmetros e de contexto). */
export const stableJson = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
};

/** Id da mensagem no canal ("wa:" + wamid, "ig:" + mid), sempre em hash. */
export const channelMsgHash = (channel: "whatsapp" | "instagram", id: string) => hmacHex(`${channel === "whatsapp" ? "wa" : "ig"}:${id}`);

/** Número-sentinela: o hash dele fica gravado no banco; se a chave mudar, o hash não bate mais. */
const SENTINEL = "sentinela:5511900000000";

/**
 * A chave de hash ainda é a mesma de quando o banco começou a usar? true: igual; false: MUDOU
 * (contatos e supressões deixam de ser achados); null: sem chave configurada. Grava na primeira vez.
 */
export async function checkHashSentinel(db: import("@supabase/supabase-js").SupabaseClient): Promise<boolean | null> {
  let expected: string;
  try {
    expected = hmacHex(SENTINEL);
  } catch {
    return null;
  }
  const { data } = await db.from("platform_flags").select("hash_sentinel").eq("id", 1).maybeSingle();
  const stored = (data as { hash_sentinel?: string | null } | null)?.hash_sentinel ?? null;
  if (!stored) {
    await db.from("platform_flags").update({ hash_sentinel: expected }).eq("id", 1);
    return true;
  }
  return stored === expected;
}
