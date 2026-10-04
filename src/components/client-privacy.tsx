import { createClient } from "@/lib/supabase/server";
import { RETENTION_MONTHS, effectiveRetention, retentionLabel } from "@/lib/retention";
import { setClientRetention } from "@/app/painel/actions";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";

/**
 * Privacidade do cliente no painel (aba Dados do cliente): prazo de guarda próprio (vazio = o da
 * agência) e o modo dados sensíveis de cada chatbot, que o cliente liga na área dele.
 */
export async function ClientPrivacy({ clientId, clientName, clientMonths, agencyMonths }: { clientId: string; clientName: string; clientMonths: number | null; agencyMonths: number | null }) {
  const supabase = await createClient();
  const { data: bots } = await supabase.from("bots").select("id, name, sensitive_mode, sensitive_retention_days, sensitive_mode_suggested_at").eq("client_id", clientId).eq("is_demo", false).order("name");
  const agencyLabel = agencyMonths ? `${agencyMonths} meses` : "não apagar";
  return (
    <section className="card flex flex-col gap-4 p-6">
      <div>
        <h2 className="text-base font-bold">Privacidade</h2>
        <p className="text-sm text-muted">Por quanto tempo guardar as conversas e os contatos de {clientName}. O prazo é decisão do negócio: ele também pode mudar na área do cliente, e quem não mudou recebe um e-mail quando o prazo diminui.</p>
      </div>
      <ActionForm key={String(clientMonths)} action={setClientRetention.bind(null, clientId)} className="flex flex-col gap-3">
        <div>
          <label htmlFor="client_retention" className="label">Guardar por</label>
          <select id="client_retention" name="retention_months" defaultValue={clientMonths ? String(clientMonths) : ""} className="input max-w-[300px]">
            <option value="">Prazo da agência ({agencyLabel})</option>
            {RETENTION_MONTHS.map((m) => <option key={m} value={m}>{m} meses</option>)}
          </select>
        </div>
        <label className="flex items-start gap-2.5 text-sm">
          <input type="checkbox" name="confirm" className="mt-1" />
          <span className="text-muted">Se o prazo diminuir: entendo que o que for mais antigo é apagado na próxima limpeza diária, sem desfazer.</span>
        </label>
        <SubmitButton className="btn-primary self-start">Salvar prazo</SubmitButton>
      </ActionForm>
      {(bots ?? []).length > 0 && (
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <h3 className="text-sm font-semibold">Modo dados sensíveis</h3>
          <p className="text-xs text-muted">Para negócios de saúde: as conversas do chatbot saem num prazo curto (7 a 90 dias), antes do prazo do cliente. Quem liga é o cliente, em Privacidade, na área do cliente.</p>
          <ul className="flex flex-col gap-1.5 text-sm">
            {(bots ?? []).map((b) => {
              const r = effectiveRetention({ isDemo: false, sensitiveMode: Boolean(b.sensitive_mode), sensitiveDays: b.sensitive_retention_days as number, clientMonths, agencyMonths });
              return (
                <li key={b.id as string} className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span>{b.name as string}</span>
                  <span className="text-xs text-muted">
                    {b.sensitive_mode ? `ligado · conversas guardadas ${b.sensitive_retention_days} dias` : `desligado · guarda ${retentionLabel(r.days)}`}
                    {!b.sensitive_mode && b.sensitive_mode_suggested_at ? " · sugerido pela análise (negócio de saúde)" : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
