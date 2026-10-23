import Link from "next/link";
import { ChevronDown, KeyRound, Plus, Webhook } from "lucide-react";
import { webhookLimit } from "@/lib/entitlements";
import { requirePermission } from "@/lib/agency";
import { requireAgencyMfa } from "@/lib/agency-mfa";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cn, daysAgoIso, relativeTime } from "@/lib/utils";
import { HIGH_VOLUME_EVENTS, WEBHOOK_EVENT_GROUPS, type WebhookEvent } from "@/lib/webhooks";
import { API_KEY_COLS, API_PERMISSIONS, PERMISSION_LABEL, type ApiKeyRow } from "@/lib/api-keys";
import { ResultForm } from "@/components/admin/result-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { DialogButton } from "@/components/ui/setting-row";
import { HowItWorks, StatusPill } from "@/components/ui/form-section";
import { RowMenu } from "@/components/integrations/row-menu";
import { ScopeFieldset } from "@/components/integrations/scope-fieldset";
import { HeaderFields } from "@/components/integrations/action-fields";
import { headerNames } from "@/lib/integrations-input";
import { openField, openNullable } from "@/lib/field-cipher";
import { unseal } from "@/lib/secret-box";
import { createAgencyApiKey, createAgencyWebhook, deleteAgencyWebhook, redeliverAgencyDelivery, removeKeyInvitees, requeueAgencyFailures, revokeAgencyApiKey, setAgencyWebhookActive, testAgencyWebhook, updateAgencyWebhook } from "./actions";

export const metadata = { title: "Integrações" };
// o Testar chama o endpoint (até 8 s) e salvar classifica a ação com IA
export const maxDuration = 30;

const TABS = [
  ["webhooks", "Webhooks"],
  ["chaves", "Chaves de API"],
  ["logs", "Registros"],
] as const;
type Tab = (typeof TABS)[number][0];
const LOGS = [
  ["api", "Chamadas à API"],
  ["acoes", "Chamadas de ações"],
  ["entregas", "Entregas de webhooks"],
] as const;
type Log = (typeof LOGS)[number][0];

const CALL_TONE: Record<string, "ok" | "warn" | "danger"> = { ok: "ok", not_found: "warn", error: "danger", timeout: "danger", uncertain: "danger", blocked: "danger" };
const DELIVERY_LABEL: Record<string, string> = { delivered: "entregue", failed: "falhou", pending: "nova tentativa agendada" };

const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "—");
const tabClass = (on: boolean) => cn("flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[10px] px-3.5 py-1.5 text-sm font-medium transition-colors duration-[120ms]", on ? "bg-raised text-ink shadow-[inset_0_0_0_1px_var(--color-line)]" : "text-muted hover:text-ink");

/**
 * Integrações da conta (C pública): webhooks de eventos, chaves da API e o registro das chamadas
 * e entregas. Cobrem vários clientes de uma vez, então ficam na conta, só para dono e
 * administrador, com o segundo fator. As ações de consulta ficam em cada chatbot (aba Ações).
 * Redesenho, etapa 5: as abas no molde novo; cada webhook e cada chave numa linha com o Testar, o
 * Editar (painel lateral) e o "…"; criar num modal que mostra o segredo uma vez; os eventos e as
 * permissões com chaves; os registros em três sub-abas.
 */
export default async function IntegrationsPage({ searchParams }: PageProps<"/painel/integracoes">) {
  const [{ agency, packs, bots: quotas }, sp] = await Promise.all([requirePermission("integrations"), searchParams]);
  const integrations = packs.includes("integracoes");
  // chatbots no ar (com tamanho ou cota sob medida): um webhook por chatbot, no mínimo 2
  const liveCount = quotas.filter((b) => b.size || b.override !== null).length;
  const query = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : []))).toString();
  await requireAgencyMfa(`/painel/integracoes${query ? `?${query}` : ""}`);
  const tab = (TABS.some(([t]) => t === sp.aba) ? sp.aba : "webhooks") as Tab;
  const log = (LOGS.some(([t]) => t === sp.log) ? sp.log : "api") as Log;

  const supabase = await createClient();
  // a RLS limita os chatbots ao escopo de quem está logado
  const { data: botRows } = await supabase.from("bots").select("id, name, client_name").eq("is_demo", false).order("created_at");
  const bots = botRows ?? [];
  const botName = new Map(bots.map((b) => [b.id as string, b.name as string]));
  const db = createAdminClient();
  const [{ count: hookCount }, { count: keyCount }] = await Promise.all([
    db.from("webhooks").select("id", { count: "exact", head: true }).eq("agency_id", agency.id),
    db.from("api_keys").select("id", { count: "exact", head: true }).eq("agency_id", agency.id).is("revoked_at", null),
  ]);
  const counts: Record<Tab, number | null> = { webhooks: hookCount ?? null, chaves: keyCount ?? null, logs: null };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-normal sm:text-[28px]">Ações, webhooks e API</h1>
        <p className="text-sm text-muted">
          Webhooks que avisam o sistema do cliente do que acontece e chaves para ele usar a API. As ações que a IA chama na conversa ficam em cada chatbot, na aba Ações.{" "}
          <a href="/docs" target="_blank" rel="noopener" className="font-medium text-brand hover:underline">
            Documentação ↗
          </a>
        </p>
      </div>
      {!integrations && (
        <div className="card flex flex-wrap items-center gap-3 px-4 py-3.5">
          <span className="min-w-0 flex-1 text-sm text-amber-ink">Dá para cadastrar e testar. Os webhooks entregam, a API responde e as ações entram na conversa com o pacote Integrações.</span>
          <Link href="/painel/cobranca?aba=pacotes" className="btn-primary py-1.5 text-xs">
            Assinar o pacote
          </Link>
        </div>
      )}
      <nav aria-label="Integrações" className="-mx-1 flex overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        <span className="flex shrink-0 gap-1 rounded-[14px] bg-panel p-1 shadow-[inset_0_0_0_1px_var(--color-line)]">
          {TABS.map(([key, label]) => (
            <Link key={key} href={`/painel/integracoes?aba=${key}`} aria-current={tab === key ? "page" : undefined} className={tabClass(tab === key)}>
              {label}
              {Boolean(counts[key]) && <span className="tabular text-xs font-normal text-muted">{counts[key]}</span>}
            </Link>
          ))}
        </span>
      </nav>

      {tab === "webhooks" && <WebhooksTab agencyId={agency.id} webhookLimit={webhookLimit(liveCount)} bots={bots} botName={botName} />}
      {tab === "chaves" && <KeysTab agencyId={agency.id} bots={bots} botName={botName} />}
      {tab === "logs" && <LogsTab agencyId={agency.id} botIds={bots.map((b) => b.id as string)} botName={botName} db={db} log={log} />}
    </div>
  );
}

type BotRow = { id: unknown; name: unknown; client_name: unknown };

async function WebhooksTab({ agencyId, webhookLimit, bots, botName }: { agencyId: string; webhookLimit: number; bots: BotRow[]; botName: Map<string, string> }) {
  const db = createAdminClient();
  const [{ data: hookRows }, { data: clients }] = await Promise.all([
    db.from("webhooks").select("id, name, url, events, scope_type, scope_bot_ids, scope_client_id, active, disabled_at, disabled_reason, failing_since, created_at, headers_enc").eq("agency_id", agencyId).order("created_at"),
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
  // falhas em 7 dias, para o "Reenviar falhas desde"
  const { data: failedRows } = hooks.length ? await db.from("webhook_deliveries").select("webhook_id").in("webhook_id", hooks.map((h) => h.id as string)).eq("status", "failed").gte("created_at", daysAgoIso(7)).limit(5000) : { data: [] };
  const failed7 = new Map<string, number>();
  for (const f of failedRows ?? []) failed7.set(f.webhook_id as string, (failed7.get(f.webhook_id as string) ?? 0) + 1);
  const weekAgo = daysAgoIso(7).slice(0, 10);
  const botOptions = bots.map((b) => ({ id: b.id as string, name: b.name as string, clientName: b.client_name as string }));
  const clientOptions = (clients ?? []).map((c) => ({ id: c.id as string, name: c.name as string }));
  const scopeText = (h: Record<string, unknown>) =>
    h.scope_type === "all" ? "todos os chatbots" : h.scope_type === "client" ? `cliente ${clientName.get(h.scope_client_id as string) ?? "?"}` : ((h.scope_bot_ids as string[]) ?? []).map((b) => botName.get(b) ?? "?").join(", ");

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-sm text-muted">
            O BoaVoz avisa o sistema do cliente do que acontece, assinado no padrão Standard Webhooks. Limite da conta: {webhookLimit} webhook{webhookLimit === 1 ? "" : "s"} (um por chatbot no ar, no mínimo 2).
          </p>
          <HowItWorks label="Como funcionam as entregas">
            <p>2xx em até 10 s é entrega; senão, novas tentativas em 1 min, 5 min, 30 min, 2 h, 6 h, 12 h, 24 h e 24 h. Resposta 410 ou 3 dias só de falhas desativam o webhook. Reenviar usa o mesmo id de evento, com assinatura nova.</p>
          </HowItWorks>
        </div>
        {hooks.length < webhookLimit ? (
          <DialogButton label="Novo webhook" icon={<Plus size={15} />} className="btn-primary" title="Novo webhook" description="O segredo de assinatura aparece uma vez, depois de criar: copie e guarde no sistema do cliente." size="sheet" footer="close">
            <ResultForm action={createAgencyWebhook} copy className="gap-5">
              <WebhookFields botOptions={botOptions} clientOptions={clientOptions} />
              <SubmitButton className="btn-primary self-start" pendingLabel="Criando…">
                Criar webhook
              </SubmitButton>
            </ResultForm>
          </DialogButton>
        ) : (
          <span className="max-w-[240px] text-xs text-muted">A conta chegou ao limite de webhooks: um por chatbot no ar, no mínimo 2.</span>
        )}
      </div>

      {!hooks.length ? (
        <p className="card flex items-center justify-center gap-2 px-5 py-8 text-sm text-muted">
          <Webhook size={16} /> Nenhum webhook ainda.
        </p>
      ) : (
        <ul className="card flex flex-col divide-y divide-line-2 overflow-hidden">
          {hooks.map((h) => {
            const id = h.id as string;
            const hh = health.get(id);
            const worst = hh ? [...hh.byEvent].sort((a, b) => b[1] - a[1])[0] : null;
            const failing = Boolean(h.active && h.failing_since);
            const saved = headerNames(h.headers_enc as string | null);
            return (
              <li key={id} className="flex flex-col gap-2 px-4 py-3.5">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-raised text-ink-2">
                    <Webhook size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-[15px] font-medium text-ink">{h.name as string}</span>
                      <StatusPill tone={!h.active ? "danger" : failing ? "warn" : "ok"}>{!h.active ? "Desativado" : failing ? `Falhando desde ${relativeTime(h.failing_since as string)}` : "Ativo"}</StatusPill>
                    </span>
                    <span className="block truncate font-mono text-xs text-muted">{h.url as string}</span>
                    <span className="mt-0.5 block text-xs text-muted">
                      {(h.events as string[]).length} evento{(h.events as string[]).length === 1 ? "" : "s"} · {scopeText(h)}
                      {saved.length ? ` · cabeçalhos: ${saved.join(", ")}` : ""} · 24 h: {hh ? `${pct(hh.failed, hh.total)} de falha em ${hh.total}${worst ? ` (mais falha: ${worst[0]})` : ""}` : "sem entregas"}
                    </span>
                    {!h.active && h.disabled_reason && <span className="mt-0.5 block text-xs text-danger">Desativado: {h.disabled_reason as string}</span>}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <DialogButton label="Testar" className="btn-ghost py-1.5 text-xs" title={`Testar ${h.name as string}`} description="Manda um evento de teste assinado para o endereço e mostra o que ele respondeu." footer="close">
                      <ResultForm action={testAgencyWebhook.bind(null, id)}>
                        <SubmitButton className="btn-primary self-start" pendingLabel="Enviando…">
                          Enviar teste
                        </SubmitButton>
                      </ResultForm>
                    </DialogButton>
                    <DialogButton label="Editar" className="btn-ghost py-1.5 text-xs" title={`Editar ${h.name as string}`} action={updateAgencyWebhook.bind(null, id)} size="sheet">
                      <WebhookFields
                        id={id}
                        name={h.name as string}
                        url={h.url as string}
                        events={h.events as string[]}
                        scope={{ type: h.scope_type as string, botIds: (h.scope_bot_ids as string[] | null) ?? [], clientId: (h.scope_client_id as string | null) ?? null }}
                        savedHeaders={saved}
                        botOptions={botOptions}
                        clientOptions={clientOptions}
                      />
                    </DialogButton>
                    <RowMenu
                      label={`Mais ações de ${h.name as string}`}
                      items={[
                        {
                          label: h.active ? "Desativar" : "Reativar",
                          run: setAgencyWebhookActive.bind(null, id, !h.active),
                          confirm: { title: h.active ? "Desativar o webhook?" : "Reativar o webhook?", description: h.active ? "Novos eventos não são entregues nem acumulam." : "Os próximos eventos voltam a ser entregues (os de enquanto estava desativado, não).", confirmLabel: h.active ? "Desativar" : "Reativar", danger: Boolean(h.active) },
                        },
                        { label: "Apagar", danger: true, run: deleteAgencyWebhook.bind(null, id), confirm: { title: `Apagar o webhook ${h.name as string}?`, description: "As entregas dele são apagadas junto.", confirmLabel: "Apagar", danger: true } },
                      ]}
                    />
                  </span>
                </div>
                {(failed7.get(id) ?? 0) > 0 && (
                  <div className="flex flex-wrap items-center gap-2 rounded-[12px] bg-danger-soft/50 px-3 py-2">
                    <span className="min-w-0 flex-1 text-xs text-danger">
                      {failed7.get(id)} falha{failed7.get(id) === 1 ? "" : "s"} nos últimos 7 dias.
                    </span>
                    <DialogButton label="Reenviar as falhas" className="btn-ghost py-1 text-xs" title="Reenviar as falhas" description="Os eventos que falharam desde a data voltam para a fila, com o mesmo id e assinatura nova." action={requeueAgencyFailures.bind(null, id)} saveLabel="Reenviar">
                      <div>
                        <label className="label" htmlFor={`since-${id}`}>
                          Desde
                        </label>
                        <input id={`since-${id}`} type="date" name="since" defaultValue={h.failing_since ? (h.failing_since as string).slice(0, 10) : weekAgo} className="input w-auto" />
                      </div>
                    </DialogButton>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Os campos de um webhook (novo ou editar): nome, endereço, eventos, escopo e cabeçalhos. */
function WebhookFields({
  id = "novo",
  name = "",
  url = "",
  events,
  scope,
  savedHeaders = [],
  botOptions,
  clientOptions,
}: {
  id?: string;
  name?: string;
  url?: string;
  events?: string[];
  scope?: { type: string; botIds: string[]; clientId: string | null };
  savedHeaders?: string[];
  botOptions: Array<{ id: string; name: string; clientName: string }>;
  clientOptions: Array<{ id: string; name: string }>;
}) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`wh-name-${id}`}>
            Nome
          </label>
          <input id={`wh-name-${id}`} name="name" required maxLength={80} defaultValue={name} className="input" placeholder="Sistema da loja" />
        </div>
        <div>
          <label className="label" htmlFor={`wh-url-${id}`}>
            Endereço (HTTPS)
          </label>
          <input id={`wh-url-${id}`} name="url" required defaultValue={url} className="input font-mono text-[13px]" placeholder="https://api.loja.com.br/boavoz/webhook" />
        </div>
      </div>
      <EventFields checked={(e) => (events ? events.includes(e) : !HIGH_VOLUME_EVENTS.includes(e))} />
      <ScopeFieldset bots={botOptions} clients={clientOptions} value={scope} />
      <HeaderFields id={`wh-${id}`} saved={savedHeaders} />
    </>
  );
}

async function KeysTab({ agencyId, bots, botName }: { agencyId: string; bots: BotRow[]; botName: Map<string, string> }) {
  const db = createAdminClient();
  const [{ data: keyRows }, { data: clients }] = await Promise.all([
    db.from("api_keys").select(`${API_KEY_COLS}, created_at, created_by`).eq("agency_id", agencyId).order("created_at", { ascending: false }),
    db.from("clients").select("id, name").eq("agency_id", agencyId).order("name"),
  ]);
  const keys = (keyRows ?? []) as unknown as Array<ApiKeyRow & { created_at: string; created_by: string | null }>;
  const clientName = new Map((clients ?? []).map((c) => [c.id as string, c.name as string]));
  // quem cada chave convidou para o portal (D', parte 4c)
  const { data: invited } = keys.length ? await db.from("client_members").select("invited_by_key").in("invited_by_key", keys.map((k) => k.id)) : { data: [] };
  const invitees = new Map<string, number>();
  for (const m of invited ?? []) invitees.set(m.invited_by_key as string, (invitees.get(m.invited_by_key as string) ?? 0) + 1);
  const scopeText = (k: ApiKeyRow) => (k.scope_type === "all" ? "todos os chatbots (inclusive os futuros)" : k.scope_type === "client" ? `cliente ${clientName.get(k.scope_client_id ?? "") ?? "?"} (inclusive os futuros)` : k.scope_bot_ids.map((b) => botName.get(b) ?? "?").join(", "));
  const active = keys.filter((k) => !k.revoked_at);
  const revoked = keys.filter((k) => k.revoked_at);

  const row = (k: (typeof keys)[number]) => {
    const n = invitees.get(k.id) ?? 0;
    return (
      <li key={k.id} className={cn("flex flex-wrap items-center gap-3 px-4 py-3.5", k.revoked_at && "opacity-60")}>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-raised text-ink-2">
          <KeyRound size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[15px] font-medium text-ink">{k.name}</span>
            <span className="font-mono text-xs text-muted">{k.prefix}…</span>
            <StatusPill tone={k.revoked_at ? "muted" : "ok"}>{k.revoked_at ? `Revogada ${relativeTime(k.revoked_at)}` : "Ativa"}</StatusPill>
          </span>
          <span className="mt-0.5 block text-xs text-muted">{scopeText(k)}</span>
          <span className="mt-1 flex flex-wrap gap-1">
            {k.permissions.map((p) => (
              <span key={p} title={PERMISSION_LABEL[p as keyof typeof PERMISSION_LABEL]} className="rounded-full bg-raised px-2 py-px font-mono text-[11px] text-ink-2">
                {p}
              </span>
            ))}
          </span>
          <span className="mt-1 block text-xs text-muted">
            Criada {relativeTime(k.created_at)}
            {k.created_by ? ` por ${k.created_by}` : ""} · {k.last_used_at ? `último uso ${relativeTime(k.last_used_at)}` : "nunca usada"}
            {n > 0 ? ` · ${n} ${n === 1 ? "pessoa convidada" : "pessoas convidadas"} ao portal por ela` : ""}
          </span>
        </span>
        {!k.revoked_at && (
          <RowMenu
            label={`Mais ações da chave ${k.name}`}
            items={[
              ...(n > 0 ? [{ label: "Remover quem ela convidou", hint: `${n} ${n === 1 ? "pessoa perde" : "pessoas perdem"} o portal`, danger: true, run: removeKeyInvitees.bind(null, k.id), confirm: { title: `Remover as pessoas que a chave ${k.name} convidou?`, description: `${n} ${n === 1 ? "pessoa perde" : "pessoas perdem"} o acesso ao portal dos clientes na hora. Quem foi convidado pelo painel continua.`, confirmLabel: "Remover todas", danger: true } }] : []),
              { label: "Revogar a chave", danger: true, run: revokeAgencyApiKey.bind(null, k.id), confirm: { title: `Revogar a chave ${k.name}?`, description: "A próxima requisição com ela recebe 401. Não dá para desfazer: para voltar, crie outra chave.", confirmLabel: "Revogar", danger: true } },
            ]}
          />
        )}
      </li>
    );
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="min-w-0 flex-1 text-sm text-muted">
          Para o sistema do cliente usar a API (<code className="font-mono text-xs">Authorization: Bearer &lt;chave&gt;</code>), com escopo de chatbots e permissões. A chave aparece uma vez; o banco guarda só o hash. Criar e revogar avisam o dono por e-mail.
        </p>
        <DialogButton label="Nova chave" icon={<Plus size={15} />} className="btn-primary" title="Nova chave de API" description="A chave aparece uma vez, depois de criar: copie e guarde no sistema do cliente." size="lg" footer="close">
          <ResultForm action={createAgencyApiKey} copy className="gap-5">
            <div>
              <label className="label" htmlFor="key-name">
                Nome
              </label>
              <input id="key-name" name="name" required maxLength={80} className="input" placeholder="Sistema da loja, produção" />
            </div>
            <ScopeFieldset bots={bots.map((b) => ({ id: b.id as string, name: b.name as string, clientName: b.client_name as string }))} clients={(clients ?? []).map((c) => ({ id: c.id as string, name: c.name as string }))} />
            <div className="flex flex-col gap-2">
              <span className="label mb-0">Permissões</span>
              <div className="flex flex-col divide-y divide-line-2 rounded-[14px] border border-line">
                {API_PERMISSIONS.map((perm) => (
                  <label key={perm} className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0">
                      <span className="block font-mono text-[13px] text-ink">{perm}</span>
                      <span className="block text-xs text-muted">{PERMISSION_LABEL[perm]}</span>
                    </span>
                    <input type="checkbox" role="switch" name="permission" value={perm} defaultChecked={perm === "contacts"} className="switch" aria-label={perm} />
                  </label>
                ))}
              </div>
            </div>
            <SubmitButton className="btn-primary self-start" pendingLabel="Criando…">
              Criar chave
            </SubmitButton>
          </ResultForm>
        </DialogButton>
      </div>
      {!keys.length ? (
        <p className="card flex items-center justify-center gap-2 px-5 py-8 text-sm text-muted">
          <KeyRound size={16} /> Nenhuma chave ainda.
        </p>
      ) : (
        <>
          {active.length > 0 && <ul className="card flex flex-col divide-y divide-line-2 overflow-hidden">{active.map(row)}</ul>}
          {revoked.length > 0 && (
            <details className="group/rev">
              <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-sm font-medium text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
                Revogadas ({revoked.length})
                <ChevronDown size={14} className="transition-transform duration-[220ms] group-open/rev:rotate-180" />
              </summary>
              <ul className="card mt-2 flex flex-col divide-y divide-line-2 overflow-hidden">{revoked.map(row)}</ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}

const EVENT_HINT: Partial<Record<WebhookEvent, string>> = {
  "message.received": "o contato mandou mensagem ou clicou num botão (antes da IA responder)",
  "message.sent": "IA, equipe, API, campanha ou o celular respondeu",
  "message.status": "entregue e lida: até 2 eventos por mensagem enviada",
  "message.failed": "a entrega falhou, com o código da Meta",
  "message.deleted": "o contato desfez a mensagem (Instagram)",
  "lead.created": "a IA registrou um lead",
  "lead.updated": "o mesmo contato voltou com um pedido novo",
  "handoff.requested": "pediram atendente",
  "handoff.returned": "a conversa voltou para a IA",
  "conversation.assigned": "a conversa chegou a alguém da equipe (assumiu, rodízio ou transferência)",
  "conversation.transferred": "a conversa foi transferida para outra pessoa ou setor",
  "survey.answered": "o contato respondeu a pesquisa de satisfação (a nota de 1 a 3)",
  "ticket.created": "abriram um chamado no chat do site",
  "ticket.updated": "o chamado mudou de status, a equipe respondeu ou a pessoa escreveu de novo",
  "contact.opted_in": "aceitou promoções ou lembretes (chat, painel ou “Foi engano”)",
  "contact.opted_out": "pediu para sair (SAIR, botão, WhatsApp ou painel)",
  "campaign.finished": "a campanha ou o lembrete terminou de enviar, com os totais",
  "channel.connected": "WhatsApp ou Instagram conectado",
  "channel.disconnected": "WhatsApp ou Instagram desconectado, com o motivo",
  "channel.issue": "o canal está conectado mas não entrega (ex.: sem pagamento na Meta)",
  "template.status_changed": "a Meta aprovou, recusou ou pausou um modelo",
  "bot.paused": "a IA do chatbot foi pausada pelo dono",
  "bot.resumed": "a IA do chatbot voltou",
  "compliance.changed": "mudou o estado de conformidade do cliente ou as restrições",
};

/** Os eventos por grupo, cada um com a chave; message.status vem desligado (alto volume). */
function EventFields({ checked }: { checked: (e: WebhookEvent) => boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="label mb-0">Eventos</span>
      {WEBHOOK_EVENT_GROUPS.map((g) => (
        <div key={g.label} className="flex flex-col gap-1">
          <span className="kpi-label px-1">{g.label}</span>
          <div className="flex flex-col divide-y divide-line-2 rounded-[14px] border border-line">
            {g.events.map((e) => (
              <label key={e} className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0">
                  <span className="block font-mono text-[13px] text-ink">{e}</span>
                  {EVENT_HINT[e] && <span className="block text-xs text-muted">{EVENT_HINT[e]}</span>}
                </span>
                <input type="checkbox" role="switch" name="event" value={e} defaultChecked={checked(e)} className="switch" aria-label={e} />
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** O corpo guardado, legível (JSON identado quando dá). */
function pretty(text: string | null): string {
  if (!text) return "(vazio)";
  try {
    return JSON.stringify(JSON.parse(text), null, 2).slice(0, 6000);
  } catch {
    return text.slice(0, 6000);
  }
}

const Body = ({ label, text }: { label: string; text: string | null }) => (
  <div>
    <span className="label">{label}</span>
    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-[12px] bg-ground p-2 font-mono text-xs">{pretty(text)}</pre>
  </div>
);

async function LogsTab({ agencyId, botIds, botName, db, log }: { agencyId: string; botIds: string[]; botName: Map<string, string>; db: ReturnType<typeof createAdminClient>; log: Log }) {
  const { data: actionRows } = botIds.length ? await db.from("actions").select("id, name, bot_id").in("bot_id", botIds) : { data: [] };
  const actionOf = new Map((actionRows ?? []).map((a) => [a.id as string, a]));
  const [{ data: calls }, { data: hooks }, { data: apiRows }, { data: keyRows }] = await Promise.all([
    log === "acoes" && actionOf.size ? db.from("action_calls").select("id, action_id, call_id, attempt, mode, status, http_status, duration_ms, created_at, request_enc, response_enc").in("action_id", [...actionOf.keys()]).order("created_at", { ascending: false }).limit(50) : Promise.resolve({ data: [] }),
    db.from("webhooks").select("id, name, active").eq("agency_id", agencyId),
    // chamadas à API (D', parte 7): 30 dias, sem corpo
    log === "api" ? db.from("api_requests").select("id, api_key_id, method, path, status, error_code, duration_ms, replayed, created_at").eq("agency_id", agencyId).order("created_at", { ascending: false }).limit(100) : Promise.resolve({ data: [] }),
    db.from("api_keys").select("id, name, prefix").eq("agency_id", agencyId),
  ]);
  const hookOf = new Map((hooks ?? []).map((h) => [h.id as string, h]));
  const keyName = new Map((keyRows ?? []).map((k) => [k.id as string, `${k.name as string} (${k.prefix as string}…)`]));
  const { data: deliveries } = log === "entregas" && hookOf.size ? await db.from("webhook_deliveries").select("id, webhook_id, event_id, event_type, status, attempts, last_status, last_error, created_at, payload_enc, last_response_enc").in("webhook_id", [...hookOf.keys()]).order("created_at", { ascending: false }).limit(50) : { data: [] };
  // corpo e resposta abertos só aqui, para quem tem o segundo fator (os cabeçalhos nunca vão para o log)
  const callRows = await Promise.all(
    (calls ?? []).map(async (c) => ({ ...c, request: await openNullable("action_calls.request_enc", c.request_enc).catch(() => null), response: await openNullable("action_calls.response_enc", c.response_enc).catch(() => null) })),
  );
  const deliveryRows = await Promise.all(
    (deliveries ?? []).map(async (d) => ({
      ...d,
      body: await openField("webhook_deliveries.payload_enc", d.payload_enc as string).catch(() => null),
      response: d.last_response_enc
        ? (() => {
            try {
              return unseal(d.last_response_enc as string);
            } catch {
              return null;
            }
          })()
        : null,
    })),
  );
  const intro: Record<Log, string> = {
    api: "As últimas 100 dos últimos 30 dias, com a chave, o status e o código do erro. O corpo não fica guardado, e o endereço do contato no caminho aparece como {contact}.",
    acoes: "As últimas 50, com o corpo enviado e a resposta. Os cabeçalhos personalizados nunca entram no registro.",
    entregas: "As últimas 50, com o corpo e o começo da resposta. Reenviar usa o mesmo id de evento, com assinatura nova.",
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Registros">
        {LOGS.map(([k, label]) => (
          <Link key={k} href={`/painel/integracoes?aba=logs&log=${k}`} scroll={false} aria-current={log === k ? "page" : undefined} className={cn("rounded-full border px-3 py-1 text-[13px] font-medium transition-colors duration-[120ms]", log === k ? "border-brand bg-brand-soft text-brand" : "border-line text-ink-2 hover:border-line-strong")}>
            {label}
          </Link>
        ))}
      </div>
      <p className="text-xs text-muted">{intro[log]}</p>

      {log === "api" &&
        (apiRows?.length ? (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[640px] text-xs">
              <thead className="bg-raised/50 text-left text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Quando</th>
                  <th className="px-3 py-2 font-medium">Chave</th>
                  <th className="px-3 py-2 font-medium">Chamada</th>
                  <th className="px-3 py-2 font-medium">Resposta</th>
                  <th className="px-4 py-2 text-right font-medium">Tempo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-2">
                {apiRows.map((r) => (
                  <tr key={r.id as number}>
                    <td className="whitespace-nowrap px-4 py-2 text-muted">{relativeTime(r.created_at as string)}</td>
                    <td className="px-3 py-2 text-ink-2">{keyName.get(r.api_key_id as string) ?? "chave apagada"}</td>
                    <td className="px-3 py-2 font-mono text-ink">
                      {r.method as string} {r.path as string}
                    </td>
                    <td className="px-3 py-2">
                      <StatusPill tone={(r.status as number) < 400 ? "ok" : (r.status as number) >= 500 ? "danger" : "warn"}>
                        {r.status as number}
                        {r.error_code ? ` · ${r.error_code as string}` : ""}
                      </StatusPill>
                      {r.replayed ? <span className="ml-1 text-muted">repetida (Idempotency-Key)</span> : null}
                    </td>
                    <td className="px-4 py-2 text-right tabular text-muted">{r.duration_ms !== null ? `${r.duration_ms as number} ms` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="card px-5 py-8 text-center text-sm text-muted">Nenhuma chamada nos últimos 30 dias.</p>
        ))}

      {log === "acoes" &&
        (callRows.length ? (
          <ul className="card flex flex-col divide-y divide-line-2 overflow-hidden text-xs">
            {callRows.map((c) => {
              const a = actionOf.get(c.action_id as string);
              return (
                <li key={c.id as number}>
                  <details className="group/call">
                    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-raised/40 [&::-webkit-details-marker]:hidden">
                      <span className="w-24 text-muted">{relativeTime(c.created_at as string)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="font-mono text-ink">{(a?.name as string | undefined) ?? "?"}</span> <span className="text-muted">· {botName.get(a?.bot_id as string) ?? ""}</span>
                      </span>
                      <span className="text-muted">
                        {c.mode as string}
                        {(c.attempt as number) > 1 ? ` · tentativa ${c.attempt}` : ""}
                      </span>
                      <StatusPill tone={CALL_TONE[c.status as string] ?? "muted"}>
                        {c.status as string}
                        {c.http_status ? ` · ${c.http_status}` : ""}
                      </StatusPill>
                      <span className="w-16 text-right tabular text-muted">{c.duration_ms as number} ms</span>
                      <ChevronDown size={14} className="text-muted transition-transform duration-[220ms] group-open/call:rotate-180" />
                    </summary>
                    <div className="grid gap-2 px-4 pb-3 lg:grid-cols-2">
                      <Body label="Enviado" text={c.request} />
                      <Body label="Resposta" text={c.response} />
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="card px-5 py-8 text-center text-sm text-muted">Nenhuma chamada ainda.</p>
        ))}

      {log === "entregas" &&
        (deliveryRows.length ? (
          <ul className="card flex flex-col divide-y divide-line-2 overflow-hidden text-xs">
            {deliveryRows.map((d) => {
              const hook = hookOf.get(d.webhook_id as string);
              return (
                <li key={d.id as string}>
                  <details className="group/dl">
                    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-raised/40 [&::-webkit-details-marker]:hidden">
                      <span className="w-24 text-muted">{relativeTime(d.created_at as string)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="text-ink">{(hook?.name as string | undefined) ?? "?"}</span> <span className="font-mono text-muted">· {d.event_type as string}</span>
                      </span>
                      <StatusPill tone={d.status === "delivered" ? "ok" : d.status === "failed" ? "danger" : "warn"}>
                        {DELIVERY_LABEL[d.status as string] ?? (d.status as string)}
                        {d.last_status ? ` · HTTP ${d.last_status as number}` : ""}
                      </StatusPill>
                      {(d.attempts as number) > 1 && <span className="text-muted">{d.attempts as number} tentativas</span>}
                      <ChevronDown size={14} className="text-muted transition-transform duration-[220ms] group-open/dl:rotate-180" />
                    </summary>
                    <div className="flex flex-col gap-2 px-4 pb-3">
                      {d.status !== "delivered" && d.last_error ? <p className="text-danger">{d.last_error as string}</p> : null}
                      <div className="grid gap-2 lg:grid-cols-2">
                        <Body label={`Corpo (${d.event_id as string})`} text={d.body} />
                        <Body label="Resposta" text={d.response} />
                      </div>
                      {hook?.active ? (
                        <ResultForm action={redeliverAgencyDelivery.bind(null, d.id as string)}>
                          <SubmitButton className="btn-ghost self-start py-1 text-xs" pendingLabel="Reenviando…">
                            Reenviar
                          </SubmitButton>
                        </ResultForm>
                      ) : (
                        <p className="text-muted">Reative o webhook para reenviar.</p>
                      )}
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="card px-5 py-8 text-center text-sm text-muted">Nenhuma entrega ainda.</p>
        ))}
    </section>
  );
}
