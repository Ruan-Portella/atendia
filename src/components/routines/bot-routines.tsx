import { createAdminClient } from "@/lib/supabase/admin";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { RoutineEditor } from "@/components/routines/routine-editor";
import { ROUTINES_PER_BOT, routineUsesActions, type RoutineRow } from "@/lib/routines";
import { runStats, runStatsLine, type RunSummary } from "@/lib/routine-run";
import { daysAgoIso } from "@/lib/utils";
import { listSectors } from "@/lib/sectors";
import { deleteRoutine, saveRoutine, setConfirmPairedPerson, setRememberNumber, setRoutineActive } from "@/app/painel/roteiros/actions";

/**
 * Situação do roteiro para a IA: ligado, desligado, pausado sem o pacote, com ação que não existe
 * mais, ou com o passo de foto pulado (leitura de fotos desligada no modo dados sensíveis).
 */
function statusOf(r: RoutineRow, integrations: boolean, actions: Array<{ name: string; active: boolean }>, photos: boolean): { label: string; tone: "ok" | "muted" | "warn" } {
  if (!r.active) return { label: "desligado", tone: "muted" };
  if (routineUsesActions(r) && !integrations) return { label: "pausado: passo com ação precisa do pacote Integrações", tone: "warn" };
  for (const s of r.steps) {
    if (s.type !== "acao") continue;
    const a = actions.find((x) => x.name === s.action);
    if (!a) return { label: `a ação ${s.action || "do passo"} não existe mais`, tone: "warn" };
    if (!a.active) return { label: `a ação ${a.name} está desativada`, tone: "warn" };
  }
  if (!photos && r.steps.some((s) => s.type === "foto")) return { label: "ligado, mas o passo de foto é pulado: no modo dados sensíveis, a IA não lê fotos", tone: "warn" };
  return { label: "ligado", tone: "ok" };
}

const TONE = { ok: "text-brand", muted: "text-muted", warn: "text-amber-ink" };

/**
 * Chatbot → Roteiros (B2', parte 1): os roteiros que a IA segue quando a conversa entra num assunto.
 * Só quem configura o chatbot vê a aba. Roteiro sem ação não precisa de desenvolvedor; passo com
 * ação só com o pacote Integrações.
 */
export async function BotRoutines({ botId, integrations }: { botId: string; integrations: boolean }) {
  const db = createAdminClient();
  const since = daysAgoIso(30);
  const [{ data: rows }, { data: acts }, { data: bot }, { count: remembered }, { data: runRows }] = await Promise.all([
    db.from("routines").select("*").eq("bot_id", botId).order("name"),
    db.from("actions").select("name, outcomes, active").eq("bot_id", botId).order("name"),
    db.from("bots").select("offer_remember_number, confirm_paired_person, sensitive_mode, client_id").eq("id", botId).maybeSingle(),
    db.from("contact_links").select("id", { count: "exact", head: true }).eq("bot_id", botId).eq("source", "routine").is("unlinked_at", null),
    // números de cada roteiro nos últimos 30 dias
    db.from("routine_runs").select("routine_id, status, end_reason").eq("bot_id", botId).gte("started_at", since).limit(20_000),
  ]);
  const runsOf = new Map<string, Array<Pick<RunSummary, "status" | "end_reason">>>();
  for (const r of (runRows ?? []) as Array<Pick<RunSummary, "status" | "end_reason"> & { routine_id: string | null }>) {
    if (!r.routine_id) continue;
    runsOf.set(r.routine_id, [...(runsOf.get(r.routine_id) ?? []), r]);
  }
  const offerRemember = (bot?.offer_remember_number as boolean | null | undefined) !== false;
  // o "Estou falando com...?" também para quem foi conectado pelo código (pareamento da P2)
  const confirmPaired = (bot?.confirm_paired_person as boolean | null | undefined) !== false;
  // leitura de fotos: desligada no modo dados sensíveis (o passo de foto é pulado)
  const photos = !bot?.sensitive_mode;
  const routines = (rows ?? []) as unknown as RoutineRow[];
  const actions = (acts ?? []) as Array<{ name: string; outcomes: string[]; active: boolean }>;
  // os setores do cliente, para sugerir no campo "Setor da equipe" (Caixa de entrada, parte 4)
  const sectors = bot?.client_id ? (await listSectors(db, [bot.client_id as string]).catch(() => [])).map((s) => s.name) : [];

  return (
    <div className="flex max-w-[860px] flex-col gap-5">
      <div>
        <h2 className="text-[22px] font-medium">Roteiros</h2>
        <p className="text-sm text-muted">
          Passos que a IA segue quando a conversa entra num assunto: segunda via, troca, orçamento. A IA conversa com naturalidade dentro de cada passo, mas não pula nenhum. Quem decide o caminho é o
          BoaVoz: o botão tocado e o resultado da ação levam ao próximo passo, a outro passo, ao fim ou a um atendente. Dados como CPF e CEP são conferidos antes de seguir. A IA reconhece o assunto pelo
          &quot;Quando usar&quot;; a mensagem que é só uma palavra-chave começa o roteiro na hora.
        </p>
      </div>

      {!integrations && actions.length > 0 && (
        <p className="rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink">Passos com ação (chamar o sistema do cliente) fazem parte do pacote Integrações. Sem ele, os roteiros que têm esse passo ficam pausados.</p>
      )}

      <div className="card overflow-hidden">
        {routines.length ? (
          routines.map((r) => {
            const st = statusOf(r, integrations, actions, photos);
            return (
              <details key={r.id} className="border-b border-line-2 last:border-0">
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
                  <span className="font-semibold">{r.name}</span>
                  <span className={`text-xs ${TONE[st.tone]}`}>{st.label}</span>
                  <span className="text-xs text-muted">
                    {r.steps.length} {r.steps.length === 1 ? "passo" : "passos"}
                    {r.keywords.length ? ` · ${r.keywords.map((k) => k.toUpperCase()).join(", ")}` : ""}
                  </span>
                </summary>
                <div className="flex flex-col gap-4 border-t border-line-2 px-4 py-4">
                  <p className="text-xs text-muted">{runStatsLine(runStats(runsOf.get(r.id) ?? []))} Desistiram: cancelaram, ficaram 24 horas sem responder ou mudaram de assunto.</p>
                  <RoutineEditor action={saveRoutine.bind(null, botId, r.id)} initial={r} actions={actions} integrations={integrations} label="Salvar roteiro" sectors={sectors} />
                  <div className="flex flex-wrap items-center gap-4 border-t border-line-2 pt-3">
                    <ActionForm action={setRoutineActive.bind(null, r.id, !r.active)}>
                      <SubmitButton className="btn-ghost py-1.5 text-xs" pendingLabel="Salvando…">
                        {r.active ? "Desligar roteiro" : "Ligar roteiro"}
                      </SubmitButton>
                    </ActionForm>
                    <ConfirmAction action={deleteRoutine.bind(null, r.id)} title={`Apagar o roteiro ${r.name}?`} description="A IA deixa de seguir este roteiro. Não dá para desfazer." confirmLabel="Apagar" className="text-xs font-semibold text-danger hover:underline">
                      Apagar roteiro
                    </ConfirmAction>
                  </div>
                </div>
              </details>
            );
          })
        ) : (
          <p className="px-5 py-6 text-center text-sm text-muted">Nenhum roteiro neste chatbot. Comece por um modelo pronto ou do zero.</p>
        )}
      </div>

      <div className="card flex flex-col gap-2 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Lembrar o número depois da identificação</h3>
          <span className={`text-xs ${offerRemember ? "text-brand" : "text-muted"}`}>{offerRemember ? "ligado" : "desligado"}</span>
        </div>
        <p className="text-xs text-muted">
          Quando a ação de um roteiro identifica a pessoa no WhatsApp ou no Instagram, o BoaVoz pergunta se pode lembrar o número. Com o número lembrado, cada conversa nova começa por &quot;Estou falando com…?&quot;, e a pessoa não repete os dados. Desligado, a identificação vale só para a conversa.
          {offerRemember && remembered ? ` Hoje: ${remembered} ${remembered === 1 ? "vínculo lembrado" : "vínculos lembrados"}.` : ""}
        </p>
        <div>
          {offerRemember ? (
            <ConfirmAction
              action={setRememberNumber.bind(null, botId, false)}
              title="Desligar o lembrar o número?"
              description="O BoaVoz deixa de pedir para lembrar o número e esquece os números já lembrados neste chatbot (o sistema da loja recebe contact.unlinked). Não dá para desfazer."
              confirmLabel="Desligar e esquecer"
              className="text-xs font-semibold text-danger hover:underline"
            >
              Desligar
            </ConfirmAction>
          ) : (
            <ActionForm action={setRememberNumber.bind(null, botId, true)}>
              <SubmitButton className="btn-ghost py-1.5 text-xs" pendingLabel="Salvando…">
                Ligar
              </SubmitButton>
            </ActionForm>
          )}
        </div>
      </div>

      {integrations && (
        <div className="card flex flex-col gap-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">Confirmar quem foi conectado pelo código</h3>
            <span className={`text-xs ${confirmPaired ? "text-brand" : "text-muted"}`}>{confirmPaired ? "ligado" : "desligado"}</span>
          </div>
          <p className="text-xs text-muted">
            Quando o sistema da loja conecta o WhatsApp ou o Instagram da pessoa à conta dela (o código do pareamento pela API), cada conversa nova também começa por &quot;Estou falando com…?&quot; antes de a IA e as ações usarem a conta. &quot;Sou outra pessoa&quot; deixa a conversa sem a conta, e o vínculo continua. Quem acabou de conectar pelo código não é perguntado. Desligado, a conta vale direto em toda conversa.
          </p>
          <div>
            <ActionForm action={setConfirmPairedPerson.bind(null, botId, !confirmPaired)}>
              <SubmitButton className={confirmPaired ? "text-xs font-semibold text-danger hover:underline" : "btn-ghost py-1.5 text-xs"} pendingLabel="Salvando…">
                {confirmPaired ? "Desligar" : "Ligar"}
              </SubmitButton>
            </ActionForm>
          </div>
        </div>
      )}

      {routines.length < ROUTINES_PER_BOT ? (
        <details className="card p-4" open={!routines.length}>
          <summary className="cursor-pointer text-sm font-semibold">+ Novo roteiro</summary>
          <div className="mt-3">
            <RoutineEditor action={saveRoutine.bind(null, botId, null)} actions={actions} integrations={integrations} label="Criar roteiro" withTemplates sectors={sectors} />
          </div>
        </details>
      ) : (
        <p className="text-xs text-muted">Este chatbot chegou ao limite de {ROUTINES_PER_BOT} roteiros.</p>
      )}
    </div>
  );
}
