import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Compara um segredo recebido com o esperado em tempo constante (sem vazar, pelo tempo de resposta,
 * quantos caracteres batem): o CRON_SECRET e os verify tokens da Meta (relatório de segurança de
 * 23/10/2026). Os dois lados viram sha256, do mesmo tamanho. Sem o esperado, recusa. Pura.
 */
export function safeEqual(received: string | null | undefined, expected: string | null | undefined): boolean {
  if (!expected || received == null) return false;
  const a = createHash("sha256").update(received).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
