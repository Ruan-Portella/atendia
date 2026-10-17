import { BOT_SIZES, PACKS, isBotSize, isPackId, type BotSize, type PackId } from "./plans";
import { botQuota } from "./quota";
import { currentPeriodBR, monthStartBR } from "./utils";

/*
 * Cobrança por tamanho (revisão de preços, parte 4): contas puras. Uma assinatura por conta, com
 * a fatura sempre no dia 1º (o mês da cota). Subir vale na hora, pagando a diferença proporcional
 * ao resto do mês e com a cota proporcional também; descer ou tirar vale no dia 1º.
 */

/** Chave de pesquisa de cada preço na Stripe (a mesma no teste e na produção). */
export const LOOKUP_KEYS = {
  atendimento: "boavoz_bot_atendimento",
  P: "boavoz_bot_p",
  M: "boavoz_bot_m",
  G: "boavoz_bot_g",
  volume: "boavoz_bot_volume",
  dominio: "boavoz_dominio",
  integracoes: "boavoz_integracoes",
  plataforma: "boavoz_plataforma",
} as const;
export type LookupKey = (typeof LOOKUP_KEYS)[keyof typeof LOOKUP_KEYS];

/** Nome de cada item da assinatura (backoffice e telas). */
export const LOOKUP_LABELS: Record<LookupKey, string> = {
  boavoz_bot_atendimento: "Chatbot Atendimento (sem IA)",
  boavoz_bot_p: "Chatbot P",
  boavoz_bot_m: "Chatbot M",
  boavoz_bot_g: "Chatbot G",
  boavoz_bot_volume: "Chatbot Volume (pacotes)",
  boavoz_dominio: "Domínio próprio",
  boavoz_integracoes: "Integrações",
  boavoz_plataforma: "Plataforma",
};

const nextPeriod = (period: string) => {
  const [y, m] = period.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};

/** Início e fim (exclusivo) do mês de São Paulo de `now`, e o dia 1º como data ('AAAA-MM-01'). */
export function monthBoundsBR(now = new Date()) {
  const period = currentPeriodBR(now);
  return { period, start: monthStartBR(period), end: monthStartBR(nextPeriod(period)), firstDay: `${period}-01` };
}

/** Quanto do mês ainda falta (de 0 a 1), por segundo, como a Stripe calcula. */
export function remainingFraction(now = new Date()): number {
  const { start, end } = monthBoundsBR(now);
  return Math.min(1, Math.max(0, (end.getTime() - now.getTime()) / (end.getTime() - start.getTime())));
}

export interface SizeChoice {
  size: BotSize | null;
  volumePacks: number | null;
}

/** Preço do mês de um chatbot com esse tamanho, em centavos (sem tamanho, zero). */
export function sizeMonthlyCents(c: SizeChoice): number {
  if (!c.size) return 0;
  if (c.size === "volume") return (c.volumePacks ?? 0) * BOT_SIZES.volume.priceBrl * 100;
  return BOT_SIZES[c.size].priceBrl * 100;
}

export interface BotChoice extends SizeChoice {
  id: string;
}

/** O que a conta assina: o tamanho de cada chatbot e os pacotes. */
export interface BillingTarget {
  bots: BotChoice[];
  packs: PackId[];
}

/** Total do mês, em centavos (o excedente sai do crédito pré-pago, fora da assinatura). */
export function targetMonthlyCents(t: BillingTarget): number {
  return t.bots.reduce((s, b) => s + sizeMonthlyCents(b), 0) + t.packs.reduce((s, p) => s + PACKS[p].priceBrl * 100, 0);
}

/** Quantidade de cada preço na assinatura: chatbots por tamanho, pacotes do Volume somados e 1 de cada pacote. */
export function targetQuantities(t: BillingTarget): Partial<Record<LookupKey, number>> {
  const q: Partial<Record<LookupKey, number>> = {};
  const add = (k: LookupKey, n: number) => {
    if (n > 0) q[k] = (q[k] ?? 0) + n;
  };
  for (const b of t.bots) {
    if (!b.size) continue;
    add(LOOKUP_KEYS[b.size], b.size === "volume" ? (b.volumePacks ?? 0) : 1);
  }
  for (const p of t.packs) add(LOOKUP_KEYS[p], 1);
  return q;
}

/**
 * Lê a escolha do formulário: `size:<id>` (P, M, G, volume ou vazio), `packs:<id>` (no Volume) e
 * `pack` (repetido). Devolve a escolha ou o motivo de recusa. Só aceita chatbots de `botIds`.
 */
export function parseTarget(fd: FormData, botIds: string[]): BillingTarget | { error: string } {
  const bots: BotChoice[] = [];
  for (const id of botIds) {
    const raw = String(fd.get(`size:${id}`) ?? "");
    if (!raw) {
      bots.push({ id, size: null, volumePacks: null });
      continue;
    }
    if (!isBotSize(raw)) return { error: "Escolha um tamanho válido para cada chatbot." };
    let packs: number | null = null;
    if (raw === "volume") {
      packs = Number(String(fd.get(`packs:${id}`) ?? "").replace(/\D/g, "") || "0");
      if (!Number.isSafeInteger(packs) || packs < 1 || packs > 1000) return { error: "No Volume, escolha de 1 a 1.000 pacotes." };
    }
    bots.push({ id, size: raw, volumePacks: packs });
  }
  const packs = [...new Set(fd.getAll("pack").map(String))];
  if (!packs.every(isPackId)) return { error: "Pacote inválido." };
  for (const p of packs) {
    const need = PACKS[p as PackId].requires;
    if (need && !packs.includes(need)) return { error: `O pacote ${PACKS[p as PackId].name} precisa do ${PACKS[need].name}.` };
  }
  return { bots, packs: packs as PackId[] };
}

/** Cota do mês de um chatbot que acabou de ganhar o tamanho: proporcional ao que falta do mês. */
export function firstMonthQuota(c: SizeChoice, now = new Date()): number {
  return Math.ceil(botQuota({ size: c.size, volume_packs: c.volumePacks }) * remainingFraction(now));
}

/** Linha do chatbot para a aplicação da compra (apply_billing_change): tamanho e cota do mês. */
export function appliedBotRow(c: BotChoice, now = new Date()) {
  if (!c.size) return { id: c.id, size: null, volume_packs: null, prorated_month: null, prorated_quota: null };
  return { id: c.id, size: c.size, volume_packs: c.size === "volume" ? c.volumePacks : null, prorated_month: monthBoundsBR(now).firstDay, prorated_quota: firstMonthQuota(c, now) };
}

/** Valor mínimo para cobrar na hora; abaixo disso, a diferença vai para a fatura do dia 1º. */
export const MIN_CHARGE_CENTS = 100;

export interface CurrentSize extends SizeChoice {
  /** Cota do mês que o chatbot já tem (a proporcional, se ganhou ou subiu neste mês). */
  monthQuota: number;
  /** Troca agendada para o dia 1º. */
  pendingSize: BotSize | "none" | null;
  pendingVolumePacks: number | null;
}

/** O que o chatbot vai ter no mês que vem: a troca agendada ou o tamanho de agora. */
export function nextChoice(b: SizeChoice & { pendingSize: BotSize | "none" | null; pendingVolumePacks: number | null }): SizeChoice {
  if (!b.pendingSize) return { size: b.size, volumePacks: b.size === "volume" ? b.volumePacks : null };
  if (b.pendingSize === "none") return { size: null, volumePacks: null };
  return { size: b.pendingSize, volumePacks: b.pendingSize === "volume" ? b.pendingVolumePacks : null };
}

const sameSize = (a: SizeChoice, b: SizeChoice) => a.size === b.size && (a.size !== "volume" || a.volumePacks === b.volumePacks);

export type SizeChange =
  | { kind: "same" }
  | { kind: "already_scheduled" }
  | { kind: "cancel_pending" }
  | { kind: "upgrade"; amountCents: number; monthQuota: number }
  | { kind: "downgrade" };

/**
 * Troca de tamanho de um chatbot numa conta com assinatura. Subir (preço maior, inclusive de
 * "sem tamanho"): paga agora a diferença proporcional ao resto do mês e a cota do mês sobe na
 * mesma proporção. Descer ou tirar: agendado para o dia 1º. Voltar ao tamanho atual cancela a
 * troca agendada.
 */
export function planSizeChange(current: CurrentSize, next: SizeChoice, now = new Date()): SizeChange {
  if (sameSize(current, next)) return current.pendingSize ? { kind: "cancel_pending" } : { kind: "same" };
  if (current.pendingSize && sameSize(nextChoice(current), next)) return { kind: "already_scheduled" };
  const cur = sizeMonthlyCents(current);
  const nxt = sizeMonthlyCents(next);
  if (nxt <= cur) return { kind: "downgrade" };
  const f = remainingFraction(now);
  const gain = Math.max(0, botQuota({ size: next.size, volume_packs: next.volumePacks }) - botQuota({ size: current.size, volume_packs: current.volumePacks }));
  return { kind: "upgrade", amountCents: Math.round((nxt - cur) * f), monthQuota: current.monthQuota + Math.ceil(gain * f) };
}

/** Pacote novo no meio do mês: o preço proporcional ao resto do mês, em centavos. */
export function packChargeCents(pack: PackId, now = new Date()): number {
  return Math.round(PACKS[pack].priceBrl * 100 * remainingFraction(now));
}

/** Pacotes que saem junto (tirar o Integrações tira a Plataforma, que precisa dele). */
export function packsRemovedWith(pack: PackId): PackId[] {
  return [pack, ...Object.values(PACKS).filter((p) => p.requires === pack).map((p) => p.id)];
}

/** "sem tamanho", "M", "Volume (2 pacotes)". */
export function choiceLabel(c: SizeChoice): string {
  if (!c.size) return "sem tamanho";
  if (c.size === "volume") return `Volume (${c.volumePacks ?? 0} pacote${c.volumePacks === 1 ? "" : "s"})`;
  return BOT_SIZES[c.size].name;
}

/** "1º de novembro": o dia 1º seguinte, quando vem a próxima fatura e vale o que foi agendado. */
export function renewalLabel(now = new Date()): string {
  return `1º de ${monthBoundsBR(now).end.toLocaleDateString("pt-BR", { month: "long", timeZone: "America/Sao_Paulo" })}`;
}
