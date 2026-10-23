import { Archive, ShieldAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { RETENTION_MONTHS, effectiveRetention, retentionLabel } from "@/lib/retention";
import { setBotSensitiveMode, setClientRetention } from "@/app/painel/actions";
import { SensitiveModeFields } from "@/components/sensitive-mode-form";
import { SettingGroup, SettingRow } from "@/components/ui/setting-row";
import { ShowMore } from "@/components/ui/show-more";

/**
 * Privacidade do cliente no painel (aba Dados do cliente): prazo de guarda próprio (vazio = o da
 * agência) e o modo dados sensíveis de cada chatbot, que a agência ou o cliente (na área dele) ligam.
 * Redesenho (23/10/2026): uma linha para o prazo e uma para cada chatbot, cada uma com o modal.
 * Com muitos chatbots, os ligados e os sugeridos vêm primeiro e o resto fica no "Mostrar todos".
 */
export async function ClientPrivacy({ clientId, clientName, clientMonths, agencyMonths }: { clientId: string; clientName: string; clientMonths: number | null; agencyMonths: number | null }) {
  const supabase = await createClient();
  const { data: bots } = await supabase.from("bots").select("id, name, sensitive_mode, sensitive_retention_days, sensitive_mode_suggested_at").eq("client_id", clientId).eq("is_demo", false).order("name");
  const agencyLabel = agencyMonths ? `${agencyMonths} meses` : "não apagar";
  const rank = (b: { sensitive_mode: unknown; sensitive_mode_suggested_at: unknown }) => (b.sensitive_mode ? 0 : b.sensitive_mode_suggested_at ? 1 : 2);
  const sorted = [...(bots ?? [])].sort((a, b) => rank(a) - rank(b));
  return (
    <SettingGroup title="Privacidade e LGPD">
      <SettingRow
        icon={<Archive size={18} />}
        title="Prazo de guarda"
        summary={clientMonths ? `${clientMonths} meses` : `O prazo da agência (${agencyLabel})`}
        description={`Por quanto tempo guardar as conversas e os contatos de ${clientName}. O prazo é decisão do negócio: ele também pode mudar na área do cliente, e quem não mudou recebe um e-mail quando o prazo diminui.`}
        action={setClientRetention.bind(null, clientId)}
      >
        <div>
          <label htmlFor="client_retention" className="label">
            Guardar por
          </label>
          <select id="client_retention" name="retention_months" defaultValue={clientMonths ? String(clientMonths) : ""} className="input">
            <option value="">Prazo da agência ({agencyLabel})</option>
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
      <ShowMore>
      {sorted.map((b) => {
        const on = Boolean(b.sensitive_mode);
        const days = (b.sensitive_retention_days as number | null) || 30;
        const r = effectiveRetention({ isDemo: false, sensitiveMode: on, sensitiveDays: b.sensitive_retention_days as number, clientMonths, agencyMonths });
        return (
          <SettingRow
            key={b.id as string}
            icon={<ShieldAlert size={18} />}
            title={`Modo dados sensíveis · ${b.name as string}`}
            summary={on ? `Ligado: as conversas saem em ${days} dias e abrir pede o segundo fator` : !on && b.sensitive_mode_suggested_at ? "Desligado · sugerido: parece um negócio de saúde" : `Desligado: as conversas ficam ${retentionLabel(r.days)}`}
            summaryTone={on ? "ok" : b.sensitive_mode_suggested_at ? "warn" : "muted"}
            description="Para negócios de saúde (clínicas, consultórios, terapias, farmácias): as conversas do chatbot saem num prazo curto, de 7 a 90 dias, e abri-las pede o segundo fator."
            action={setBotSensitiveMode.bind(null, clientId, b.id as string)}
          >
            <SensitiveModeFields bot={b as Parameters<typeof SensitiveModeFields>[0]["bot"]} />
          </SettingRow>
        );
      })}
      </ShowMore>
    </SettingGroup>
  );
}
