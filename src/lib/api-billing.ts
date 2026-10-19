import { ApiError, invalidRequest, notFound, readJsonBody, withIdempotency, type ApiContext } from "./api-v1";
import { BillingOpError, changeSize, setOverage, subscribedAccount, type BillingActor, type SizeChange } from "./billing-ops";
import { botUsage } from "./bot-usage";
import { creditBalance, purchaseCredit } from "./billing-credit";
import { CREDIT_MAX_BRL, CREDIT_MIN_BRL, isBotSize, type BotSize } from "./plans";
import { OVERAGE_CAP_MAX_BRL, OVERAGE_CAP_MIN_BRL } from "./quota";

/*
 * Cobrança pela API (revisão de preços, parte 7; spec "Tamanho e excedente pela API"), permissão
 * billing: o uso e o tamanho de cada chatbot, o excedente e o crédito da conta. A regra é a mesma
 * do painel (billing-ops): subir cobra a diferença proporcional na hora, no cartão da assinatura;
 * descer fica para o dia 1º. O crédito é da conta: só chave com escopo da conta inteira.
 */

const actorOf = (api: ApiContext): BillingActor => ({ type: "api_key", id: api.key.id });

const NO_SUBSCRIPTION = "A conta ainda não tem assinatura: a primeira é feita no painel, em Cobrança → Assinatura.";

async function agencyOf(api: ApiContext) {
  const { data, error } = await api.db
    .from("agencies")
    .select("id, billing_status, stripe_customer_id, stripe_subscription_id, credit_auto_enabled, credit_auto_below_cents, credit_auto_amount_cents, credit_auto_month_limit_cents")
    .eq("id", api.key.agency_id)
    .single();
  if (error || !data) throw new Error(`conta da chave: ${error?.message}`);
  return data;
}

function opError(e: BillingOpError): ApiError {
  if (e.code === "not_found") return notFound();
  if (e.code === "custom_quota") return new ApiError(422, "custom_quota", e.message);
  if (e.code === "not_available") return new ApiError(422, "overage_not_available", e.message);
  if (e.code === "past_due") return new ApiError(402, "payment_overdue", e.message);
  return new ApiError(500, "internal_error", e.message);
}

/** Erro no formato da API, como resposta guardável pela Idempotency-Key (402 com a fatura). */
const errorBody = (code: string, message: string, details: Record<string, unknown>) => ({ error: { code, message, details } });

function requireAccountScope(api: ApiContext) {
  if (!api.scopeAll) throw new ApiError(403, "forbidden_scope", "O crédito é da conta inteira: use uma chave com escopo de toda a conta.");
}

/* ------------------------------------------------------------------ GET /v1/bots/{id}/usage */

export async function getBotUsage(api: ApiContext, rawBotId: string): Promise<Response> {
  const botId = api.requireBot(rawBotId);
  const usage = await botUsage(api.db, api.key.agency_id, botId);
  if (!usage) throw notFound();
  return Response.json(usage);
}

/* ------------------------------------------------------------------ PATCH /v1/bots/{id} */

export interface BotPatch {
  size?: { size: BotSize | null; volumePacks: number | null };
  /** capBrl undefined: o teto fica como está. */
  overage?: { enabled: boolean; capBrl: number | null | undefined };
}

/** Lê o corpo do PATCH: size (com volume_packs no Volume) e/ou overage {enabled, cap_brl}. Função pura. */
export function parseBotPatch(body: Record<string, unknown>): BotPatch {
  const extra = Object.keys(body).find((k) => k !== "size" && k !== "volume_packs" && k !== "overage");
  if (extra) throw invalidRequest(`Campo não aceito aqui: ${extra}. Use size, volume_packs e overage.`, { field: extra });
  const out: BotPatch = {};
  if ("size" in body) {
    const size = body.size;
    if (size !== null && !isBotSize(size)) throw invalidRequest('size deve ser "atendimento", "P", "M", "G", "volume" ou null (sem tamanho).', { field: "size" });
    let volumePacks: number | null = null;
    if (size === "volume") {
      const v = body.volume_packs;
      if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 1000) throw invalidRequest("Com size volume, volume_packs vai de 1 a 1.000.", { field: "volume_packs" });
      volumePacks = v;
    } else if (body.volume_packs !== undefined && body.volume_packs !== null) {
      throw invalidRequest("volume_packs só vale com size volume.", { field: "volume_packs" });
    }
    out.size = { size, volumePacks };
  } else if (body.volume_packs !== undefined) {
    throw invalidRequest("volume_packs vai junto com size: \"volume\".", { field: "volume_packs" });
  }
  if ("overage" in body) {
    const o = body.overage;
    if (!o || typeof o !== "object" || Array.isArray(o)) throw invalidRequest("overage deve ser um objeto {enabled, cap_brl}.", { field: "overage" });
    const { enabled, cap_brl: cap } = o as Record<string, unknown>;
    if (typeof enabled !== "boolean") throw invalidRequest("overage.enabled é obrigatório (true ou false).", { field: "overage.enabled" });
    if (cap !== undefined && cap !== null && (typeof cap !== "number" || !Number.isFinite(cap) || cap < OVERAGE_CAP_MIN_BRL || cap > OVERAGE_CAP_MAX_BRL)) {
      throw invalidRequest(`overage.cap_brl vai de ${OVERAGE_CAP_MIN_BRL} a ${OVERAGE_CAP_MAX_BRL} reais (null: sem teto).`, { field: "overage.cap_brl" });
    }
    out.overage = { enabled, capBrl: cap === undefined ? undefined : cap === null ? null : Math.round(cap * 100) / 100 };
  }
  if (!out.size && !out.overage) throw invalidRequest("Mande size (e volume_packs no Volume) e/ou overage.");
  return out;
}

/** A troca de tamanho na resposta do PATCH. Função pura. */
export function sizeChangeJson(r: Exclude<SizeChange, { status: "payment_required" } | { status: "paid_meanwhile" }>) {
  if (r.status === "unchanged" || r.status === "cancelled") return { status: r.status };
  if (r.status === "already_scheduled") return { status: r.status, effective_at: r.from };
  if (r.status === "scheduled") return { status: r.status, size: r.size, volume_packs: r.volumePacks, effective_at: r.from };
  return { status: r.status, size: r.size, volume_packs: r.volumePacks, charged_brl: r.deferred ? 0 : r.amountCents / 100, next_invoice_brl: r.deferred ? r.amountCents / 100 : 0 };
}

export async function patchBot(req: Request, api: ApiContext, rawBotId: string): Promise<Response> {
  const botId = api.requireBot(rawBotId);
  const { raw, body } = await readJsonBody(req);
  const patch = parseBotPatch(body);
  if (patch.size && !req.headers.get("idempotency-key")?.trim()) {
    throw invalidRequest("Idempotency-Key é obrigatório para trocar o tamanho (subir cobra na hora, no cartão da assinatura).", { field: "Idempotency-Key" });
  }
  return withIdempotency(api, req, raw, async () => {
    const agency = await agencyOf(api);
    let sizeChange: ReturnType<typeof sizeChangeJson> | null = null;
    try {
      if (patch.size) {
        const account = subscribedAccount(agency);
        if (!account) throw new ApiError(422, "subscription_required", NO_SUBSCRIPTION);
        const r = await changeSize(api.db, account, botId, patch.size, actorOf(api));
        if (r.status === "payment_required") {
          return { status: 402, body: errorBody("payment_required", "O cartão da assinatura foi recusado ou pede autenticação. O novo tamanho vale quando a fatura for paga.", { amount_brl: r.amountCents / 100, invoice_url: r.url }) };
        }
        if (r.status === "paid_meanwhile") throw new ApiError(409, "conflict", "Uma subida anterior deste chatbot acabou de ser paga e já valeu. Confira o uso e mande de novo, se precisar.");
        sizeChange = sizeChangeJson(r);
      }
      if (patch.overage) {
        let capBrl = patch.overage.capBrl;
        if (capBrl === undefined) {
          const { data: b } = await api.db.from("bots").select("overage_cap_brl").eq("id", botId).maybeSingle();
          capBrl = b?.overage_cap_brl === null || b?.overage_cap_brl === undefined ? null : Number(b.overage_cap_brl);
        }
        await setOverage(api.db, api.key.agency_id, botId, { enabled: patch.overage.enabled, capBrl }, actorOf(api));
      }
    } catch (e) {
      if (e instanceof BillingOpError) throw opError(e);
      throw e;
    }
    const usage = await botUsage(api.db, api.key.agency_id, botId);
    if (!usage) throw notFound();
    return { status: 200, body: { ...usage, size_change: sizeChange } };
  });
}

/* ------------------------------------------------------------------ crédito */

/** GET /v1/credit: saldo, lotes que ainda valem (do que vence antes) e a recarga automática. */
export async function getCredit(api: ApiContext): Promise<Response> {
  requireAccountScope(api);
  const [agency, balance, { data: lots, error }] = await Promise.all([
    agencyOf(api),
    creditBalance(api.db, api.key.agency_id),
    api.db.from("credit_lots").select("amount_cents, remaining_cents, source, expires_at, created_at").eq("agency_id", api.key.agency_id).gt("remaining_cents", 0).gt("expires_at", new Date().toISOString()).order("expires_at"),
  ]);
  if (error) throw new Error(`crédito: ${error.message}`);
  const reais = (c: unknown) => (c === null || c === undefined ? null : Number(c) / 100);
  return Response.json({
    balance_brl: balance / 100,
    lots: (lots ?? []).map((l) => ({ amount_brl: Number(l.amount_cents) / 100, remaining_brl: Number(l.remaining_cents) / 100, source: l.source, expires_at: l.expires_at, created_at: l.created_at })),
    auto_recharge: { enabled: Boolean(agency.credit_auto_enabled), below_brl: reais(agency.credit_auto_below_cents), amount_brl: reais(agency.credit_auto_amount_cents), month_limit_brl: reais(agency.credit_auto_month_limit_cents) },
  });
}

/** POST /v1/credit/purchases: compra crédito no cartão da assinatura (Idempotency-Key obrigatório). */
export async function postCreditPurchase(req: Request, api: ApiContext): Promise<Response> {
  requireAccountScope(api);
  if (!req.headers.get("idempotency-key")?.trim()) throw invalidRequest("Idempotency-Key é obrigatório em POST /v1/credit/purchases (uma chave por compra: repetir não compra de novo).", { field: "Idempotency-Key" });
  const { raw, body } = await readJsonBody(req);
  const amount = body.amount_brl;
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount < CREDIT_MIN_BRL || amount > CREDIT_MAX_BRL) {
    throw invalidRequest(`amount_brl vai de ${CREDIT_MIN_BRL} a ${CREDIT_MAX_BRL}, em reais inteiros.`, { field: "amount_brl" });
  }
  return withIdempotency(api, req, raw, async () => {
    const account = subscribedAccount(await agencyOf(api));
    if (!account) throw new ApiError(422, "subscription_required", NO_SUBSCRIPTION);
    const r = await purchaseCredit(api.db, account, amount * 100, "compra", null, actorOf(api));
    if (r.status === "paid") return { status: 201, body: { status: "paid", amount_brl: amount, balance_brl: r.balanceCents / 100 } };
    return { status: 402, body: errorBody("payment_required", "O cartão da assinatura foi recusado ou pede autenticação. O crédito entra quando a fatura for paga.", { amount_brl: amount, invoice_url: r.url }) };
  });
}
