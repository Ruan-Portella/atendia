import { createAdminClient } from "@/lib/supabase/admin";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { RoutineEditor } from "@/components/routines/routine-editor";
import { ROUTINES_PER_BOT, routineUsesActions, type RoutineRow } from "@/lib/routines";
import { deleteRoutine, saveRoutine, setRoutineActive } from "@/app/painel/roteiros/actions";

/** Situação do roteiro para a IA: ligado, desligado, pausado sem o pacote ou com ação que não existe mais. */
function statusOf(r: RoutineRow, integrations: boolean, actions: Array<{ name: string; active: boolean }>): { label: string; tone: "ok" | "muted" | "warn" } {
  if (!r.active) return { label: "desligado", tone: "muted" };
  if (routineUsesActions(r) && !integrations) return { label: "pausado: passo com ação precisa do pacote Integrações", tone: "warn" };
  for (const s of r.steps) {
    if (s.type !== "acao") continue;
    const a = actions.find((x) => x.name === s.action);
    if (!a) return { label: `a ação ${s.action || "do passo"} não existe mais`, tone: "warn" };
    if (!a.active) return { label: `a ação ${a.name} está desativada`, tone: "warn" };
  }
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
  const [{ data: rows }, { data: acts }] = await Promise.all([
    db.from("routines").select("*").eq("bot_id", botId).order("name"),
    db.from("actions").select("name, outcomes, active").eq("bot_id", botId).order("name"),
  ]);
  const routines = (rows ?? []) as unknown as RoutineRow[];
  const actions = (acts ?? []) as Array<{ name: string; outcomes: string[]; active: boolean }>;

  return (
    <div className="flex max-w-[860px] flex-col gap-5">
      <div>
        <h2 className="text-[22px] font-bold">Roteiros</h2>
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
            const st = statusOf(r, integrations, actions);
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
                  <RoutineEditor action={saveRoutine.bind(null, botId, r.id)} initial={r} actions={actions} integrations={integrations} label="Salvar roteiro" />
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

      {routines.length < ROUTINES_PER_BOT ? (
        <details className="card p-4" open={!routines.length}>
          <summary className="cursor-pointer text-sm font-semibold">+ Novo roteiro</summary>
          <div className="mt-3">
            <RoutineEditor action={saveRoutine.bind(null, botId, null)} actions={actions} integrations={integrations} label="Criar roteiro" withTemplates />
          </div>
        </details>
      ) : (
        <p className="text-xs text-muted">Este chatbot chegou ao limite de {ROUTINES_PER_BOT} roteiros.</p>
      )}
    </div>
  );
}
