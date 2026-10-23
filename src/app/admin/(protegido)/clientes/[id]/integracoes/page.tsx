import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/platform-admin";
import { getAgencies } from "@/lib/backoffice";
import { createAdminClient } from "@/lib/supabase/admin";
import { relativeTime } from "@/lib/utils";
import { ResultForm } from "@/components/admin/result-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { DialogButton, SettingRow, SwitchField } from "@/components/ui/setting-row";
import { StatusPill } from "@/components/ui/form-section";
import { ReportTabs } from "@/components/report-tabs";
import { Fingerprint, KeyRound, Plus, Trash2, Webhook, Workflow } from "lucide-react";
import { createPilotApiKey, createPilotIdentitySecret, createPilotWebhook, deleteAction, deletePilotWebhook, generateActionSecret, revokePilotApiKey, revokePilotIdentitySecret, saveAction, setPilotWebhookActive, testAction, testPilotWebhook } from "../../../acoes";
import { WEBHOOK_EVENTS } from "@/lib/webhooks";
import { needsConfirmation, type ActionRow } from "@/lib/actions";
import { API_KEY_COLS, API_PERMISSIONS, PERMISSION_LABEL, type ApiKeyRow } from "@/lib/api-keys";
import { ActionFields, ActionTestForm } from "@/components/integrations/action-fields";
import { headerNames } from "@/lib/integrations-input";

export const metadata = { title: "Integrações" };
// o Testar chama o endpoint (até 8 s) e salvar classifica a ação com IA
export const maxDuration = 30;

/** Segredo anterior ainda valendo (troca sem queda): até quando. */
function previousSecretNote(until: string | null): string {
  return until && Date.parse(until) > Date.now() ? ` O anterior vale até ${new Date(until).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.` : "";
}

const STATUS_TONE: Record<string, string> = { ok: "text-brand", not_found: "text-amber-ink", error: "text-danger", timeout: "text-danger", uncertain: "text-danger", blocked: "text-danger" };

/**
 * Integrações dos pilotos (P1), configuradas à mão pelo BoaVoz: segredo de ações por chatbot,
 * ações de consulta e o registro das chamadas. As telas para a agência chegam na C pública.
 */
export default async function AdminIntegrations({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdmin(`/admin/clientes/${id}/integracoes`);
  const agency = (await getAgencies()).find((a) => a.id === id);
  if (!agency) notFound();
  const db = createAdminClient();
  const { data: bots } = await db.from("bots").select("id, name, client_name, action_secret_enc, action_secret_prev_until").eq("agency_id", id).eq("is_demo", false).order("created_at");
  const botIds = (bots ?? []).map((b) => b.id as string);
  const { data: actionRows } = botIds.length ? await db.from("actions").select("*").in("bot_id", botIds).order("name") : { data: [] };
  const actions = (actionRows ?? []) as unknown as Array<ActionRow & { updated_at: string }>;
  const { data: calls } = actions.length
    ? await db.from("action_calls").select("id, action_id, call_id, attempt, mode, status, http_status, duration_ms, created_at").in("action_id", actions.map((a) => a.id)).order("created_at", { ascending: false }).limit(20)
    : { data: [] };
  const actionName = new Map(actions.map((a) => [a.id, a.name]));
  const [{ data: keyRows }, { data: clients }, { data: secretRows }] = await Promise.all([
    db.from("api_keys").select(`${API_KEY_COLS}, created_at, created_by`).eq("agency_id", id).order("created_at", { ascending: false }),
    db.from("clients").select("id, name").eq("agency_id", id).order("name"),
    db.from("identity_secrets").select("id, kid, name, scope_type, scope_bot_id, scope_client_id, created_at, created_by, last_used_at, revoked_at").eq("agency_id", id).order("created_at", { ascending: false }),
  ]);
  const secrets = secretRows ?? [];
  const { data: hookRows } = await db.from("webhooks").select("id, name, url, events, scope_type, scope_bot_ids, scope_client_id, active, disabled_at, disabled_reason, failing_since, created_at").eq("agency_id", id).order("created_at");
  const hooks = hookRows ?? [];
  const { data: deliveries } = hooks.length
    ? await db.from("webhook_deliveries").select("id, webhook_id, event_type, status, attempts, last_status, last_error, created_at, delivered_at").in("webhook_id", hooks.map((h) => h.id as string)).order("created_at", { ascending: false }).limit(20)
    : { data: [] };
  const hookName = new Map(hooks.map((h) => [h.id as string, h.name as string]));
  const keys = (keyRows ?? []) as unknown as Array<ApiKeyRow & { created_at: string; created_by: string | null }>;
  const botName = new Map((bots ?? []).map((b) => [b.id as string, b.name as string]));
  const clientName = new Map((clients ?? []).map((c) => [c.id as string, c.name as string]));
  const scopeText = (k: ApiKeyRow) =>
    k.scope_type === "all" ? "todos os chatbots (inclusive os futuros)" : k.scope_type === "client" ? `cliente ${clientName.get(k.scope_client_id ?? "") ?? "?"} (inclusive bots futuros)` : k.scope_bot_ids.map((b) => botName.get(b) ?? "?").join(", ");

  const scopeFields = (o: { botField: "bot" | "bot_id"; botScope: "bots" | "bot"; allLabel: string; multiBots?: boolean }) => (
    <fieldset className="flex flex-col gap-2">
      <legend className="label">Escopo</legend>
      <label className="flex items-center gap-2 text-sm">
        <input type="radio" name="scope_type" value={o.botScope} defaultChecked className="accent-brand" /> {o.multiBots ? "Estes chatbots:" : "Só este chatbot:"}
      </label>
      {o.multiBots ? (
        <div className="ml-6 flex flex-col gap-1">
          {(bots ?? []).map((b) => (
            <label key={b.id as string} className="flex items-center gap-2 text-xs">
              <input type="checkbox" name={o.botField} value={b.id as string} className="accent-brand" /> {b.name as string} <span className="text-muted">({b.client_name as string})</span>
            </label>
          ))}
        </div>
      ) : (
        <select name={o.botField} className="input ml-6 w-auto text-xs" defaultValue="">
          <option value="">escolha…</option>
          {(bots ?? []).map((b) => (
            <option key={b.id as string} value={b.id as string}>
              {b.name as string} ({b.client_name as string})
            </option>
          ))}
        </select>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="radio" name="scope_type" value="client" className="accent-brand" /> Todos os chatbots do cliente:
      </label>
      <select name="client_id" className="input ml-6 w-auto text-xs" defaultValue="">
        <option value="">escolha…</option>
        {(clients ?? []).map((c) => (
          <option key={c.id as string} value={c.id as string}>
            {c.name as string}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-2 text-sm">
        <input type="radio" name="scope_type" value="all" className="accent-brand" /> {o.allLabel}
      </label>
    </fieldset>
  );
  const groupHead = (title: string, button: React.ReactNode) => (
    <div className="flex flex-wrap items-center justify-between gap-2 px-1">
      <h3 className="kpi-label">{title}</h3>
      {button}
    </div>
  );
  const NEW = "btn-ghost py-1.5 text-[13px]";

  // rodada 2 das telas (23/10/2026, a pedido do usuário: "parece o sistema antigo"): em abas, com
  // cada item numa linha; criar abre um modal (o segredo aparece ali, uma vez, para copiar)
  return (
    <>
      <div>
        <Link href={`/admin/clientes/${id}`} className="text-xs font-semibold text-muted">← {agency.name}</Link>
        <h1 className="text-[26px] font-normal">Integrações</h1>
        <p className="max-w-[760px] text-sm text-muted">
          As integrações dos pilotos, configuradas à mão pela equipe BoaVoz. A agência cuida das dela em Configurações → Integrações e na aba Ações de cada chatbot.
        </p>
      </div>

      <ReportTabs
        label="Integrações"
        tabs={[
          {
            key: "acoes",
            label: "Ações",
            count: actions.length,
            content: (
              <div className="flex flex-col gap-5">
                <p className="max-w-[760px] text-xs text-muted">
                  Ações que a IA chama durante a conversa. Cada chamada é assinada no padrão Standard Webhooks com o segredo de ações do chatbot; prazo de 8 s nas consultas e de 20 s nas &quot;executa&quot;, resposta até 32 KB. &quot;Executa&quot; (e o que o BoaVoz classifica como pedido, reserva ou cobrança) só é chamada depois do Confirmar do contato.
                </p>
                {(bots ?? []).length === 0 && <p className="card p-5 text-sm text-muted">Nenhum chatbot nesta agência.</p>}
                {(bots ?? []).map((b) => {
                  const mine = actions.filter((a) => a.bot_id === b.id);
                  return (
                    <section key={b.id as string} className="flex flex-col gap-2">
                      {groupHead(
                        `${b.name as string} · ${b.client_name as string}`,
                        <DialogButton label="Nova ação" icon={<Plus size={14} />} className={NEW} title={`Nova ação · ${b.name as string}`} size="lg" footer="close">
                          <ActionFields action={saveAction.bind(null, id, b.id as string, null)} label="Criar ação" />
                        </DialogButton>,
                      )}
                      <div className="card flex flex-col divide-y divide-line-2 overflow-hidden">
                        <SettingRow
                          icon={<KeyRound size={18} />}
                          title="Segredo de ações"
                          badge={b.action_secret_enc ? <StatusPill tone="ok">configurado</StatusPill> : <StatusPill tone="warn">falta gerar</StatusPill>}
                          summary={`${b.action_secret_enc ? "As chamadas saem assinadas." : "As ações deste chatbot não funcionam sem ele."}${previousSecretNote(b.action_secret_prev_until as string | null)}`}
                          dialogTitle="Segredo de ações"
                          description={`bot_${b.id as string}. Mostrado uma vez; quem perder, gera outro.`}
                          footer="close"
                        >
                          <ResultForm action={generateActionSecret.bind(null, id, b.id as string)} copy>
                            {Boolean(b.action_secret_enc) && <SwitchField name="invalidate" label="Invalidar o anterior agora" hint="Só quando o segredo vazou: as chamadas assinadas com ele param na hora." />}
                            <SubmitButton className="btn-primary self-start py-1.5" pendingLabel="Gerando…">{b.action_secret_enc ? "Trocar o segredo" : "Gerar segredo"}</SubmitButton>
                          </ResultForm>
                        </SettingRow>
                        {mine.map((a) => (
                          <SettingRow
                            key={a.id}
                            icon={<Workflow size={18} />}
                            title={a.name}
                            badge={<StatusPill tone={a.active ? "ok" : "muted"}>{a.active ? "ativa" : "desativada"}</StatusPill>}
                            summary={`${a.url}${needsConfirmation(a) ? ` · ${a.type === "execute" ? "executa" : "parece criar pedido"} (com Confirmar)` : ""}`}
                            dialogTitle={`Ação ${a.name}`}
                            size="lg"
                            footer="close"
                            footerStart={
                              <ConfirmAction action={deleteAction.bind(null, id, a.id)} title={`Apagar a ação ${a.name}?`} description="A IA deixa de ter esta ação. O registro das chamadas é apagado junto." confirmLabel="Apagar" className="btn-ghost text-danger">
                                <Trash2 size={14} />
                                Apagar
                              </ConfirmAction>
                            }
                          >
                            <ActionFields action={saveAction.bind(null, id, b.id as string, a.id)} a={a} label="Salvar" savedHeaders={headerNames(a.headers_enc)} />
                            <ActionTestForm action={testAction.bind(null, id, a.id)} a={a} />
                          </SettingRow>
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
            ),
          },
          {
            key: "chaves",
            label: "Chaves de API",
            count: keys.filter((k) => !k.revoked_at).length,
            content: (
              <section className="flex flex-col gap-2">
                {groupHead(
                  "Chaves de API",
                  <DialogButton label="Nova chave" icon={<Plus size={14} />} className={NEW} title="Nova chave de API" description="A chave aparece uma vez; o dono da agência recebe um aviso a cada chave criada." size="lg" footer="close">
                    <ResultForm action={createPilotApiKey.bind(null, id)} copy>
                      <div>
                        <label className="label" htmlFor="key-name">
                          Nome
                        </label>
                        <input id="key-name" name="name" required maxLength={80} className="input" placeholder="DuckDelivery produção" />
                      </div>
                      {scopeFields({ botField: "bot", botScope: "bots", allLabel: "Todos os chatbots da agência (inclusive os futuros)", multiBots: true })}
                      <fieldset className="flex flex-col gap-1">
                        <legend className="label">Permissões</legend>
                        {API_PERMISSIONS.map((perm) => (
                          <label key={perm} className="flex items-center gap-2 text-xs">
                            <input type="checkbox" name="permission" value={perm} defaultChecked={perm === "contacts"} className="accent-brand" /> <span className="font-mono">{perm}</span> <span className="text-muted">· {PERMISSION_LABEL[perm]}</span>
                          </label>
                        ))}
                      </fieldset>
                      <SubmitButton className="btn-primary self-start py-1.5" pendingLabel="Criando…">Criar chave</SubmitButton>
                    </ResultForm>
                  </DialogButton>,
                )}
                <div className="card flex flex-col divide-y divide-line-2 overflow-hidden">
                  {keys.length === 0 && <p className="px-4 py-5 text-sm text-muted">Nenhuma chave. Para a API pública (/api/v1), com escopo de chatbots e permissões.</p>}
                  {keys.map((k) => (
                    <SettingRow
                      key={k.id}
                      icon={<KeyRound size={18} />}
                      title={`${k.name} · ${k.prefix}…`}
                      badge={k.revoked_at ? <StatusPill tone="danger">revogada {relativeTime(k.revoked_at)}</StatusPill> : undefined}
                      summary={`${scopeText(k)} · ${k.permissions.join(", ")} · criada ${relativeTime(k.created_at)}${k.created_by ? ` por ${k.created_by}` : ""} · ${k.last_used_at ? `último uso ${relativeTime(k.last_used_at)}` : "nunca usada"}`}
                      trailing={
                        !k.revoked_at ? (
                          <ConfirmAction action={revokePilotApiKey.bind(null, id, k.id)} title={`Revogar a chave ${k.name}?`} description="A próxima requisição com ela recebe 401. Não dá para desfazer: para voltar, crie outra chave." confirmLabel="Revogar" className="btn-ghost text-danger">
                            Revogar
                          </ConfirmAction>
                        ) : undefined
                      }
                    />
                  ))}
                </div>
              </section>
            ),
          },
          {
            key: "identidade",
            label: "Identidade",
            count: secrets.filter((k) => !k.revoked_at).length,
            content: (
              <section className="flex flex-col gap-2">
                {groupHead(
                  "Segredos de identidade (chat do site)",
                  <DialogButton
                    label="Novo segredo"
                    icon={<Plus size={14} />}
                    className={NEW}
                    title="Novo segredo de identidade"
                    description={
                      <>
                        O servidor do SaaS assina um token (JWT HS256, com o kid no cabeçalho) e o widget manda em toda mensagem: a pessoa vira nível usuário, a conversa fica presa a ela e ao contexto (workspace), e as ações recebem external_id e contexto. No site: <span className="font-mono">window.ChatWidgetConfig = {"{ getToken }"}</span>.
                      </>
                    }
                    size="lg"
                    footer="close"
                  >
                    <ResultForm action={createPilotIdentitySecret.bind(null, id)} copy>
                      <div>
                        <label className="label" htmlFor="ids-name">
                          Nome
                        </label>
                        <input id="ids-name" name="name" required maxLength={80} className="input" placeholder="Fintra produção" />
                      </div>
                      {scopeFields({ botField: "bot_id", botScope: "bot", allLabel: "Todos os chatbots da agência (Plataforma)" })}
                      <SubmitButton className="btn-primary self-start py-1.5" pendingLabel="Criando…">Criar segredo</SubmitButton>
                    </ResultForm>
                  </DialogButton>,
                )}
                <div className="card flex flex-col divide-y divide-line-2 overflow-hidden">
                  {secrets.length === 0 && <p className="px-4 py-5 text-sm text-muted">Nenhum segredo de identidade.</p>}
                  {secrets.map((k) => (
                    <SettingRow
                      key={k.id as string}
                      icon={<Fingerprint size={18} />}
                      title={`${k.name as string} · ${k.kid as string}`}
                      badge={k.revoked_at ? <StatusPill tone="danger">revogado {relativeTime(k.revoked_at as string)}</StatusPill> : undefined}
                      summary={`${k.scope_type === "all" ? "todos os chatbots da agência" : k.scope_type === "client" ? `cliente ${clientName.get(k.scope_client_id as string) ?? "?"}` : `chatbot ${botName.get(k.scope_bot_id as string) ?? "?"}`} · criado ${relativeTime(k.created_at as string)}${k.created_by ? ` por ${k.created_by as string}` : ""} · ${k.last_used_at ? `último uso ${relativeTime(k.last_used_at as string)}` : "nunca usado"}`}
                      trailing={
                        !k.revoked_at ? (
                          <ConfirmAction action={revokePilotIdentitySecret.bind(null, id, k.id as string)} title={`Revogar o segredo ${k.name as string}?`} description="Tokens assinados com ele deixam de valer na hora: as pessoas identificadas voltam a anônimas até o SaaS usar um segredo novo." confirmLabel="Revogar" className="btn-ghost text-danger">
                            Revogar
                          </ConfirmAction>
                        ) : undefined
                      }
                    />
                  ))}
                </div>
              </section>
            ),
          },
          {
            key: "webhooks",
            label: "Webhooks",
            count: hooks.length,
            content: (
              <div className="flex flex-col gap-5">
                <section className="flex flex-col gap-2">
                  {groupHead(
                    "Webhooks do piloto",
                    <DialogButton label="Novo webhook" icon={<Plus size={14} />} className={NEW} title="Novo webhook" description="Envelope assinado no padrão Standard Webhooks; 2xx em até 10 s é entrega; novas tentativas em 1 min, 5 min, 30 min, 2 h, 6 h, 12 h, 24 h e 24 h; 410 ou 3 dias só de falhas desativam." size="lg" footer="close">
                      <ResultForm action={createPilotWebhook.bind(null, id)} copy>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <label className="label" htmlFor="wh-name">
                              Nome
                            </label>
                            <input id="wh-name" name="name" required maxLength={80} className="input" placeholder="Fintra produção" />
                          </div>
                          <div>
                            <label className="label" htmlFor="wh-url">
                              URL (HTTPS)
                            </label>
                            <input id="wh-url" name="url" required className="input" placeholder="https://api.fintra.com.br/boavoz/webhook" />
                          </div>
                        </div>
                        <fieldset className="flex flex-col gap-1">
                          <legend className="label">Eventos</legend>
                          {WEBHOOK_EVENTS.map((e) => (
                            <label key={e} className="flex items-center gap-2 text-xs">
                              <input type="checkbox" name="event" value={e} defaultChecked className="accent-brand" /> <span className="font-mono">{e}</span>
                            </label>
                          ))}
                        </fieldset>
                        {scopeFields({ botField: "bot_id", botScope: "bots", allLabel: "Todos os chatbots da agência" })}
                        <SubmitButton className="btn-primary self-start py-1.5" pendingLabel="Criando…">Criar webhook</SubmitButton>
                      </ResultForm>
                    </DialogButton>,
                  )}
                  <div className="card flex flex-col divide-y divide-line-2 overflow-hidden">
                    {hooks.length === 0 && <p className="px-4 py-5 text-sm text-muted">Nenhum webhook.</p>}
                    {hooks.map((h) => (
                      <SettingRow
                        key={h.id as string}
                        icon={<Webhook size={18} />}
                        title={h.name as string}
                        badge={<StatusPill tone={h.active ? "ok" : "danger"}>{h.active ? "ativo" : `desativado${h.disabled_reason ? ` (${h.disabled_reason as string})` : ""}`}</StatusPill>}
                        summary={`${h.url as string} · ${(h.events as string[]).join(", ")} · ${h.scope_type === "all" ? "todos os chatbots" : h.scope_type === "client" ? `cliente ${clientName.get(h.scope_client_id as string) ?? "?"}` : (h.scope_bot_ids as string[]).map((b) => botName.get(b) ?? "?").join(", ")}${h.failing_since ? ` · falhando desde ${relativeTime(h.failing_since as string)}` : ""}`}
                        summaryTone={h.failing_since ? "warn" : "muted"}
                        dialogTitle={`Webhook ${h.name as string}`}
                        footer="close"
                        footerStart={
                          <ConfirmAction action={deletePilotWebhook.bind(null, id, h.id as string)} title={`Apagar o webhook ${h.name as string}?`} description="As entregas dele são apagadas junto." confirmLabel="Apagar" className="btn-ghost text-danger">
                            <Trash2 size={14} />
                            Apagar
                          </ConfirmAction>
                        }
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <ResultForm action={testPilotWebhook.bind(null, id, h.id as string)}>
                            <SubmitButton className="btn-ghost self-start py-1.5" pendingLabel="Enviando…">Enviar teste</SubmitButton>
                          </ResultForm>
                          <ConfirmAction action={setPilotWebhookActive.bind(null, id, h.id as string, !h.active)} title={h.active ? "Desativar o webhook?" : "Reativar o webhook?"} description={h.active ? "Novos eventos não são entregues nem acumulam." : "Os próximos eventos voltam a ser entregues (os de enquanto estava desativado não)."} confirmLabel={h.active ? "Desativar" : "Reativar"} danger={Boolean(h.active)} className="btn-ghost">
                            {h.active ? "Desativar" : "Reativar"}
                          </ConfirmAction>
                        </div>
                      </SettingRow>
                    ))}
                  </div>
                </section>
                {deliveries && deliveries.length > 0 && (
                  <section className="card flex flex-col gap-2 overflow-x-auto p-5">
                    <h3 className="kpi-label">Últimas entregas</h3>
                    <table className="w-full min-w-[560px] text-xs">
                      <thead className="text-left text-muted"><tr><th className="py-1 font-semibold">Quando</th><th className="py-1 font-semibold">Webhook</th><th className="py-1 font-semibold">Evento</th><th className="py-1 font-semibold">Situação</th></tr></thead>
                      <tbody>
                        {deliveries.map((d) => (
                          <tr key={d.id as string} className="border-t border-line-2">
                            <td className="py-1.5">{relativeTime(d.created_at as string)}</td>
                            <td className="py-1.5">{hookName.get(d.webhook_id as string)}</td>
                            <td className="py-1.5 font-mono">{d.event_type as string}</td>
                            <td className={`py-1.5 font-semibold ${d.status === "delivered" ? "text-brand" : d.status === "failed" ? "text-danger" : "text-amber-ink"}`}>
                              {d.status === "delivered" ? "entregue" : d.status === "failed" ? "falhou" : "nova tentativa agendada"}
                              {d.last_status ? ` · HTTP ${d.last_status as number}` : ""}
                              {(d.attempts as number) > 1 ? ` · ${d.attempts as number} tentativas` : ""}
                              {d.status !== "delivered" && d.last_error ? ` · ${d.last_error as string}` : ""}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>
                )}
              </div>
            ),
          },
          {
            key: "chamadas",
            label: "Chamadas",
            count: calls?.length ?? 0,
            content: (
              <section className="card flex flex-col gap-2 overflow-x-auto p-5">
                <h3 className="kpi-label">Últimas chamadas das ações</h3>
                {calls?.length ? (
                  <table className="w-full min-w-[560px] text-xs">
                    <thead className="text-left text-muted"><tr><th className="py-1 font-semibold">Quando</th><th className="py-1 font-semibold">Ação</th><th className="py-1 font-semibold">Modo</th><th className="py-1 font-semibold">Resultado</th><th className="py-1 text-right font-semibold">Tempo</th></tr></thead>
                    <tbody>
                      {calls.map((c) => (
                        <tr key={c.id as number} className="border-t border-line-2">
                          <td className="py-1.5">{relativeTime(c.created_at as string)}</td>
                          <td className="py-1.5 font-mono">{actionName.get(c.action_id as string)}</td>
                          <td className="py-1.5">{c.mode as string}{(c.attempt as number) > 1 ? ` · tentativa ${c.attempt}` : ""}</td>
                          <td className={`py-1.5 font-semibold ${STATUS_TONE[c.status as string] ?? ""}`}>{c.status as string}{c.http_status ? ` · ${c.http_status}` : ""}</td>
                          <td className="py-1.5 text-right">{c.duration_ms as number} ms</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-sm text-muted">Nenhuma chamada ainda.</p>
                )}
              </section>
            ),
          },
        ]}
      />
    </>
  );
}
