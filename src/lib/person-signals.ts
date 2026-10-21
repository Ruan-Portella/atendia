import type { SupabaseClient } from "@supabase/supabase-js";
import { hmacHex } from "./hash";
import { TEST_ANSWERS_FREE } from "./plans";

/*
 * Trava da conta grátis (leva Trava da conta grátis, parte 1, 21/10/2026). O teste grátis vale uma
 * vez por pessoa: cada conta guarda sinais do dono só como HMAC (o e-mail normalizado, o navegador,
 * o IP do cadastro e o WhatsApp confirmado; o documento e o cartão vêm com a assinatura, na parte
 * 2). Antes da primeira resposta de teste ou da primeira demo, o banco confere se outra conta da
 * mesma pessoa já usou o teste ou assinou (free_gate, migração 0153). O suporte libera a conta
 * presa por engano.
 */

export type SignalKind = "email" | "device" | "ip" | "phone" | "doc" | "card";

/** O cookie do navegador (posto pelo proxy nas páginas de conta; só serve para a trava). */
export const DEVICE_COOKIE = "bv_d";
export const DEVICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 2;

/** O sinal de cada tipo, pelo texto da tela do backoffice. */
export const SIGNAL_LABEL: Record<SignalKind, string> = {
  email: "o mesmo e-mail",
  device: "o mesmo navegador",
  ip: "várias contas do mesmo IP no mesmo dia",
  phone: "o mesmo WhatsApp",
  doc: "o mesmo CPF ou CNPJ",
  card: "o mesmo cartão",
};

export const FREE_LINKED_TEST = `Esta conta está ligada a outra conta grátis que já usou o teste. As ${TEST_ANSWERS_FREE} respostas de teste valem uma vez por pessoa: para testar a IA, escolha um tamanho para um chatbot em Cobrança → Assinatura. Se acha que é engano, fale com o suporte.`;
export const FREE_LINKED_DEMO = "Esta conta está ligada a outra conta grátis que já usou o teste: as demos ficam liberadas com a assinatura. Se acha que é engano, fale com o suporte.";
export const FREE_LINKED_SHORT = "conta ligada a outra que já usou o teste";

/**
 * O e-mail como sinal: minúsculo e sem +apelido; no Gmail, também sem os pontos (o Gmail entrega
 * j.o.a.o+x@gmail.com para joao@gmail.com). Pura.
 */
export function normalizeEmailSignal(email: string): string {
  const [rawLocal, rawDomain] = email.trim().toLowerCase().split("@");
  if (!rawLocal || !rawDomain) return email.trim().toLowerCase();
  const domain = rawDomain === "googlemail.com" ? "gmail.com" : rawDomain;
  let local = rawLocal.split("+")[0];
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}

/** O HMAC do sinal (o valor nunca é guardado). Pura, com a chave da plataforma. */
export const signalHash = (kind: SignalKind, value: string) => hmacHex(`signal:${kind}:${value}`);

export interface SignalInput {
  kind: SignalKind;
  value: string | null | undefined;
}

/** Grava os sinais da conta (vazio fica de fora; repetido não duplica). Falha nossa não trava. */
export async function addSignals(db: SupabaseClient, agencyId: string, list: SignalInput[]): Promise<void> {
  const rows = list.filter((s): s is { kind: SignalKind; value: string } => Boolean(s.value && s.value.trim()));
  if (!rows.length) return;
  const value = (s: { kind: SignalKind; value: string }) => (s.kind === "email" ? normalizeEmailSignal(s.value) : s.value.trim());
  const { error } = await db.rpc("add_person_signals", { p_agency_id: agencyId, p_kinds: rows.map((s) => s.kind), p_hashes: rows.map((s) => signalHash(s.kind, value(s))) });
  if (error) console.error("trava da conta grátis: sinais não gravados", error.message);
}

/** No cadastro: o e-mail do dono, o navegador e o IP. */
export async function recordSignupSignals(db: SupabaseClient, agencyId: string, i: { email: string; device: string | null; ip: string | null }): Promise<void> {
  await addSignals(db, agencyId, [
    { kind: "email", value: i.email },
    { kind: "device", value: i.device },
    { kind: "ip", value: i.ip },
  ]);
}

/** A cada entrada: o navegador do dono (a conta que ele tem). */
export async function recordLoginDevice(db: SupabaseClient, userId: string, device: string | null): Promise<void> {
  if (!device) return;
  const { data } = await db.from("agencies").select("id").eq("owner_id", userId).maybeSingle();
  if (data) await addSignals(db, data.id as string, [{ kind: "device", value: device }]);
}

/** O WhatsApp confirmado pelo botão: vale como sinal só quando é o do dono da conta. */
export async function recordOwnerPhone(db: SupabaseClient, memberId: string, phoneHash: string): Promise<void> {
  const { data } = await db.from("agency_members").select("agency_id, role").eq("id", memberId).maybeSingle();
  if (data?.role === "owner") await addSignals(db, data.agency_id as string, [{ kind: "phone", value: phoneHash }]);
}

export interface FreeLink {
  agencyId: string | null;
  kinds: SignalKind[];
}

/** Para o backoffice: as outras contas (vivas ou excluídas) que têm algum sinal desta. */
export async function freeLinksOf(db: SupabaseClient, agencyId: string): Promise<FreeLink[]> {
  const { data: mine } = await db.from("person_signals").select("kind, value_hash").eq("agency_id", agencyId);
  const own = (mine ?? []) as Array<{ kind: SignalKind; value_hash: string }>;
  if (!own.length) return [];
  const { data: others } = await db.from("person_signals").select("agency_id, kind, value_hash").in("value_hash", own.map((s) => s.value_hash));
  const byAgency = new Map<string, FreeLink>();
  for (const o of (others ?? []) as Array<{ agency_id: string | null; kind: SignalKind; value_hash: string }>) {
    if (o.agency_id === agencyId || !own.some((s) => s.kind === o.kind && s.value_hash === o.value_hash)) continue;
    const key = o.agency_id ?? `excluida:${o.value_hash}`;
    const link = byAgency.get(key) ?? { agencyId: o.agency_id, kinds: [] };
    if (!link.kinds.includes(o.kind)) link.kinds.push(o.kind);
    byAgency.set(key, link);
  }
  return [...byAgency.values()];
}

/** O suporte libera (ou volta a travar) o teste grátis de uma conta presa por engano. */
export async function setFreeRelease(db: SupabaseClient, agencyId: string, release: boolean): Promise<boolean> {
  const { error } = await db.from("agencies").update(release ? { free_released_at: new Date().toISOString() } : { free_released_at: null }).eq("id", agencyId);
  return !error;
}

/** A conta grátis está presa (ligada a outra que já usou o teste, sem liberação). Pura. */
export const freeLinked = (a: { billing_status?: string | null; free_blocked_at?: string | null; free_released_at?: string | null }) =>
  (a.billing_status ?? "none") === "none" && Boolean(a.free_blocked_at) && !a.free_released_at;

/** Os sinais das contas excluídas saem 12 meses depois (tarefa diária). */
export async function purgeOrphanSignals(db: SupabaseClient, now = new Date()): Promise<number> {
  const before = new Date(now);
  before.setMonth(before.getMonth() - 12);
  const { count, error } = await db.from("person_signals").delete({ count: "exact" }).lt("orphaned_at", before.toISOString());
  if (error) console.error("trava da conta grátis: sinais antigos não apagados", error.message);
  return count ?? 0;
}

/**
 * A cada pagamento (Trava da conta grátis, parte 2): o CPF ou CNPJ de quem paga e o cartão (a
 * impressão digital que a Stripe dá ao cartão, igual em qualquer conta) viram sinais da conta.
 */
export async function recordPaymentSignals(db: SupabaseClient, customerId: string | null | undefined, taxId: string | null | undefined, cards: string[]): Promise<void> {
  if (!customerId) return;
  const { data } = await db.from("agencies").select("id").eq("stripe_customer_id", customerId).maybeSingle();
  if (!data) return;
  const doc = (taxId ?? "").replace(/\D/g, "");
  await addSignals(db, data.id as string, [{ kind: "doc", value: doc.length === 11 || doc.length === 14 ? doc : null }, ...cards.map((value) => ({ kind: "card" as const, value }))]);
}
