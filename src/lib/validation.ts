/**
 * Validações dos formulários do painel. Ficam fora de actions.ts (que só pode exportar
 * server actions) para poderem ser testadas. Erros vêm como mensagem pronta para o toast.
 */

type Field = FormDataEntryValue | null | undefined;
export type Checked<T> = T | { error: string };

export const text = (v: Field) => String(v ?? "").trim();

/** Aceita "55", "55,90", "R$ 55", "1.250" ou "1.250,00". Vazio vira null. */
export function parsePrice(v: Field): Checked<{ cents: number | null }> {
  let s = text(v).replace(/^R\$\s*/i, "");
  if (!s) return { cents: null };
  // vírgula é decimal; ponto só é decimal quando não parece separador de milhar (1.250)
  if (s.includes(",") || /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s)) return { error: "Informe um valor válido para o preço (ex.: 55 ou 55,90)." };
  const n = Number(s);
  if (n > 1_000_000) return { error: "O preço mensal parece alto demais. Confira o valor." };
  return { cents: Math.round(n * 100) };
}

/** Nome, site e preço de um cliente (campos com `prefix`, ex.: "new_client_"). */
export function clientFields(fd: FormData, prefix = ""): Checked<{ name: string; site: string | null; price_cents: number | null }> {
  const name = text(fd.get(`${prefix}name`));
  const site = text(fd.get(`${prefix}site`));
  if (name.length < 2) return { error: "O nome do cliente precisa ter pelo menos 2 caracteres." };
  if (name.length > 80) return { error: "O nome do cliente pode ter no máximo 80 caracteres." };
  if (site.length > 200) return { error: "O site do cliente pode ter no máximo 200 caracteres." };
  const price = parsePrice(fd.get(`${prefix}price`));
  if ("error" in price) return price;
  return { name, site: site || null, price_cents: price.cents };
}

export function assistantName(v: Field): Checked<{ name: string }> {
  const name = text(v);
  if (name.length < 2) return { error: "O nome do assistente precisa ter pelo menos 2 caracteres." };
  if (name.length > 40) return { error: "O nome do assistente pode ter no máximo 40 caracteres." };
  return { name };
}

export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
