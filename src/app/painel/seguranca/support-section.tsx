import { createClient } from "@/lib/supabase/server";
import { SUPPORT_HOURS, readsPerGrant, type SupportGrant } from "@/lib/support-access";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { grantSupportAccess, revokeSupportAccess } from "../actions";

const when = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

/** Vale agora? (fora do componente: a hora atual não entra na renderização) */
const isActive = (g: SupportGrant) => !g.revoked_at && Date.parse(g.expires_at) > Date.now();

/**
 * Acesso do suporte: a equipe do BoaVoz só lê conversas da sua conta com a sua liberação (24 horas,
 * com motivo). Cada conversa lida aparece na auditoria.
 */
export async function SupportSection({ agencyId }: { agencyId: string }) {
  const supabase = await createClient();
  const { data } = await supabase.from("support_access_grants").select("id, agency_id, granted_by, reason, expires_at, revoked_at, revoked_by, created_at").order("created_at", { ascending: false }).limit(20);
  const grants = (data ?? []) as SupportGrant[];
  const active = grants.find(isActive) ?? null;
  const reads = await readsPerGrant(supabase, agencyId, grants);

  return (
    <section className="card flex flex-col gap-4 p-6">
      <div>
        <h2 className="text-base font-bold">Acesso do suporte</h2>
        <p className="text-sm text-muted">
          A equipe do BoaVoz não lê as conversas da sua conta sem a sua liberação. Libere por {SUPPORT_HOURS} horas quando pedir ajuda com um atendimento; cada conversa lida aparece na Auditoria, e você pode encerrar antes.
        </p>
      </div>
      {active ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber/40 bg-amber-soft px-4 py-3 text-sm text-amber-ink">
          <span>
            <strong>Liberado até {when(active.expires_at)}.</strong> Motivo: {active.reason}. {reads.get(active.id) ? `${reads.get(active.id)} conversa(s) lida(s) até agora.` : "Nenhuma conversa lida ainda."}
          </span>
          <ConfirmAction action={revokeSupportAccess} title="Encerrar o acesso do suporte agora?" description="A equipe do BoaVoz deixa de ver as conversas da sua conta na hora." confirmLabel="Encerrar" className="btn-ghost py-1.5 text-xs">
            Encerrar agora
          </ConfirmAction>
        </div>
      ) : (
        <ActionForm action={grantSupportAccess} className="flex flex-col gap-3">
          <div>
            <label htmlFor="support-reason" className="label">Motivo (o que o suporte vai ver)</label>
            <input id="support-reason" name="reason" required minLength={10} maxLength={300} className="input" placeholder="Ex.: o assistente respondeu errado no WhatsApp do cliente Pizzaria, conversa de hoje às 14h" />
          </div>
          <SubmitButton className="btn-primary self-start">Liberar acesso do suporte por {SUPPORT_HOURS} horas</SubmitButton>
        </ActionForm>
      )}
      {grants.length > 0 && (
        <details className="border-t border-line pt-3 text-sm" open={!active}>
          <summary className="cursor-pointer font-semibold">Histórico ({grants.length})</summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {grants.map((g) => (
              <li key={g.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="min-w-0">{g.reason}</span>
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
