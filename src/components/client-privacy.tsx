import { createClient } from "@/lib/supabase/server";
import { RETENTION_MONTHS, effectiveRetention, retentionLabel } from "@/lib/retention";
import { setBotSensitiveMode, setClientRetention } from "@/app/painel/actions";
import { SensitiveModeForm } from "@/components/sensitive-mode-form";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";

/**
 * Privacidade do cliente no painel (aba Dados do cliente): prazo de guarda próprio (vazio = o da
 * agência) e o modo dados sensíveis de cada chatbot, que a agência ou o cliente (na área dele) ligam.
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
        <div className="flex flex-col gap-3 border-t border-line pt-4">
          <div>
            <h3 className="text-sm font-semibold">Modo dados sensíveis</h3>
            <p className="text-xs text-muted">Para negócios de saúde (clínicas, consultórios, terapias, farmácias): as conversas do chatbot saem num prazo curto, de 7 a 90 dias, antes do prazo acima, e abri-las pede o segundo fator. A agência liga aqui ou o cliente liga em Privacidade, na área do cliente; quando você muda, os gestores do cliente recebem um e-mail. Os contatos não recebem aviso.</p>
          </div>
          {(bots ?? []).map((b) => {
            const r = effectiveRetention({ isDemo: false, sensitiveMode: Boolean(b.sensitive_mode), sensitiveDays: b.sensitive_retention_days as number, clientMonths, agencyMonths });
            return (
              <div key={b.id as string} className="flex flex-col gap-1">
                <SensitiveModeForm bot={b as Parameters<typeof SensitiveModeForm>[0]["bot"]} action={setBotSensitiveMode.bind(null, clientId, b.id as string)} />
                {!b.sensitive_mode && <p className="px-1 text-xs text-muted">Hoje as conversas de {b.name as string} ficam {retentionLabel(r.days)}.</p>}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
