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

/** Id da mensagem no canal ("wa:" + wamid, "ig:" + mid), sempre em hash. */
export const channelMsgHash = (channel: "whatsapp" | "instagram", id: string) => hmacHex(`${channel === "whatsapp" ? "wa" : "ig"}:${id}`);
