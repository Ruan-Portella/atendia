import Link from "next/link";
import { requirePermission } from "@/lib/agency";
import { requireAgencyMfa } from "@/lib/agency-mfa";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { planLimits } from "@/lib/plan-limits";
import { daysAgoIso, relativeTime } from "@/lib/utils";
import { WEBHOOK_EVENTS } from "@/lib/webhooks";
import { API_KEY_COLS, API_PERMISSIONS, PERMISSION_LABEL, type ApiKeyRow } from "@/lib/api-keys";
import { TRIAL_KEY_PERMISSIONS } from "@/lib/integrations-plan";
import { ResultForm } from "@/components/admin/result-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { ScopeFieldset } from "@/components/integrations/scope-fieldset";
import { createAgencyApiKey, createAgencyWebhook, deleteAgencyWebhook, revokeAgencyApiKey, setAgencyWebhookActive, testAgencyWebhook } from "./actions";

export const metadata = { title: "Integrações" };
// o Testar chama o endpoint (até 8 s) e salvar classifica a ação com IA
export const maxDuration = 30;

const TABS = [
  ["webhooks", "Webhooks"],
  ["chaves", "Chaves de API"],
  ["logs", "Logs"],
] as const;
type Tab = (typeof TABS)[number][0];

const CALL_TONE: Record<string, string> = { ok: "text-brand", not_found: "text-amber-ink", error: "text-danger", timeout: "text-danger", uncertain: "text-danger", blocked: "text-danger" };
const DELIVERY_LABEL: Record<string, string> = { delivered: "entregue", failed: "falhou", pending: "nova tentativa agendada" };

const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "—");

/**
 * Integrações da conta (C pública): webhooks de eventos, chaves da API e o registro das chamadas
 * e entregas. Cobrem vários clientes de uma vez, então ficam na conta, só para dono e
 * administrador, com o segundo fator. As ações de consulta ficam em cada chatbot (aba Ações).
 */
export default async function IntegrationsPage({ searchParams }: PageProps<"/painel/integracoes">) {
  const [{ agency, plan, role }, sp] = await Promise.all([requirePermission("integrations"), searchParams]);
  const limits = planLimits(plan.id);
  const query = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : []))).toString();
  if (limits.integrations) await requireAgencyMfa(`/painel/integracoes${query ? `?${query}` : ""}`);
  const tab = (TABS.some(([t]) => t === sp.aba) ? sp.aba : "webhooks") as Tab;

  if (!limits.integrations) {
    return (
      <div className="flex max-w-[860px] flex-col gap-5">
        <h1 className="text-2xl font-bold sm:text-[28px]">Integrações</h1>
        <div className="card flex flex-col gap-2 p-5 text-sm">
          <p className="font-semibold">Integrações fazem parte dos planos Agência e Escala.</p>
          <p className="text-ink-2">Com elas, o assistente consulta o sistema do cliente na conversa (pedido, agenda, saldo), o sistema recebe os eventos por webhook e envia mensagens pela API.</p>
          {role === "owner" && (
            <Link href="/painel/cobranca" className="btn-ghost self-start">
              Ver planos
            </Link>
          )}
        </div>
      </div>
    );
  }

  const supabase = await createClient();
  // a RLS limita os chatbots ao escopo de quem está logado
  const { data: botRows } = await supabase.from("bots").select("id, name, client_name").eq("is_demo", false).order("created_at");
  const bots = botRows ?? [];
  const botName = new Map(bots.map((b) => [b.id as string, b.name as string]));
  const db = createAdminClient();

  return (
    <div className="flex max-w-[960px] flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold sm:text-[28px]">Integrações</h1>
        <p className="text-sm text-muted">
          Webhooks que avisam o sistema do cliente do que acontece e chaves para ele usar a API. As ações de consulta que a IA chama na conversa ficam em cada chatbot, na aba Ações.
          {plan.id === "trial" ? " No teste grátis: ações de consulta e chaves de leitura e pausa." : ""}
        </p>
      </div>
      <nav className="flex gap-1 overflow-x-auto border-b border-line" aria-label="Integrações">
        {TABS.map(([key, label]) => (
          <Link key={key} href={`/painel/integracoes?aba=${key}`} className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm ${tab === key ? "border-brand font-semibold text-brand" : "border-transparent font-medium text-ink-2 hover:text-ink"}`}>
            {label}
          </Link>
        ))}
      </nav>

      {tab === "webhooks" && <WebhooksTab agencyId={agency.id} webhookLimit={limits.webhooks} bots={bots} botName={botName} />}
      {tab === "chaves" && <KeysTab agencyId={agency.id} trial={plan.id === "trial"} bots={bots} botName={botName} />}
      {tab === "logs" && <LogsTab agencyId={agency.id} botIds={bots.map((b) => b.id as string)} botName={botName} db={db} />}
    </div>
  );
}

type BotRow = { id: unknown; name: unknown; client_name: unknown };

async function WebhooksTab({ agencyId, webhookLimit, bots, botName }: { agencyId: string; webhookLimit: number; bots: BotRow[]; botName: Map<string, string> }) {
  const db = createAdminClient();
  const [{ data: hookRows }, { data: clients }] = await Promise.all([
    db.from("webhooks").select("id, name, url, events, scope_type, scope_bot_ids, scope_client_id, active, disabled_at, disabled_reason, failing_since, created_at, paused_by_plan_at").eq("agency_id", agencyId).order("created_at"),
    db.from("clients").select("id, name").eq("agency_id", agencyId).order("name"),
  ]);
  const hooks = hookRows ?? [];
  const clientName = new Map((clients ?? []).map((c) => [c.id as string, c.name as string]));
  // saúde: taxa de falha em 24 h e o evento que mais falha
  const since = daysAgoIso(1);
  const { data: recent } = hooks.length ? await db.from("webhook_deliveries").select("webhook_id, event_type, status").in("webhook_id", hooks.map((h) => h.id as string)).gte("created_at", since).limit(5000) : { data: [] };
  const health = new Map<string, { total: number; failed: number; byEvent: Map<string, number> }>();
  for (const d of recent ?? []) {
    const h = health.get(d.webhook_id as string) ?? { total: 0, failed: 0, byEvent: new Map() };
    h.total++;
    if (d.status !== "delivered") {
      h.failed++;
      h.byEvent.set(d.event_type as string, (h.byEvent.get(d.event_type as string) ?? 0) + 1);
    }
    health.set(d.webhook_id as string, h);
  }
  const scopeText = (h: Record<string, unknown>) =>
    h.scope_type === "all" ? "todos os chatbots" : h.scope_type === "client" ? `cliente ${clientName.get(h.scope_client_id as string) ?? "?"}` : ((h.scope_bot_ids as string[]) ?? []).map((b) => botName.get(b) ?? "?").join(", ");

  return (
    <>
      <p className="text-sm text-muted">
        O BoaVoz avisa o sistema do cliente do que acontece, assinado no padrão Standard Webhooks. 2xx em até 10 s é entrega; senão, novas tentativas em 1 min, 5 min, 30 min, 2 h, 6 h, 12 h, 24 h e 24 h. Resposta 410 ou 3 dias só de falhas
        desativam. Limite do plano: {webhookLimit} webhook{webhookLimit === 1 ? "" : "s"}. Mais eventos chegam na próxima parte das Integrações.
      </p>
      {hooks.map((h) => {
        const hh = health.get(h.id as string);
        const worst = hh ? [...hh.byEvent].sort((a, b) => b[1] - a[1])[0] : null;
        return (
          <div key={h.id as string} className="card flex flex-col gap-2 p-4 text-sm">
            <div>
              <strong>{h.name as string}</strong> <span className={h.active ? "text-brand" : "text-danger"}>{h.active ? "ativo" : `desativado${h.disabled_reason ? ` (${h.disabled_reason as string})` : ""}`}</span>
              {Boolean(h.paused_by_plan_at) && <span className="text-amber-ink"> · pausado pelo plano</span>}
              <span className="block truncate text-xs text-muted">{h.url as string}</span>
              <span className="block text-xs text-muted">
                Eventos: {(h.events as string[]).join(", ")} · escopo: {scopeText(h)}
              </span>
              <span className="block text-xs text-muted">
                Saúde em 24 h: {hh ? `${pct(hh.failed, hh.total)} de falha em ${hh.total} entrega${hh.total === 1 ? "" : "s"}${worst ? ` · mais falha: ${worst[0]}` : ""}` : "sem entregas"}
                {h.failing_since ? ` · falhando desde ${relativeTime(h.failing_since as string)}` : ""}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <ResultForm action={testAgencyWebhook.bind(null, h.id as string)}>
                <SubmitButton className="btn-ghost self-start py-1 text-xs" pendingLabel="Enviando…">Enviar teste</SubmitButton>
              </ResultForm>
              <ConfirmAction action={setAgencyWebhookActive.bind(null, h.id as string, !h.active)} title={h.active ? "Desativar o webhook?" : "Reativar o webhook?"} description={h.active ? "Novos eventos não são entregues nem acumulam." : "Os próximos eventos voltam a ser entregues (os de enquanto estava desativado, não)."} confirmLabel={h.active ? "Desativar" : "Reativar"} danger={Boolean(h.active)} className="text-xs font-semibold hover:underline">
                {h.active ? "Desativar" : "Reativar"}
              </ConfirmAction>
              <ConfirmAction action={deleteAgencyWebhook.bind(null, h.id as string)} title={`Apagar o webhook ${h.name as string}?`} description="As entregas dele são apagadas junto." confirmLabel="Apagar" className="text-xs font-semibold text-danger hover:underline">
                Apagar
              </ConfirmAction>
            </div>
          </div>
        );
      })}
      {!hooks.length && <p className="card p-5 text-sm text-muted">Nenhum webhook ainda.</p>}
      {hooks.length < webhookLimit ? (
        <details className="card p-4">
          <summary className="cursor-pointer text-sm font-semibold">+ Novo webhook</summary>
          <ResultForm action={createAgencyWebhook} copy className="mt-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="wh-name">Nome</label>
                <input id="wh-name" name="name" required maxLength={80} className="input" placeholder="Sistema da loja" />
              </div>
              <div>
                <label className="label" htmlFor="wh-url">URL (HTTPS)</label>
                <input id="wh-url" name="url" required className="input" placeholder="https://api.loja.com.br/boavoz/webhook" />
              </div>
            </div>
            <fieldset className="flex flex-col gap-1">
              <legend className="label">Eventos</legend>
              {WEBHOOK_EVENTS.map((e) => (
                <label key={e} className="flex items-center gap-2 text-xs">
                  <input type="checkbox" name="event" value={e} defaultChecked /> <span className="font-mono">{e}</span>
                </label>
              ))}
            </fieldset>
            <ScopeFieldset bots={bots.map((b) => ({ id: b.id as string, name: b.name as string, clientName: b.client_name as string }))} clients={(clients ?? []).map((c) => ({ id: c.id as string, name: c.name as string }))} />
            <SubmitButton className="btn-primary self-start py-1.5" pendingLabel="Criando…">Criar webhook</SubmitButton>
          </ResultForm>
        </details>
      ) : (
        <p className="text-xs text-muted">O plano chegou ao limite de webhooks.</p>
      )}
    </>
  );
}

async function KeysTab({ agencyId, trial, bots, botName }: { agencyId: string; trial: boolean; bots: BotRow[]; botName: Map<string, string> }) {
  const db = createAdminClient();
  const [{ data: keyRows }, { data: clients }] = await Promise.all([
    db.from("api_keys").select(`${API_KEY_COLS}, created_at, created_by`).eq("agency_id", agencyId).order("created_at", { ascending: false }),
    db.from("clients").select("id, name").eq("agency_id", agencyId).order("name"),
  ]);
  const keys = (keyRows ?? []) as unknown as Array<ApiKeyRow & { created_at: string; created_by: string | null }>;
  const clientName = new Map((clients ?? []).map((c) => [c.id as string, c.name as string]));
  const scopeText = (k: ApiKeyRow) => (k.scope_type === "all" ? "todos os chatbots (inclusive os futuros)" : k.scope_type === "client" ? `cliente ${clientName.get(k.scope_client_id ?? "") ?? "?"} (inclusive os futuros)` : k.scope_bot_ids.map((b) => botName.get(b) ?? "?").join(", "));
  const allowed = trial ? TRIAL_KEY_PERMISSIONS : API_PERMISSIONS;

  return (
    <>
      <p className="text-sm text-muted">
        Para o sistema do cliente usar a API (<code className="font-mono text-xs">Authorization: Bearer &lt;chave&gt;</code>), com escopo de chatbots e permissões. A chave aparece uma vez; o banco guarda só o hash. Criar e revogar avisam o dono por e-mail.
      </p>
      {keys.map((k) => (
        <div key={k.id} className="card flex flex-wrap items-start justify-between gap-3 p-4 text-sm">
          <div className="min-w-0">
            <strong>{k.name}</strong> <span className="font-mono text-xs text-muted">{k.prefix}…</span>
            {k.revoked_at && <span className="text-danger"> · revogada {relativeTime(k.revoked_at)}</span>}
            <span className="block text-xs text-muted">Escopo: {scopeText(k)}</span>
            <span className="block text-xs text-muted">Permissões: {k.permissions.join(", ")}</span>
            <span className="block text-xs text-muted">
              Criada {relativeTime(k.created_at)}
              {k.created_by ? ` por ${k.created_by}` : ""} · {k.last_used_at ? `último uso ${relativeTime(k.last_used_at)}` : "nunca usada"}
            </span>
          </div>
          {!k.revoked_at && (
            <ConfirmAction action={revokeAgencyApiKey.bind(null, k.id)} title={`Revogar a chave ${k.name}?`} description="A próxima requisição com ela recebe 401. Não dá para desfazer: para voltar, crie outra chave." confirmLabel="Revogar" className="text-xs font-semibold text-danger hover:underline">
              Revogar
            </ConfirmAction>
          )}
        </div>
      ))}
      {!keys.length && <p className="card p-5 text-sm text-muted">Nenhuma chave ainda.</p>}
      <details className="card p-4">
        <summary className="cursor-pointer text-sm font-semibold">+ Nova chave de API</summary>
        <ResultForm action={createAgencyApiKey} copy className="mt-3">
          <div>
            <label className="label" htmlFor="key-name">Nome</label>
            <input id="key-name" name="name" required maxLength={80} className="input" placeholder="Sistema da loja, produção" />
          </div>
          <ScopeFieldset bots={bots.map((b) => ({ id: b.id as string, name: b.name as string, clientName: b.client_name as string }))} clients={(clients ?? []).map((c) => ({ id: c.id as string, name: c.name as string }))} />
          <fieldset className="flex flex-col gap-1">
            <legend className="label">Permissões</legend>
            {allowed.map((perm) => (
              <label key={perm} className="flex items-center gap-2 text-xs">
                <input type="checkbox" name="permission" value={perm} defaultChecked={perm === "contacts"} /> <span className="font-mono">{perm}</span> <span className="text-muted">· {PERMISSION_LABEL[perm]}</span>
              </label>
            ))}
            {trial && <span className="text-xs text-muted">No teste grátis, as chaves só leem e pausam a IA. Enviar mensagens e campanhas pela API fica nos planos pagos.</span>}
          </fieldset>
          <SubmitButton className="btn-primary self-start py-1.5" pendingLabel="Criando…">Criar chave</SubmitButton>
        </ResultForm>
      </details>
    </>
  );
}

async function LogsTab({ agencyId, botIds, botName, db }: { agencyId: string; botIds: string[]; botName: Map<string, string>; db: ReturnType<typeof createAdminClient> }) {
  const { data: actionRows } = botIds.length ? await db.from("actions").select("id, name, bot_id").in("bot_id", botIds) : { data: [] };
  const actionOf = new Map((actionRows ?? []).map((a) => [a.id as string, a]));
  const [{ data: calls }, { data: hooks }] = await Promise.all([
    actionOf.size ? db.from("action_calls").select("id, action_id, call_id, attempt, mode, status, http_status, duration_ms, created_at").in("action_id", [...actionOf.keys()]).order("created_at", { ascending: false }).limit(50) : Promise.resolve({ data: [] }),
    db.from("webhooks").select("id, name").eq("agency_id", agencyId),
  ]);
  const hookName = new Map((hooks ?? []).map((h) => [h.id as string, h.name as string]));
  const { data: deliveries } = hookName.size ? await db.from("webhook_deliveries").select("id, webhook_id, event_type, status, attempts, last_status, last_error, created_at").in("webhook_id", [...hookName.keys()]).order("created_at", { ascending: false }).limit(50) : { data: [] };

  return (
    <>
      <section className="card flex flex-col gap-2 p-5">
        <h2 className="font-semibold">Chamadas de ações</h2>
        {calls?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-xs">
              <thead className="text-left text-muted">
                <tr>
                  <th className="py-1 font-semibold">Quando</th>
                  <th className="py-1 font-semibold">Ação</th>
                  <th className="py-1 font-semibold">Modo</th>
                  <th className="py-1 font-semibold">Resultado</th>
                  <th className="py-1 text-right font-semibold">Tempo</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((c) => {
                  const a = actionOf.get(c.action_id as string);
                  return (
                    <tr key={c.id as number} className="border-t border-line-2">
                      <td className="py-1.5">{relativeTime(c.created_at as string)}</td>
                      <td className="py-1.5">
                        <span className="font-mono">{(a?.name as string | undefined) ?? "?"}</span> <span className="text-muted">· {botName.get(a?.bot_id as string) ?? ""}</span>
                      </td>
                      <td className="py-1.5">
                        {c.mode as string}
                        {(c.attempt as number) > 1 ? ` · tentativa ${c.attempt}` : ""}
                      </td>
                      <td className={`py-1.5 font-semibold ${CALL_TONE[c.status as string] ?? ""}`}>
                        {c.status as string}
                        {c.http_status ? ` · ${c.http_status}` : ""}
                      </td>
                      <td className="py-1.5 text-right">{c.duration_ms as number} ms</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted">Nenhuma chamada ainda.</p>
        )}
      </section>

      <section className="card flex flex-col gap-2 p-5">
        <h2 className="font-semibold">Entregas de webhooks</h2>
        {deliveries?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-xs">
              <thead className="text-left text-muted">
                <tr>
                  <th className="py-1 font-semibold">Quando</th>
                  <th className="py-1 font-semibold">Webhook</th>
                  <th className="py-1 font-semibold">Evento</th>
                  <th className="py-1 font-semibold">Situação</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.id as string} className="border-t border-line-2">
                    <td className="py-1.5">{relativeTime(d.created_at as string)}</td>
                    <td className="py-1.5">{hookName.get(d.webhook_id as string)}</td>
                    <td className="py-1.5 font-mono">{d.event_type as string}</td>
                    <td className={`py-1.5 font-semibold ${d.status === "delivered" ? "text-brand" : d.status === "failed" ? "text-danger" : "text-amber-ink"}`}>
                      {DELIVERY_LABEL[d.status as string] ?? (d.status as string)}
                      {d.last_status ? ` · HTTP ${d.last_status as number}` : ""}
                      {(d.attempts as number) > 1 ? ` · ${d.attempts as number} tentativas` : ""}
                      {d.status !== "delivered" && d.last_error ? ` · ${d.last_error as string}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted">Nenhuma entrega ainda.</p>
        )}
      </section>
    </>
  );
}
