import { CalendarOff, Plus, Trash2, Users } from "lucide-react";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { AutoSwitch, DialogButton, SettingGroup, SettingRow, SwitchField } from "@/components/ui/setting-row";
import { MultiSelect } from "@/components/ui/multi-select";
import { HoursFields } from "@/components/hours-fields";
import { HolidaysField } from "@/components/holidays-field";
import { DISTRIBUTION_LABEL, SECTOR_MAX, SECTOR_NAME_MAX, holidaysText, type Distribution, type Sector, type SectorMember } from "@/lib/sectors";
import { deleteSectorAction, saveHolidaysAction, saveSectorAction, setSectorVisibilityAction } from "@/app/painel/clientes/setores-actions";

/** Os campos de um setor (criar e editar): o nome, a distribuição em cartões, as pessoas e o horário. */
function SectorFields({ sector, eligible, idPrefix }: { sector?: Sector; eligible: SectorMember[]; idPrefix: string }) {
  const options = eligible.map((m) => ({ value: `${m.type}:${m.id}`, label: m.name, group: m.type === "agency_member" ? "Da agência" : "Da área do cliente" }));
  return (
    <>
      <div>
        <label htmlFor={`${idPrefix}-name`} className="label">
          Nome
        </label>
        <input id={`${idPrefix}-name`} name="name" required maxLength={SECTOR_NAME_MAX} defaultValue={sector?.name} placeholder="Vendas, Suporte, Financeiro…" className="input" />
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="label">Distribuição das conversas</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(Object.keys(DISTRIBUTION_LABEL) as Distribution[]).map((d) => (
            <label key={d} className="flex cursor-pointer items-start gap-2.5 rounded-[12px] border border-line p-3 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft/60">
              <input type="radio" name="distribution" value={d} defaultChecked={(sector?.distribution ?? "manual") === d} className="mt-0.5 accent-brand" />
              <span className="text-ink-2">{DISTRIBUTION_LABEL[d]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <span className="label">Pessoas do setor</span>
        {eligible.length === 0 ? (
          <p className="text-sm text-muted">Ninguém pode atender este cliente ainda: convide alguém em Equipe ou na aba Acesso do cliente.</p>
        ) : (
          <MultiSelect name="member" label="Pessoas do setor" options={options} defaultValue={(sector?.members ?? []).map((m) => `${m.type}:${m.id}`)} placeholder="Escolha quem atende neste setor" />
        )}
      </div>
      <div className="flex flex-col gap-3 rounded-[12px] bg-raised/60 p-3">
        <SwitchField name="own_hours" defaultChecked={Boolean(sector?.hours)} label="Horário próprio" hint="Desligado, vale o horário de atendimento de cada chatbot. Ligado, vale o horário abaixo." />
        <HoursFields hours={sector?.hours} />
      </div>
    </>
  );
}

/** O resumo da linha do setor: a distribuição, as pessoas e o horário. */
function sectorSummary(s: Sector, nameOf: Map<string, string>): string {
  const people = s.members.map((m) => nameOf.get(`${m.type}:${m.id}`) ?? "pessoa que saiu");
  const who = people.length ? `${people.length} ${people.length === 1 ? "pessoa" : "pessoas"}: ${people.slice(0, 3).join(", ")}${people.length > 3 ? "…" : ""}` : "ninguém ainda";
  return `${s.distribution === "rodizio" ? "Rodízio" : "Manual"} · ${who}${s.hours ? " · horário próprio" : ""}`;
}

/**
 * Setores e feriados do cliente (Caixa de entrada, parte 1). Os setores valem para todos os
 * chatbots do cliente; os feriados valem no horário do chatbot e no dos setores. Redesenho
 * (23/10/2026): cada setor numa linha que abre o modal, o "Novo setor" no alto, a visibilidade numa
 * chave que salva na hora, as pessoas num seletor com busca e os feriados numa lista.
 */
export function ClientSectors({ clientId, sectors, eligible, holidays, seeAll }: { clientId: string; sectors: Sector[]; eligible: SectorMember[]; holidays: string[]; seeAll: boolean }) {
  const nameOf = new Map(eligible.map((m) => [`${m.type}:${m.id}`, m.name]));
  const holidayList = holidaysText(holidays).split("\n").filter(Boolean);
  return (
    <div className="flex max-w-[860px] flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-[600px] text-sm text-muted">Separe o atendimento humano por área (Vendas, Suporte, Financeiro…). Os setores valem para todos os chatbots deste cliente: cada pessoa vê na Caixa de entrada só as conversas dos setores dela (e as que não têm setor).</p>
        {sectors.length < SECTOR_MAX && (
          <DialogButton label="Novo setor" icon={<Plus size={15} />} className="btn-primary" title="Novo setor" action={saveSectorAction.bind(null, clientId, null)} saveLabel="Criar setor" size="lg">
            <SectorFields eligible={eligible} idPrefix="novo-setor" />
          </DialogButton>
        )}
      </div>

      <SettingGroup title="Setores">
        {sectors.length === 0 && <p className="px-4 py-5 text-sm text-muted">Nenhum setor ainda: sem setores, tudo fica numa fila só.</p>}
        {sectors.map((s) => (
          <SettingRow
            key={s.id}
            icon={<Users size={18} />}
            title={s.name}
            summary={sectorSummary(s, nameOf)}
            action={saveSectorAction.bind(null, clientId, s.id)}
            size="lg"
            footerStart={
              <ConfirmAction action={deleteSectorAction.bind(null, clientId, s.id)} title={`Apagar o setor ${s.name}?`} description="As conversas dele voltam para a fila geral do cliente. As pessoas continuam na equipe." confirmLabel="Apagar setor" className="inline-flex items-center gap-1.5 text-sm font-medium text-danger hover:underline">
                <Trash2 size={14} />
                Apagar
              </ConfirmAction>
            }
          >
            <SectorFields sector={s} eligible={eligible} idPrefix={`setor-${s.id}`} />
          </SettingRow>
        ))}
      </SettingGroup>

      <SettingGroup title="Ajustes">
        <SettingRow
          icon={<Users size={18} />}
          title="Quem configura vê todos os setores"
          summary={seeAll ? "Ligado: dono, administradores, editores e o gestor da área do cliente veem as filas de todos os setores" : "Desligado: cada pessoa vê só os setores dela, inclusive o dono"}
          trailing={<AutoSwitch checked={seeAll} action={setSectorVisibilityAction.bind(null, clientId, true)} offAction={setSectorVisibilityAction.bind(null, clientId, false)} label="Quem configura vê todos os setores" />}
        />
        <SettingRow
          icon={<CalendarOff size={18} />}
          title="Feriados"
          summary={holidayList.length ? `${holidayList.length} ${holidayList.length === 1 ? "feriado" : "feriados"}: ${holidayList.slice(0, 4).join(", ")}${holidayList.length > 4 ? "…" : ""}` : "Nenhum feriado"}
          description="Nos feriados, a equipe fica fora do horário: o assistente avisa quando ela volta, no horário do chatbot e no dos setores."
          action={saveHolidaysAction.bind(null, clientId)}
        >
          <HolidaysField initial={holidayList} />
        </SettingRow>
      </SettingGroup>
    </div>
  );
}
