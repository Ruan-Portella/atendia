import { Trash2 } from "lucide-react";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { HoursFields } from "@/components/hours-fields";
import { DISTRIBUTION_LABEL, SECTOR_MAX, SECTOR_NAME_MAX, holidaysText, type Distribution, type Sector, type SectorMember } from "@/lib/sectors";
import { deleteSectorAction, saveHolidaysAction, saveSectorAction, setSectorVisibilityAction } from "@/app/painel/clientes/setores-actions";

/** Os campos de um setor (criar e editar). */
function SectorFields({ sector, eligible }: { sector?: Sector; eligible: SectorMember[] }) {
  const inSector = new Set((sector?.members ?? []).map((m) => `${m.type}:${m.id}`));
  const agency = eligible.filter((m) => m.type === "agency_member");
  const client = eligible.filter((m) => m.type === "client_member");
  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="label">Nome</span>
        <input name="name" required maxLength={SECTOR_NAME_MAX} defaultValue={sector?.name} placeholder="Vendas, Suporte, Financeiro…" className="input" />
      </label>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="label">Distribuição das conversas</legend>
        {(Object.keys(DISTRIBUTION_LABEL) as Distribution[]).map((d) => (
          <label key={d} className="flex items-start gap-2 text-sm">
            <input type="radio" name="distribution" value={d} defaultChecked={(sector?.distribution ?? "manual") === d} className="mt-1" />
            <span>{DISTRIBUTION_LABEL[d]}</span>
          </label>
        ))}
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="label">Pessoas do setor</legend>
        {eligible.length === 0 && <p className="text-sm text-muted">Ninguém pode atender este cliente ainda: convide alguém em Equipe ou na aba Acesso do cliente.</p>}
        {[
          ["Da agência", agency],
          ["Da área do cliente", client],
        ].map(([title, list]) =>
          (list as SectorMember[]).length ? (
            <div key={title as string} className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-muted">{title as string}</span>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {(list as SectorMember[]).map((m) => (
                  <label key={`${m.type}:${m.id}`} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="member" value={`${m.type}:${m.id}`} defaultChecked={inSector.has(`${m.type}:${m.id}`)} />
                    <span>{m.name}</span>
                    <span className="text-xs text-muted">{m.email}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : null,
        )}
      </fieldset>
      <details className="flex flex-col gap-2" open={Boolean(sector?.hours)}>
        <summary className="cursor-pointer text-sm font-semibold">Horário do setor</summary>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input type="checkbox" name="own_hours" defaultChecked={Boolean(sector?.hours)} />
          Horário próprio (sem marcar, vale o horário de atendimento de cada chatbot)
        </label>
        <HoursFields hours={sector?.hours} />
      </details>
    </div>
  );
}

/**
 * Setores e feriados do cliente (Caixa de entrada, parte 1). Os setores valem para todos os
 * chatbots do cliente; os feriados valem no horário do chatbot e no dos setores.
 */
export function ClientSectors({ clientId, sectors, eligible, holidays, seeAll }: { clientId: string; sectors: Sector[]; eligible: SectorMember[]; holidays: string[]; seeAll: boolean }) {
  const nameOf = new Map(eligible.map((m) => [`${m.type}:${m.id}`, m.name]));
  return (
    <div className="flex max-w-[860px] flex-col gap-5">
      <section className="card flex flex-col gap-4 p-5">
        <div>
          <h2 className="text-base font-medium">Setores</h2>
          <p className="text-sm text-muted">Separe o atendimento humano por área (Vendas, Suporte, Financeiro…). Os setores valem para todos os chatbots deste cliente: cada pessoa vê na Caixa de entrada só as conversas dos setores dela (e as que não têm setor). Sem setores, tudo fica numa fila só, como hoje.</p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line-2 bg-ground px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{seeAll ? "Quem configura vê todos os setores" : "Cada pessoa vê só os setores dela"}</p>
            <p className="text-xs text-muted">{seeAll ? "O dono, os administradores e os editores da agência e o gestor da área do cliente veem as filas e as conversas de todos os setores, mesmo sem fazer parte deles." : "Nem o dono vê a fila de um setor de que não faz parte. Ligue para o dono, os administradores, os editores e o gestor da área do cliente acompanharem todos os setores."}</p>
          </div>
          <ActionForm action={setSectorVisibilityAction.bind(null, clientId, !seeAll)}>
            <SubmitButton className="btn-ghost" pendingLabel="Salvando…">{seeAll ? "Mostrar só os setores de cada um" : "Mostrar todos para quem configura"}</SubmitButton>
          </ActionForm>
        </div>
        {sectors.length === 0 && <p className="text-sm text-muted">Nenhum setor ainda.</p>}
        <ul className="flex flex-col gap-3">
          {sectors.map((s) => (
            <li key={s.id} className="rounded-xl border border-line">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                  <span className="font-semibold">{s.name}</span>
                  <span className="text-xs text-muted">{s.distribution === "rodizio" ? "rodízio" : "manual"} · {s.members.length} pessoa{s.members.length === 1 ? "" : "s"}{s.hours ? " · horário próprio" : ""}</span>
                  {s.members.length > 0 && <span className="min-w-0 flex-1 truncate text-xs text-muted">{s.members.map((m) => nameOf.get(`${m.type}:${m.id}`) ?? "pessoa que saiu").join(", ")}</span>}
                </summary>
                <div className="flex flex-col gap-4 border-t border-line-2 px-4 py-4">
                  <ActionForm action={saveSectorAction.bind(null, clientId, s.id)} className="flex flex-col gap-4">
                    <SectorFields sector={s} eligible={eligible} />
                    <div className="flex flex-wrap items-center gap-2">
                      <SubmitButton className="btn-primary" pendingLabel="Salvando…">Salvar setor</SubmitButton>
                    </div>
                  </ActionForm>
                  <ConfirmAction action={deleteSectorAction.bind(null, clientId, s.id)} title={`Apagar o setor ${s.name}?`} description="As conversas dele voltam para a fila geral do cliente. As pessoas continuam na equipe." confirmLabel="Apagar setor" className="btn-ghost w-fit text-danger">
                    <Trash2 size={15} />
                    Apagar setor
                  </ConfirmAction>
                </div>
              </details>
            </li>
          ))}
        </ul>
        {sectors.length < SECTOR_MAX && (
          <details className="rounded-xl border border-dashed border-line">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">+ Novo setor</summary>
            <ActionForm action={saveSectorAction.bind(null, clientId, null)} className="flex flex-col gap-4 border-t border-line-2 px-4 py-4">
              <SectorFields eligible={eligible} />
              <SubmitButton className="btn-primary w-fit" pendingLabel="Criando…">Criar setor</SubmitButton>
            </ActionForm>
          </details>
        )}
      </section>

      <section className="card flex flex-col gap-3 p-5">
        <div>
          <h2 className="text-base font-medium">Feriados</h2>
          <p className="text-sm text-muted">Nos feriados, a equipe fica fora do horário: o assistente avisa quando ela volta, no horário do chatbot e no dos setores. Um por linha: <code>25/12</code> vale todo ano; <code>20/11/2026</code>, só nesse dia.</p>
        </div>
        <ActionForm action={saveHolidaysAction.bind(null, clientId)} className="flex flex-col gap-3">
          <textarea name="holidays" rows={5} defaultValue={holidaysText(holidays)} placeholder={"01/01\n21/04\n01/05\n25/12"} className="input font-mono text-sm" aria-label="Feriados" />
          <SubmitButton className="btn-primary w-fit" pendingLabel="Salvando…">Salvar feriados</SubmitButton>
        </ActionForm>
      </section>
    </div>
  );
}
