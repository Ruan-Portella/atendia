import { ChevronDown, LifeBuoy } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SUPPORT_HOURS, readsPerGrant, type SupportGrant } from "@/lib/support-access";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { DialogButton } from "@/components/ui/setting-row";
import { StatusPill } from "@/components/ui/form-section";
import { grantSupportAccess, revokeSupportAccess } from "@/app/painel/actions";

const when = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

/** Vale agora? (fora do componente: a hora atual não entra na renderização) */
const isActive = (g: SupportGrant) => !g.revoked_at && Date.parse(g.expires_at) > Date.now();

/**
 * Acesso do suporte: a equipe do BoaVoz só lê conversas da sua conta com a sua liberação (24 horas,
 * com motivo). Cada conversa lida aparece na auditoria. Redesenho, etapa 5: a situação numa linha e o
 * liberar num modal com o motivo.
 */
export async function SupportSection({ agencyId }: { agencyId: string }) {
  const supabase = await createClient();
  const { data } = await supabase.from("support_access_grants").select("id, agency_id, granted_by, reason, expires_at, revoked_at, revoked_by, created_at").order("created_at", { ascending: false }).limit(20);
  const grants = (data ?? []) as SupportGrant[];
  const active = grants.find(isActive) ?? null;
  const reads = await readsPerGrant(supabase, agencyId, grants);

  return (
    <section className="flex flex-col gap-3">
      <p className="text-sm text-muted">A equipe do BoaVoz não lê as conversas da sua conta sem a sua liberação. Libere por {SUPPORT_HOURS} horas quando pedir ajuda com um atendimento; cada conversa lida aparece na Auditoria, e você pode encerrar antes.</p>
      <div className="card flex flex-wrap items-center gap-3 px-4 py-3.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-raised text-ink-2">
          <LifeBuoy size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[15px] font-medium text-ink">Acesso do suporte</span>
            <StatusPill tone={active ? "warn" : "muted"}>{active ? `Liberado até ${when(active.expires_at)}` : "Fechado"}</StatusPill>
          </span>
          <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">
            {active ? `Motivo: ${active.reason} · ${reads.get(active.id) ? `${reads.get(active.id)} conversa(s) lida(s) até agora` : "nenhuma conversa lida ainda"}` : "O suporte não vê as conversas da sua conta."}
          </span>
        </span>
        {active ? (
          <ConfirmAction action={revokeSupportAccess} title="Encerrar o acesso do suporte agora?" description="A equipe do BoaVoz deixa de ver as conversas da sua conta na hora." confirmLabel="Encerrar" className="btn-ghost py-1.5 text-xs">
            Encerrar agora
          </ConfirmAction>
        ) : (
          <DialogButton label={`Liberar por ${SUPPORT_HOURS} horas`} className="btn-primary py-1.5 text-xs" title="Liberar o acesso do suporte" description={`Por ${SUPPORT_HOURS} horas, a equipe do BoaVoz pode ler as conversas da sua conta para ajudar. Cada conversa lida aparece na Auditoria, e você encerra quando quiser.`} action={grantSupportAccess} saveLabel={`Liberar por ${SUPPORT_HOURS} horas`}>
            <div>
              <label htmlFor="support-reason" className="label">
                Motivo (o que o suporte vai ver)
              </label>
              <textarea id="support-reason" name="reason" required minLength={10} maxLength={300} rows={3} className="input text-sm" placeholder="Ex.: o assistente respondeu errado no WhatsApp do cliente Pizzaria, conversa de hoje às 14h" />
            </div>
          </DialogButton>
        )}
      </div>
      {grants.length > 0 && (
        <details className="group/hist">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-sm font-medium text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
            Histórico ({grants.length})
            <ChevronDown size={14} className="transition-transform duration-[220ms] group-open/hist:rotate-180" />
          </summary>
          <ul className="card mt-2 flex flex-col divide-y divide-line-2 overflow-hidden">
            {grants.map((g) => (
              <li key={g.id} className="flex flex-col gap-0.5 px-4 py-2.5">
                <span className="text-sm text-ink">{g.reason}</span>
                <span className="text-xs text-muted">
                  {when(g.created_at)} → {g.revoked_at ? `encerrado em ${when(g.revoked_at)}` : `até ${when(g.expires_at)}`} · {reads.get(g.id) ?? 0} conversa(s) lida(s)
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
