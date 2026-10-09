import { createAdminClient } from "@/lib/supabase/admin";
import { daysAgoIso, relativeTime } from "@/lib/utils";
import type { ActionRow } from "@/lib/actions";
import { ResultForm } from "@/components/admin/result-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { ActionFields } from "@/components/integrations/action-fields";
import { actionsTokenWeight, headerNames } from "@/lib/integrations-input";
import { deleteBotAction, rotateBotActionSecret, saveBotAction, testBotAction } from "@/app/painel/integracoes/actions";

const LEVEL_LABEL: Record<string, string> = { anonimo: "qualquer contato", canal: "telefone conhecido", usuario: "identificado pela empresa" };

/** Segredo anterior ainda valendo (troca sem queda): até quando. */
const previousSecretNote = (until: string | null) => (until && Date.parse(until) > Date.now() ? ` O anterior vale até ${new Date(until).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.` : "");
const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "—");

/**
 * Chatbot → Ações (C pública): as ações de consulta que a IA deste chatbot chama na conversa, o
 * segredo que assina as chamadas e o resultado de cada uma em 7 dias. Dono e administrador mexem
 * (com o segundo fator); o editor só vê.
 */
export async function BotActions({ bot, manage }: { bot: { id: string; action_secret_enc: string | null; action_secret_prev_until: string | null }; manage: boolean }) {
  const db = createAdminClient();
  const { data: rows } = await db.from("actions").select("*").eq("bot_id", bot.id).order("name");
  const actions = (rows ?? []) as unknown as Array<ActionRow & { creates_order: boolean; paused_by_plan_at: string | null }>;
  const weight = actionsTokenWeight(actions);
  // última chamada e taxa de erro de cada ação nos últimos 7 dias
  const { data: calls } = actions.length ? await db.from("action_calls").select("action_id, status, created_at").in("action_id", actions.map((a) => a.id)).gte("created_at", daysAgoIso(7)).neq("mode", "test").order("created_at", { ascending: false }).limit(2000) : { data: [] };
  const stats = new Map<string, { total: number; errors: number; last: string | null }>();
  for (const c of calls ?? []) {
    const s = stats.get(c.action_id as string) ?? { total: 0, errors: 0, last: null };
    s.total++;
    if (["error", "timeout", "uncertain"].includes(c.status as string)) s.errors++;
    s.last ??= c.created_at as string;
    stats.set(c.action_id as string, s);
  }

  return (
    <div className="flex max-w-[860px] flex-col gap-5">
      <div>
        <h2 className="text-[22px] font-bold">Ações</h2>
        <p className="text-sm text-muted">
          Consultas ao sistema do cliente que a IA faz na conversa (status do pedido, agenda, saldo). Ela chama a ação quando a descrição combina e responde com o que o endpoint devolver. Ação que cria pedido,
          reserva ou cobrança precisa do clique do contato em Confirmar, que chega numa próxima parte das Integrações: por enquanto ela fica salva e desativada.
        </p>
      </div>

      {manage && (
        <ResultForm action={rotateBotActionSecret.bind(null, bot.id)} copy className="card p-4">
          <div className="text-sm font-semibold">Segredo de ações deste chatbot</div>
          <p className="text-xs text-muted">
            {bot.action_secret_enc ? "Configurado." : "Ainda não gerado: as ações deste chatbot não funcionam sem ele."}
            {previousSecretNote(bot.action_secret_prev_until)} Cada chamada vai assinada no padrão Standard Webhooks; o endpoint confere com este segredo. Aparece uma vez só: quem perder, gera outro.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton className="btn-ghost py-1.5" pendingLabel="Gerando…">{bot.action_secret_enc ? "Trocar o segredo" : "Gerar segredo"}</SubmitButton>
            {Boolean(bot.action_secret_enc) && (
              <label className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" name="invalidate" /> invalidar o anterior agora (vazou)
              </label>
            )}
          </div>
        </ResultForm>
      )}

      {weight > 0 && (
        <p className="text-xs text-muted">
          As ações ativas deste chatbot somam ~{weight.toLocaleString("pt-BR")} tokens em cada resposta da IA (as definições vão junto em toda chamada). Descrições curtas e poucos parâmetros deixam a resposta mais rápida e barata.
        </p>
      )}

      <div className="card overflow-hidden">
        {actions.length ? (
          actions.map((a) => {
            const s = stats.get(a.id);
            return (
              <details key={a.id} className="border-b border-line-2 last:border-0">
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
                  <span className="font-mono font-semibold">{a.name}</span>
                  <span className={a.active ? "text-xs text-brand" : "text-xs text-muted"}>{a.active ? "ativa" : "desativada"}</span>
                  <span className="text-xs text-muted">consulta · {LEVEL_LABEL[a.min_level] ?? a.min_level}</span>
                  {a.creates_order && <span className="text-xs text-danger">parece criar pedido, reserva ou cobrança (fica desativada até a confirmação por botão)</span>}
                  {a.paused_by_plan_at && <span className="text-xs text-amber-ink">pausada pelo plano</span>}
                  <span className="ml-auto text-xs text-muted">{s ? `última chamada ${relativeTime(s.last!)} · erros ${pct(s.errors, s.total)} em 7 dias` : "sem chamadas em 7 dias"}</span>
                </summary>
                <div className="flex flex-col gap-4 border-t border-line-2 px-4 py-4">
                  {manage ? (
                    <>
                      <ActionFields action={saveBotAction.bind(null, bot.id, a.id)} a={a} label="Salvar" savedHeaders={headerNames(a.headers_enc)} />
                      <ResultForm action={testBotAction.bind(null, a.id)} className="border-t border-line-2 pt-3">
                        <label className="label" htmlFor={`test-${a.id}`}>Testar (chama o endpoint de verdade, com test: true)</label>
                        <textarea id={`test-${a.id}`} name="params" rows={3} className="input font-mono text-xs" defaultValue="{}" />
                        <SubmitButton className="btn-ghost self-start py-1.5" pendingLabel="Chamando…">Testar</SubmitButton>
                      </ResultForm>
                      <ConfirmAction action={deleteBotAction.bind(null, a.id)} title={`Apagar a ação ${a.name}?`} description="A IA deixa de ter esta ação. O registro das chamadas é apagado junto." confirmLabel="Apagar" className="self-start text-xs font-semibold text-danger hover:underline">
                        Apagar ação
                      </ConfirmAction>
                    </>
                  ) : (
                    <div className="flex flex-col gap-1 text-sm">
                      <p className="text-ink-2">{a.description}</p>
                      <p className="truncate font-mono text-xs text-muted">{a.url}</p>
                      <p className="text-xs text-muted">Só o dono ou um administrador da agência edita as ações.</p>
                    </div>
                  )}
                </div>
              </details>
            );
          })
        ) : (
          <p className="px-5 py-6 text-center text-sm text-muted">Nenhuma ação neste chatbot.</p>
        )}
      </div>

      {manage && (
        <details className="card p-4">
          <summary className="cursor-pointer text-sm font-semibold">+ Nova ação de consulta</summary>
          <div className="mt-3">
            <ActionFields action={saveBotAction.bind(null, bot.id, null)} label="Criar ação" />
          </div>
        </details>
      )}
    </div>
  );
}
