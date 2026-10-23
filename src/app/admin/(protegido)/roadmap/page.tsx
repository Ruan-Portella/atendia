import Link from "next/link";
import { Lightbulb, Plus, ThumbsUp, Trash2 } from "lucide-react";
import { requireAdmin } from "@/lib/platform-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { ROADMAP_COLUMNS, ROADMAP_STATUSES, ROADMAP_SUMMARY_MAX, ROADMAP_TITLE_MAX, loadRoadmap, pendingSuggestions, type RoadmapItem } from "@/lib/roadmap";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { DialogButton, SettingGroup, SettingRow } from "@/components/ui/setting-row";
import { deleteRoadmapItem, mergeRoadmapSuggestion, publishRoadmapSuggestion, rejectRoadmapSuggestion, saveRoadmapItem } from "./actions";

export const metadata = { title: "Roadmap" };

const day = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

function ItemFields({ item, idPrefix }: { item?: RoadmapItem; idPrefix: string }) {
  return (
    <>
      <div>
        <label htmlFor={`${idPrefix}-titulo`} className="label">
          Título (o quê, sem datas nem como)
        </label>
        <input id={`${idPrefix}-titulo`} name="title" defaultValue={item?.title} required minLength={3} maxLength={ROADMAP_TITLE_MAX} className="input" />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-resumo`} className="label">
          Resumo (opcional)
        </label>
        <textarea id={`${idPrefix}-resumo`} name="summary" defaultValue={item?.summary ?? ""} maxLength={ROADMAP_SUMMARY_MAX} rows={2} className="input" />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-coluna`} className="label">
          Coluna
        </label>
        <select id={`${idPrefix}-coluna`} name="status" defaultValue={item?.status ?? "ideia"} className="input">
          {ROADMAP_STATUSES.map((s) => (
            <option key={s} value={s}>
              {ROADMAP_COLUMNS[s].title}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}

/**
 * Backoffice do roadmap público: moderar as ideias que chegam pelo painel e cuidar dos itens.
 * Rodada 2 das telas (23/10/2026, a pedido do usuário): os itens num kanban, uma coluna por etapa
 * (no celular, as colunas rolam de lado); cada cartão abre o modal de editar, com o Apagar no rodapé,
 * e cada ideia para moderar abre o modal de publicar, juntar ou recusar.
 */
export default async function AdminRoadmap() {
  await requireAdmin("/admin/roadmap");
  const db = createAdminClient();
  const [items, pending] = await Promise.all([loadRoadmap(db), pendingSuggestions(db)]);
  // aqui aparecem todos os itens (Pronto também), os mais curtidos primeiro
  const columns = ROADMAP_STATUSES.map((status) => ({ status, title: ROADMAP_COLUMNS[status].title, items: items.filter((i) => i.status === status).sort((a, b) => b.likes - a.likes) }));

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-normal">Roadmap</h1>
          <p className="text-sm text-muted">
            O que aparece em <Link href="/roadmap" className="underline">/roadmap</Link> e no painel: o quê, sem datas nem como. As ideias de quem tem conta chegam aqui antes de aparecer.
          </p>
        </div>
        <DialogButton label="Novo item" icon={<Plus size={15} />} className="btn-primary" title="Novo item do roadmap" action={saveRoadmapItem.bind(null, null)} saveLabel="Adicionar">
          <ItemFields idPrefix="novo-item" />
        </DialogButton>
      </div>

      <SettingGroup title={`Ideias para moderar · ${pending.length}`}>
        {pending.length === 0 && <p className="px-4 py-5 text-sm text-muted">Nenhuma ideia nova.</p>}
        {pending.map((s) => (
          <SettingRow
            key={s.id}
            icon={<Lightbulb size={18} />}
            title={s.title}
            summary={`${s.agencyName ?? "conta apagada"} · ${day(s.created_at)}${s.details ? ` · ${s.details}` : ""}`}
            dialogTitle="Moderar a ideia"
            description={s.details ? <span className="whitespace-pre-wrap">{s.details}</span> : undefined}
            size="lg"
            footer="close"
            footerStart={
              <ConfirmAction action={rejectRoadmapSuggestion.bind(null, s.id)} title={`Recusar "${s.title}"?`} description="A pessoa vê no painel que a ideia não vai entrar agora." confirmLabel="Recusar" className="btn-ghost text-danger">
                Recusar
              </ConfirmAction>
            }
          >
            <ActionForm action={publishRoadmapSuggestion.bind(null, s.id)} className="flex flex-col gap-2 rounded-[12px] border border-line p-3">
              <span className="text-sm font-semibold">Publicar em Ideias</span>
              <div>
                <label htmlFor={`sug-${s.id}-titulo`} className="label">
                  Título publicado
                </label>
                <input id={`sug-${s.id}-titulo`} name="title" defaultValue={s.title.slice(0, ROADMAP_TITLE_MAX)} required minLength={3} maxLength={ROADMAP_TITLE_MAX} className="input" />
              </div>
              <div>
                <label htmlFor={`sug-${s.id}-resumo`} className="label">
                  Resumo (opcional)
                </label>
                <input id={`sug-${s.id}-resumo`} name="summary" maxLength={ROADMAP_SUMMARY_MAX} className="input" />
              </div>
              <SubmitButton className="btn-primary self-start" pendingLabel="Publicando…">Publicar</SubmitButton>
            </ActionForm>
            {items.length > 0 && (
              <ActionForm action={mergeRoadmapSuggestion.bind(null, s.id)} className="flex flex-col gap-2 rounded-[12px] border border-line p-3">
                <label htmlFor={`sug-${s.id}-juntar`} className="text-sm font-semibold">
                  Ou juntar a um item parecido
                </label>
                <select id={`sug-${s.id}-juntar`} name="item_id" required defaultValue="" className="input">
                  <option value="" disabled>
                    escolha o item…
                  </option>
                  {columns.map((c) => (
                    <optgroup key={c.status} label={c.title}>
                      {c.items.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.title}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <SubmitButton className="btn-ghost self-start" pendingLabel="Juntando…">Juntar</SubmitButton>
              </ActionForm>
            )}
          </SettingRow>
        ))}
      </SettingGroup>

      <section className="flex flex-col gap-2">
        <h3 className="kpi-label px-1">Itens · {items.length}</h3>
        <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 xl:grid-cols-4">
          {columns.map((c) => (
            <div key={c.status} className="flex w-[78vw] max-w-[320px] shrink-0 snap-start flex-col gap-2 rounded-[16px] bg-raised/50 p-2.5 shadow-[inset_0_0_0_1px_var(--color-line)] md:w-auto md:max-w-none">
              <div className="flex items-baseline justify-between px-1.5 pt-0.5">
                <span className="text-sm font-medium text-ink">{c.title}</span>
                <span className="font-mono text-[11.5px] text-muted">{c.items.length}</span>
              </div>
              {c.items.length === 0 && <p className="px-1.5 py-3 text-[13px] text-muted">Nada.</p>}
              {c.items.map((i) => (
                <DialogButton
                  key={i.id}
                  label={
                    <span className="flex w-full flex-col gap-1 text-left">
                      <span className="text-sm font-medium text-ink">{i.title}</span>
                      {i.summary && <span className="line-clamp-2 text-[12.5px] text-muted">{i.summary}</span>}
                      <span className="inline-flex items-center gap-1 text-[11.5px] text-muted tabular-nums" aria-label={`${i.likes} curtidas`}>
                        <ThumbsUp size={11} aria-hidden />
                        {i.likes}
                      </span>
                    </span>
                  }
                  className="card flex w-full p-3 transition-shadow duration-[120ms] hover:shadow-[inset_0_0_0_1px_var(--color-line-strong)]"
                  title="Editar o item"
                  description={`${i.likes} ${i.likes === 1 ? "curtida" : "curtidas"}. Mudar a coluna move o cartão no roadmap público.`}
                  action={saveRoadmapItem.bind(null, i.id)}
                  footerStart={
                    <ConfirmAction action={deleteRoadmapItem.bind(null, i.id)} title={`Apagar "${i.title}"?`} description="Some do roadmap junto com as curtidas." confirmLabel="Apagar" className="btn-ghost text-danger">
                      <Trash2 size={14} />
                      Apagar
                    </ConfirmAction>
                  }
                >
                  <ItemFields item={i} idPrefix={`item-${i.id}`} />
                </DialogButton>
              ))}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
