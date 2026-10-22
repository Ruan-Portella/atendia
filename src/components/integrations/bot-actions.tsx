import { createAdminClient } from "@/lib/supabase/admin";
import { daysAgoIso, relativeTime } from "@/lib/utils";
import type { ActionRow } from "@/lib/actions";
import { ResultForm } from "@/components/admin/result-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { ActionFieldsBody, ActionTestForm } from "@/components/integrations/action-fields";
import { needsConfirmation } from "@/lib/actions";
import { actionsTokenWeight, headerNames } from "@/lib/integrations-input";
import { FlaskConical, KeyRound, Plus, Zap } from "lucide-react";
import { HowItWorks, StatusPill } from "@/components/ui/form-section";
import { DialogButton, SettingGroup, SettingRow } from "@/components/ui/setting-row";
import { deleteBotAction, rotateBotActionSecret, saveBotAction, testBotAction } from "@/app/painel/(configuracoes)/integracoes/actions";

const LEVEL_LABEL: Record<string, string> = { anonimo: "qualquer contato", canal: "telefone conhecido", usuario: "identificado pela empresa" };

/** Segredo anterior ainda valendo (troca sem queda): até quando. */
const previousSecretNote = (until: string | null) => (until && Date.parse(until) > Date.now() ? ` O anterior vale até ${new Date(until).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.` : "");
const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "—");

/**
 * Chatbot → Ações (C pública): as ações que a IA deste chatbot chama na conversa (consultas na
 * hora; "executa" só depois do Confirmar do contato), o segredo que assina as chamadas e o
 * resultado de cada uma em 7 dias. Dono e administrador mexem
 * (com o segundo fator); o editor só vê.
 */
export async function BotActions({ bot, manage }: { bot: { id: string; action_secret_enc: string | null; action_secret_prev_until: string | null }; manage: boolean }) {
  const db = createAdminClient();
  const { data: rows } = await db.from("actions").select("*").eq("bot_id", bot.id).order("name");
  const actions = (rows ?? []) as unknown as Array<ActionRow & { creates_order: boolean }>;
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
    <div className="flex max-w-[860px] flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="text-[22px] font-medium">Ações</h2>
          <p className="text-sm text-muted">Chamadas ao sistema do cliente que a IA faz na conversa: consultar um pedido, agendar, cancelar.</p>
          <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
            <HowItWorks>
              <p>
                Consulta (status do pedido, agenda, saldo): a IA chama quando a descrição combina e responde com o que o endpoint devolver. Executa (criar pedido, agendar, cancelar): a IA mostra ao contato
                um resumo com Confirmar e Cancelar, e o endpoint só é chamado depois do Confirmar. Ação que o BoaVoz classifica como pedido, reserva ou cobrança sempre pede o Confirmar, mesmo cadastrada
                como consulta.
              </p>
              <p>O retorno pode trazer components (botões, lista ou link): botão com action chama a ação direto no toque do contato, sem a IA. E attachments (até 5 arquivos) vão logo depois do texto, no formato de cada canal.</p>
            </HowItWorks>
            <a href="/docs/acoes" target="_blank" rel="noopener" className="text-[13px] font-medium text-brand hover:underline">
              Documentação das ações ↗
            </a>
          </div>
        </div>
        {/* redesenho, etapa 5 (22/10): criar e editar num painel lateral; os parâmetros em linhas, sem o JSON */}
        {manage && (
          <DialogButton label="Nova ação" icon={<Plus size={15} />} className="btn-primary" title="Nova ação" description="Uma consulta ou uma ação que executa. Depois de criar, use o Testar da lista." action={saveBotAction.bind(null, bot.id, null)} size="sheet" saveLabel="Criar ação">
            <ActionFieldsBody />
          </DialogButton>
        )}
      </div>

      {manage && (
        <SettingGroup>
          <SettingRow
            icon={<KeyRound size={18} />}
            title="Segredo de ações deste chatbot"
            summary={bot.action_secret_enc ? `Configurado.${previousSecretNote(bot.action_secret_prev_until)}` : "Ainda não gerado: as ações deste chatbot não funcionam sem ele"}
            summaryTone={bot.action_secret_enc ? "muted" : "warn"}
            description="Cada chamada vai assinada no padrão Standard Webhooks; o endpoint confere com este segredo. Aparece uma vez só: quem perder, gera outro."
            footer="close"
          >
            <ResultForm action={rotateBotActionSecret.bind(null, bot.id)} copy className="gap-3">
              {Boolean(bot.action_secret_enc) && (
                <label className="flex items-center justify-between gap-4 text-sm">
                  <span>
                    <span className="block font-medium text-ink">Invalidar o anterior agora</span>
                    <span className="block text-xs text-muted">Só quando o segredo vazou. Sem isso, o anterior vale por mais um tempo, para trocar sem queda.</span>
                  </span>
                  <input type="checkbox" name="invalidate" className="mt-0.5" />
                </label>
              )}
              <SubmitButton className="btn-primary self-start" pendingLabel="Gerando…">{bot.action_secret_enc ? "Trocar o segredo" : "Gerar segredo"}</SubmitButton>
            </ResultForm>
          </SettingRow>
        </SettingGroup>
      )}

      {weight > 0 && (
        <p className="text-xs text-muted">
          As ações ativas deste chatbot somam ~{weight.toLocaleString("pt-BR")} tokens em cada resposta da IA (as definições vão junto em toda chamada). Descrições curtas e poucos parâmetros deixam a resposta mais rápida e barata.
        </p>
      )}

      <div className="card flex flex-col divide-y divide-line-2 overflow-hidden">
        {actions.length ? (
          actions.map((a) => {
            const st = stats.get(a.id);
            return (
              <SettingRow
                key={a.id}
                icon={<Zap size={18} />}
                title={a.name}
                mono
                badge={<StatusPill tone={a.active ? "ok" : "muted"}>{a.active ? "Ativa" : "Desativada"}</StatusPill>}
                summary={
                  <>
                    {needsConfirmation(a) ? "Executa (com Confirmar)" : "Consulta"}
                    {a.supports_preview ? " · aceita prévia" : ""} · {LEVEL_LABEL[a.min_level] ?? a.min_level}
                    {a.routine_only ? " · só no roteiro" : ""}
                    <span className="block sm:hidden">{st ? `última chamada ${relativeTime(st.last!)} · erros ${pct(st.errors, st.total)} em 7 dias` : "sem chamadas em 7 dias"}</span>
                    {a.creates_order && a.type === "query" && <span className="block text-amber-ink">Parece criar pedido, reserva ou cobrança: pede o Confirmar do contato</span>}
                  </>
                }
                trailing={
                  <>
                    <span className="hidden shrink-0 text-right text-xs text-muted sm:block">
                      {st ? (
                        <>
                          última chamada {relativeTime(st.last!)}
                          <br />
                          erros {pct(st.errors, st.total)} em 7 dias
                        </>
                      ) : (
                        "sem chamadas em 7 dias"
                      )}
                    </span>
                    {manage && (
                      <DialogButton label="Testar" icon={<FlaskConical size={14} />} className="btn-ghost shrink-0 px-3 py-1.5 text-[13px]" title={`Testar ${a.name}`} description="Chama o endpoint de verdade, com test: true. O resultado aparece aqui embaixo." footer="close" size="lg">
                        <ActionTestForm action={testBotAction.bind(null, a.id)} a={a} />
                      </DialogButton>
                    )}
                  </>
                }
                dialogTitle={a.name}
                description={manage ? undefined : "Só o dono ou um administrador da agência edita as ações."}
                action={manage ? saveBotAction.bind(null, bot.id, a.id) : undefined}
                size="sheet"
                footer={manage ? "save" : "close"}
                saveLabel="Salvar ação"
                footerStart={
                  manage ? (
                    <ConfirmAction action={deleteBotAction.bind(null, a.id)} title={`Apagar a ação ${a.name}?`} description="A IA deixa de ter esta ação. O registro das chamadas é apagado junto." confirmLabel="Apagar" className="text-sm font-semibold text-danger hover:underline">
                      Apagar ação
                    </ConfirmAction>
                  ) : undefined
                }
              >
                {manage ? (
                  <ActionFieldsBody a={a} savedHeaders={headerNames(a.headers_enc)} />
                ) : (
                  <div className="flex flex-col gap-1 text-sm">
                    <p className="text-ink-2">{a.description}</p>
                    <p className="truncate font-mono text-xs text-muted">{a.url}</p>
                  </div>
                )}
              </SettingRow>
            );
          })
        ) : (
          <p className="px-5 py-6 text-center text-sm text-muted">Nenhuma ação neste chatbot.{manage ? " Toque em “Nova ação” para cadastrar a primeira." : ""}</p>
        )}
      </div>
    </div>
  );
}
