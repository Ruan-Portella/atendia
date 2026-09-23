import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Cifra segredos guardados no banco (tokens do WhatsApp de cada cliente) com AES-256-GCM.
 * A chave vem de WHATSAPP_TOKEN_KEY (qualquer texto aleatório longo; vira 32 bytes via SHA-256).
 * Trocar a chave invalida o que já foi cifrado: os clientes precisariam conectar de novo.
 */
function key(): Buffer {
  const raw = process.env.WHATSAPP_TOKEN_KEY;
  if (!raw || raw.length < 16) throw new Error("WHATSAPP_TOKEN_KEY não configurada (mínimo 16 caracteres)");
  return createHash("sha256").update(raw).digest();
}

/** "v1.<iv>.<tag>.<cifrado>", tudo em base64url. */
export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function unseal(sealed: string): string {
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("segredo em formato desconhecido");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
