import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { setBotSize } from "@/app/admin/(protegido)/acoes";
import { BOT_SIZES, num } from "@/lib/plans";

interface Props {
  agencyId: string;
  botId: string;
  size: string | null;
  volumePacks: number | null;
  override: number | null;
  used: number;
  quota: number;
}

/**
 * Tamanho do chatbot no backoffice (testes antes da cobrança por tamanho e o plano sob medida).
 * Pacotes só valem no Volume; a cota sob medida, se preenchida, vale no lugar da do tamanho.
 */
export function BotSizeForm({ agencyId, botId, size, volumePacks, override, used, quota }: Props) {
  return (
    <ActionForm action={setBotSize.bind(null, agencyId, botId)} className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <select name="size" defaultValue={size ?? ""} aria-label="Tamanho" className="input w-auto py-1 text-xs">
          {Object.values(BOT_SIZES).map((s) => (
            <option key={s.id} value={s.id}>{s.name}{s.id === "volume" ? "" : ` · ${num(s.atendimentos)}`}</option>
          ))}
          <option value="">sem tamanho</option>
        </select>
        <input name="packs" defaultValue={volumePacks ?? ""} inputMode="numeric" placeholder="pacotes" aria-label="Pacotes do Volume" className="input w-[78px] py-1 text-xs" />
        <input name="override" defaultValue={override ?? ""} inputMode="numeric" placeholder="sob medida" aria-label="Cota sob medida" className="input w-[96px] py-1 text-xs" />
        <SubmitButton className="btn-ghost py-1 text-xs" pendingLabel="Salvando…">Salvar</SubmitButton>
      </div>
      <span className="text-xs text-muted tabular">{num(used)} / {num(quota)} no mês</span>
    </ActionForm>
  );
}
