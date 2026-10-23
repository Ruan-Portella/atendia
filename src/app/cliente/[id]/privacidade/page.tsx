import { memberHasMfa, requireMember } from "@/lib/member";
import { RETENTION_MONTHS, effectiveRetention, retentionLabel } from "@/lib/retention";
import { ExportLinks } from "@/components/export-links";
import { SensitiveModeFields } from "@/components/sensitive-mode-form";
import { Archive, ShieldAlert, UserX } from "lucide-react";
import { DialogButton, SettingGroup, SettingRow } from "@/components/ui/setting-row";
import { dueDateBR } from "@/lib/data-subject";
import { memberConfirmRequest, memberRefuseRequest, memberSetRetention, memberSetSensitive } from "../../actions";
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
    admin.from("data_subject_requests").select("id, channel, status, requested_at, due_at, executed_at, refused_at, refuse_reason").eq("client_id", id).order("requested_at", { ascending: false }).limit(20),
  ]);
  const agency = (Array.isArray(client?.agencies) ? client.agencies[0] : client?.agencies) as { retention_months: number | null } | null | undefined;
  const clientMonths = (client?.retention_months as number | null) ?? null;
  const agencyMonths = agency?.retention_months ?? null;
  const mfa = await memberHasMfa();
  const current = effectiveRetention({ isDemo: false, sensitiveMode: false, sensitiveDays: null, clientMonths, agencyMonths });

  // redesenho (23/10/2026): o prazo, os pedidos e o modo dados sensíveis em linhas que abrem um modal
  return (
    <>
      <div>
        <h1 className="text-2xl font-normal">Privacidade</h1>
        <p className="max-w-[680px] text-sm text-muted">
          Por quanto tempo as conversas e os contatos dos seus assistentes ficam guardados. A LGPD pede guardar dados pessoais só pelo tempo necessário: todo dia, o que passou do prazo é apagado (conversas paradas, com as mensagens, leads, perguntas sem resposta e fichas de contato sem conversa). Os relatórios continuam com os números.
        </p>
      </div>

      <SettingGroup title="Guarda dos dados">
        <SettingRow icon={<Archive size={18} />} title="Prazo de guarda" summary={`${retentionLabel(current.days)}${clientMonths ? "" : ` (o padrão de ${member.agency.name})`}`} action={memberSetRetention.bind(null, id)}>
          <div>
            <label htmlFor="retention_months" className="label">
              Guardar por
            </label>
            <select id="retention_months" name="retention_months" defaultValue={clientMonths ? String(clientMonths) : ""} className="input">
              <option value="">Padrão de {member.agency.name} ({agencyMonths ? `${agencyMonths} meses` : "não apagar"})</option>
              {RETENTION_MONTHS.map((m) => (
                <option key={m} value={m}>
                  {m} meses
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-start gap-2.5 rounded-[12px] bg-raised p-3 text-sm">
            <input type="checkbox" name="confirm" className="mt-0.5 accent-brand" />
            <span className="text-ink-2">Se o prazo diminuir: entendo que o que for mais antigo é apagado na próxima limpeza diária, sem desfazer.</span>
          </label>
        </SettingRow>
        {(bots ?? []).map((b) => {
          const on = Boolean(b.sensitive_mode);
          return (
            <SettingRow
              key={b.id as string}
              icon={<ShieldAlert size={18} />}
              title={`Modo dados sensíveis · ${b.name as string}`}
              summary={on ? `Ligado: as conversas saem em ${(b.sensitive_retention_days as number | null) || 30} dias` : b.sensitive_mode_suggested_at ? "Desligado · sugerido para negócios de saúde" : "Desligado"}
              summaryTone={on ? "ok" : b.sensitive_mode_suggested_at ? "warn" : "muted"}
              description={`Para quem recebe dados de saúde pelo chat (clínicas, consultórios, terapias, farmácias): as conversas do assistente são apagadas num prazo curto, de 7 a 90 dias, antes do prazo acima. Os contatos não recebem aviso. ${member.agency.name} também pode ligar pelo painel dela; quem não mudou recebe um e-mail.`}
              action={memberSetSensitive.bind(null, id, b.id as string)}
            >
              <SensitiveModeFields bot={b as Parameters<typeof SensitiveModeFields>[0]["bot"]} />
            </SettingRow>
          );
        })}
      </SettingGroup>

      {(requests ?? []).length > 0 && (
        <section className="flex flex-col gap-2">
          <SettingGroup title="Pedidos de exclusão dos seus contatos">
            {(requests ?? []).map((r) => (
              <SettingRow
                key={r.id as string}
                icon={<UserX size={18} />}
                title={`${CHANNEL[r.channel as string] ?? (r.channel as string)} · pedido em ${dueDateBR(r.requested_at as string)}`}
                summary={r.status === "executado" ? `Atendido em ${dueDateBR(r.executed_at as string)}` : r.status === "recusado" ? `Recusado em ${dueDateBR(r.refused_at as string)}: ${r.refuse_reason as string}` : `Aguardando · prazo até ${dueDateBR(r.due_at as string)}`}
                summaryTone={r.status === "aguardando" ? "warn" : "muted"}
                trailing={
                  r.status === "aguardando" ? (
                    mfa ? (
                      <span className="flex shrink-0 flex-wrap gap-1.5">
                        <DialogButton label="Recusar" className="btn-ghost py-1.5 text-xs" title="Recusar o pedido" description="O motivo vai para a pessoa." action={memberRefuseRequest.bind(null, id, r.id as string)} saveLabel="Recusar o pedido">
                          <div>
                            <label htmlFor={`reason-${r.id as string}`} className="label">
                              Motivo
                            </label>
                            <textarea id={`reason-${r.id as string}`} name="reason" required minLength={10} maxLength={500} rows={3} className="input" placeholder="Ex.: as notas fiscais ficam guardadas por 5 anos por obrigação legal." />
                          </div>
                        </DialogButton>
                        <ConfirmAction action={memberConfirmRequest.bind(null, id, r.id as string)} title="Confirmar o pedido de exclusão?" description="Apaga as conversas, a ficha, os contatos deixados e as perguntas dessa pessoa nos seus assistentes, e avisa ela pelo canal quando ainda der. Não tem desfazer." confirmLabel="Confirmar e apagar" className="btn-danger py-1.5 text-xs">
                          Confirmar
                        </ConfirmAction>
                      </span>
                    ) : (
                      <a href={`/cliente/${id}/verificar?next=${encodeURIComponent(`/cliente/${id}/privacidade`)}`} className="btn-ghost shrink-0 py-1.5 text-xs">
                        Verificar para confirmar
                      </a>
                    )
                  ) : undefined
                }
              />
            ))}
          </SettingGroup>
          <p className="px-1 text-xs text-muted">Quem pede pelo chat para apagar os dados aparece aqui. Você (ou {member.agency.name}) confirma, e o BoaVoz apaga e avisa a pessoa. Confirmar pede o código do app autenticador.</p>
        </section>
      )}

      <ExportLinks clientId={id} description="Baixe o que os seus assistentes guardaram: conversas, contatos e leads, em CSV (abre no Excel) ou JSON. A exportação fica registrada." />
    </>
  );
}
