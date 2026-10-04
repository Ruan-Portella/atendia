import { openWithMaster, sealWithMaster } from "./keys";

/**
 * Cifra segredos guardados no banco (tokens do WhatsApp e do Instagram, segredos de ações,
 * webhooks e identidade) com a chave mestra da plataforma (keys.ts), AES-256-GCM. O formato de
 * sempre ("v1.<iv>.<tag>.<cifrado>") é a versão 1 da chave mestra; com FIELD_MASTER_KEYS, o que
 * é novo sai como "m<versão>.…" e o antigo continua abrindo.
 */
export function seal(plain: string): string {
  return sealWithMaster(plain);
}

export function unseal(sealed: string): string {
  return openWithMaster(sealed).toString("utf8");
}
