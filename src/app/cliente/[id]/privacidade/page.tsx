import { memberHasMfa, requireMember } from "@/lib/member";
import { RETENTION_MONTHS, SENSITIVE_DAYS, effectiveRetention, retentionLabel } from "@/lib/retention";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { ExportLinks } from "@/components/export-links";
import { dueDateBR } from "@/lib/data-subject";
import { memberConfirmRequest, memberSetRetention, memberSetSensitive } from "../../actions";
import { ConfirmAction } from "@/components/ui/confirm-action";

export const metadata = { title: { absolute: "Privacidade" }, robots: { index: false, follow: false } };

const CHANNEL: Record<string, string> = { widget: "Chat do site", whatsapp: "WhatsApp", instagram: "Instagram", painel: "Pela agência", api: "Pelo sistema da empresa" };

/**
 * Privacidade do negócio (leva S): por quanto tempo as conversas e os contatos ficam guardados
 * (o prazo é decisão do negócio) e o modo dados sensíveis de cada assistente.
 */
export default async function MemberPrivacyPage({ params }: PageProps<"/cliente/[id]/privacidade">) {
  const { id } = await params;
  const { member, admin, botIds } = await requireMember(id, "manager");
  const ids = botIds.length ? botIds : ["00000000-0000-0000-0000-000000000000"];
  const [{ data: client }, { data: bots }, { data: requests }] = await Promise.all([
    admin.from("clients").select("retention_months, agencies(retention_months)").eq("id", id).maybeSingle(),
    admin.from("bots").select("id, name, sensitive_mode, sensitive_retention_days, sensitive_mode_suggested_at").in("id", ids).order("name"),
    // pedidos de exclusão dos contatos deste negócio (a agência confirma; aqui só acompanha)
    admin.from("data_subject_requests").select("id, channel, status, requested_at, due_at, executed_at").eq("client_id", id).order("requested_at", { ascending: false }).limit(20),
  ]);
  const agency = (Array.isArray(client?.agencies) ? client.agencies[0] : client?.agencies) as { retention_months: number | null } | null | undefined;
  const clientMonths = (client?.retention_months as number | null) ?? null;
  const agencyMonths = agency?.retention_months ?? null;
  const mfa = await memberHasMfa();
  const current = effectiveRetention({ isDemo: false, sensitiveMode: false, sensitiveDays: null, clientMonths, agencyMonths });

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold">Privacidade</h1>
        <p className="text-sm text-muted">
          Por quanto tempo as conversas e os contatos dos seus assistentes ficam guardados. A LGPD pede guardar dados pessoais só pelo tempo necessário: todo dia, o que passou do prazo é apagado (conversas paradas, com as mensagens, leads, perguntas sem resposta e fichas de contato sem conversa). Os relatórios continuam com os números.
        </p>
      </div>

      <section className="card flex flex-col gap-4 p-5">
        <div>
          <h2 className="text-base font-bold">Prazo de guarda</h2>
          <p className="text-sm text-muted">Hoje: {retentionLabel(current.days)}{clientMonths ? "" : ` (o padrão de ${member.agency.name})`}.</p>
        </div>
        <ActionForm key={String(clientMonths)} action={memberSetRetention.bind(null, id)} className="flex flex-col gap-3">
          <div>
            <label htmlFor="retention_months" className="label">Guardar por</label>
            <select id="retention_months" name="retention_months" defaultValue={clientMonths ? String(clientMonths) : ""} className="input max-w-[300px]">
              <option value="">Padrão de {member.agency.name} ({agencyMonths ? `${agencyMonths} meses` : "não apagar"})</option>
              {RETENTION_MONTHS.map((m) => <option key={m} value={m}>{m} meses</option>)}
            </select>
          </div>
          <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" name="confirm" className="mt-1" />
            <span className="text-muted">Se o prazo diminuir: entendo que o que for mais antigo é apagado na próxima limpeza diária, sem desfazer.</span>
          </label>
          <SubmitButton className="btn-primary self-start">Salvar prazo</SubmitButton>
        </ActionForm>
      </section>

      {(requests ?? []).length > 0 && (
        <section className="card flex flex-col gap-2 p-5">
          <h2 className="text-base font-bold">Pedidos de exclusão dos seus contatos</h2>
          <p className="text-sm text-muted">Quem pede pelo chat para apagar os dados aparece aqui. Você (ou {member.agency.name}) confirma, e o BoaVoz apaga e avisa a pessoa. Confirmar pede o código do app autenticador.</p>
          <ul className="flex flex-col gap-1.5 text-sm">
            {(requests ?? []).map((r) => (
              <li key={r.id as string} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span>{CHANNEL[r.channel as string] ?? (r.channel as string)} · pedido em {dueDateBR(r.requested_at as string)}</span>
                <span className="flex items-center gap-2 text-xs text-muted">
                  {r.status === "executado" ? `atendido em ${dueDateBR(r.executed_at as string)}` : `aguardando · prazo até ${dueDateBR(r.due_at as string)}`}
                  {r.status === "aguardando" && (
                    mfa ? (
                      <ConfirmAction
                        action={memberConfirmRequest.bind(null, id, r.id as string)}
                        title="Confirmar o pedido de exclusão?"
                        description="Apaga as conversas, a ficha, os contatos deixados e as perguntas dessa pessoa nos seus assistentes, e avisa ela pelo canal quando ainda der. Não tem desfazer."
                        confirmLabel="Confirmar e apagar"
                        className="btn-danger px-2.5 py-1 text-xs"
                      >
                        Confirmar
                      </ConfirmAction>
                    ) : (
                      <a href={`/cliente/${id}/verificar?next=${encodeURIComponent(`/cliente/${id}/privacidade`)}`} className="font-semibold text-brand hover:underline">Verificar para confirmar</a>
                    )
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ExportLinks clientId={id} description="Baixe o que os seus assistentes guardaram: conversas, contatos e leads, em CSV (abre no Excel) ou JSON. A exportação fica registrada." />

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-base font-bold">Modo dados sensíveis</h2>
          <p className="text-sm text-muted">
            Para quem recebe dados de saúde pelo chat (clínicas, consultórios, terapias, farmácias): as conversas do assistente são apagadas num prazo curto, de 7 a 90 dias, antes do prazo acima. Os contatos não recebem aviso.
          </p>
        </div>
        {(bots ?? []).length === 0 && <p className="card p-5 text-sm text-muted">Ainda não há assistente configurado.</p>}
        {(bots ?? []).map((b) => {
          const on = Boolean(b.sensitive_mode);
          const days = (b.sensitive_retention_days as number) || 30;
          return (
            <ActionForm key={`${b.id}${on}${days}`} action={memberSetSensitive.bind(null, id, b.id as string)} className="card flex flex-col gap-3 p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <strong>{b.name as string}</strong>
                <span className={on ? "rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand" : "text-xs text-muted"}>{on ? `Ligado · ${days} dias` : "Desligado"}</span>
              </div>
              {!on && b.sensitive_mode_suggested_at && (
                <p className="rounded-lg border border-amber/40 bg-amber-soft px-3 py-2 text-xs text-amber-ink">Sugerido: a análise do assistente indica um negócio de saúde. Ligar diminui o tempo em que conversas com dados de saúde ficam guardadas.</p>
              )}
              <label className="flex items-center gap-2.5 text-sm">
                <input type="checkbox" name="sensitive" defaultChecked={on} />
                Ligar o modo dados sensíveis
              </label>
              <div>
                <label htmlFor={`days-${b.id}`} className="label">Guardar as conversas por</label>
                <select id={`days-${b.id}`} name="days" defaultValue={String(days)} className="input max-w-[200px]">
                  {SENSITIVE_DAYS.map((d) => <option key={d} value={d}>{d} dias</option>)}
                </select>
              </div>
              <label className="flex items-start gap-2.5 text-sm">
                <input type="checkbox" name="confirm" className="mt-1" />
                <span className="text-muted">Se o prazo diminuir: entendo que as conversas mais antigas são apagadas na próxima limpeza diária, sem desfazer.</span>
              </label>
              <SubmitButton className="btn-primary self-start">Salvar</SubmitButton>
            </ActionForm>
          );
        })}
      </section>
    </>
  );
}
