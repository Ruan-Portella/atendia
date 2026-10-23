import { createAdminClient } from "@/lib/supabase/admin";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { RoutineFields } from "@/components/routines/routine-editor";
import { ROUTINES_PER_BOT, routineUsesActions, type RoutineRow } from "@/lib/routines";
import { runStats, runStatsLine, type RunSummary } from "@/lib/routine-run";
import { daysAgoIso } from "@/lib/utils";
import { listSectors } from "@/lib/sectors";
import { Plus, Smartphone, UserCheck, Workflow } from "lucide-react";
import { HowItWorks, StatusPill } from "@/components/ui/form-section";
import { AutoSwitch, DialogButton, SettingGroup, SettingRow } from "@/components/ui/setting-row";
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

const PILL = { ok: "Ligado", muted: "Desligado", warn: "Atenção" };

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
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="text-[22px] font-medium">Roteiros</h2>
          <p className="text-sm text-muted">Passos que a IA segue quando a conversa entra num assunto: segunda via, troca, orçamento.</p>
          <HowItWorks>
            <p>
              A IA conversa com naturalidade dentro de cada passo, mas não pula nenhum. Quem decide o caminho é o BoaVoz: o botão tocado e o resultado da ação levam ao próximo passo, a outro passo, ao fim
              ou a um atendente. Dados como CPF e CEP são conferidos antes de seguir. A IA reconhece o assunto pelo &quot;Quando usar&quot;; a mensagem que é só uma palavra-chave começa o roteiro na hora.
            </p>
          </HowItWorks>
        </div>
        {/* redesenho, etapa 5 (22/10): criar e editar num painel lateral, com o Salvar no rodapé */}
        {routines.length < ROUTINES_PER_BOT && (
          <DialogButton label="Novo roteiro" icon={<Plus size={15} />} className="btn-primary" title="Novo roteiro" description="Comece por um modelo pronto ou do zero; dá para mudar tudo depois." action={saveRoutine.bind(null, botId, null)} size="sheet" saveLabel="Criar roteiro">
            <RoutineFields actions={actions} integrations={integrations} withTemplates sectors={sectors} />
          </DialogButton>
        )}
      </div>

      {!integrations && actions.length > 0 && (
        <p className="rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink">Passos com ação (chamar o sistema do cliente) fazem parte do pacote Integrações. Sem ele, os roteiros que têm esse passo ficam pausados.</p>
      )}

      <div className="card flex flex-col divide-y divide-line-2 overflow-hidden">
        {routines.length ? (
          routines.map((r) => {
            const st = statusOf(r, integrations, actions, photos);
            const stats = runStats(runsOf.get(r.id) ?? []);
            return (
              <SettingRow
                key={r.id}
                icon={<Workflow size={18} />}
                title={r.name}
                badge={<StatusPill tone={st.tone}>{PILL[st.tone]}</StatusPill>}
                summary={
                  <>
                    {r.steps.length} {r.steps.length === 1 ? "passo" : "passos"}
                    {r.keywords.length ? ` · ${r.keywords.map((k) => k.toUpperCase()).join(", ")}` : ""}
                    {st.tone === "warn" && <span className="block text-amber-ink">{st.label.replace(/^./, (c) => c.toUpperCase())}</span>}
                  </>
                }
                trailing={
                  <>
                    <span className="hidden shrink-0 text-xs text-muted sm:block">{stats.started ? `${stats.started} em 30 dias` : "sem uso em 30 dias"}</span>
                    <AutoSwitch checked={r.active} action={setRoutineActive.bind(null, r.id, true)} offAction={setRoutineActive.bind(null, r.id, false)} label={`Roteiro ${r.name} ligado`} />
                  </>
                }
                description={`${runStatsLine(stats)} Desistiram: cancelaram, ficaram 24 horas sem responder ou mudaram de assunto.`}
                action={saveRoutine.bind(null, botId, r.id)}
                size="sheet"
                saveLabel="Salvar roteiro"
                footerStart={
                  <ConfirmAction action={deleteRoutine.bind(null, r.id)} title={`Apagar o roteiro ${r.name}?`} description="A IA deixa de seguir este roteiro. Não dá para desfazer." confirmLabel="Apagar" className="text-sm font-semibold text-danger hover:underline">
                    Apagar roteiro
                  </ConfirmAction>
                }
              >
                <RoutineFields initial={r} actions={actions} integrations={integrations} sectors={sectors} />
              </SettingRow>
            );
          })
        ) : (
          <p className="px-5 py-6 text-center text-sm text-muted">Nenhum roteiro neste chatbot. Toque em &quot;Novo roteiro&quot; e comece por um modelo pronto ou do zero.</p>
        )}
      </div>
      {routines.length >= ROUTINES_PER_BOT && <p className="text-xs text-muted">Este chatbot chegou ao limite de {ROUTINES_PER_BOT} roteiros.</p>}

      <SettingGroup title="Ajustes dos roteiros">
        <SettingRow
          icon={<Smartphone size={18} />}
          title="Lembrar o número depois da identificação"
          summary={offerRemember ? `Ligado${remembered ? ` · ${remembered} ${remembered === 1 ? "vínculo lembrado" : "vínculos lembrados"}` : ""}` : "Desligado: a identificação vale só para a conversa"}
          trailing={
            <AutoSwitch
              checked={offerRemember}
              action={setRememberNumber.bind(null, botId, true)}
              offAction={setRememberNumber.bind(null, botId, false)}
              label="Lembrar o número depois da identificação"
              confirmOff={{ title: "Desligar o lembrar o número?", description: "O BoaVoz deixa de pedir para lembrar o número e esquece os números já lembrados neste chatbot (o sistema da loja recebe contact.unlinked). Não dá para desfazer.", confirmLabel: "Desligar e esquecer" }}
            />
          }
          footer="close"
        >
          <p className="text-sm leading-relaxed text-ink-2">
            Quando a ação de um roteiro identifica a pessoa no WhatsApp ou no Instagram, o BoaVoz pergunta se pode lembrar o número. Com o número lembrado, cada conversa nova começa por &quot;Estou falando com…?&quot;, e a pessoa não repete os dados. Desligado, a identificação vale só para a conversa.
            {offerRemember && remembered ? ` Hoje: ${remembered} ${remembered === 1 ? "vínculo lembrado" : "vínculos lembrados"}.` : ""}
          </p>
        </SettingRow>
        {integrations && (
          <SettingRow
            icon={<UserCheck size={18} />}
            title="Confirmar quem foi conectado pelo código"
            summary={confirmPaired ? "Ligado: pergunta “Estou falando com…?” antes de usar a conta" : "Desligado: a conta vale direto"}
            trailing={<AutoSwitch checked={confirmPaired} action={setConfirmPairedPerson.bind(null, botId, true)} offAction={setConfirmPairedPerson.bind(null, botId, false)} label="Confirmar quem foi conectado pelo código" />}
            footer="close"
          >
            <p className="text-sm leading-relaxed text-ink-2">
              Quando o sistema da loja conecta o WhatsApp ou o Instagram da pessoa à conta dela (o código do pareamento pela API), cada conversa nova também começa por &quot;Estou falando com…?&quot; antes de a IA e as ações usarem a conta. &quot;Sou outra pessoa&quot; deixa a conversa sem a conta, e o vínculo continua. Quem acabou de conectar pelo código não é perguntado. Desligado, a conta vale direto em toda conversa.
            </p>
          </SettingRow>
        )}
      </SettingGroup>
    </div>
  );
}
