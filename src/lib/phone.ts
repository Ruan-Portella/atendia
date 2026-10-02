/*
 * Telefone na forma canônica, antes de qualquer hash (contato, lead, supressão): só dígitos, com o
 * DDI, e celular brasileiro sempre com o 9. Assim "+55 (11) 9 8888-7777", "5511988887777" e o
 * antigo "551188887777" são o mesmo contato, sem buscar as duas formas.
 * A regra não muda depois da primeira supressão em produção (mudar perde as supressões).
 */

/**
 * - só dígitos (letras: não é telefone, ex.: o BSUID);
 * - `typed` (digitado por alguém no painel, no formulário ou dito ao assistente): 10 ou 11 dígitos
 *   são DDD + número do Brasil e ganham o 55. O wa_id da Meta já vem com o DDI: um número dos EUA
 *   tem 11 dígitos e não pode ganhar 55;
 * - 55 + 12 dígitos com o primeiro dígito local de 6 a 9 (celular antigo, sem o 9) ganha o 9;
 * - fixo e número estrangeiro ficam como estão;
 * - tamanho fora de 8 a 15 dígitos (E.164) é recusado: null.
 */
export function canonicalPhone(raw: string | null | undefined, opts: { typed?: boolean } = {}): string | null {
  const s = (raw ?? "").trim();
  if (!s || /[a-z]/i.test(s)) return null;
  let d = s.replace(/\D/g, "");
  if (opts.typed && (d.length === 10 || d.length === 11)) d = `55${d}`;
  if (d.startsWith("55") && d.length === 12 && /[6-9]/.test(d[4])) d = `${d.slice(0, 4)}9${d.slice(4)}`;
  if (d.length < 8 || d.length > 15) return null;
  return d;
}
