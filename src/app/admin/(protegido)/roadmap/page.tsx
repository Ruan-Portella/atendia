import Link from "next/link";
import { ThumbsUp, Trash2 } from "lucide-react";
import { requireAdmin } from "@/lib/platform-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { ROADMAP_COLUMNS, ROADMAP_STATUSES, ROADMAP_SUMMARY_MAX, ROADMAP_TITLE_MAX, loadRoadmap, pendingSuggestions, type RoadmapItem } from "@/lib/roadmap";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { deleteRoadmapItem, mergeRoadmapSuggestion, publishRoadmapSuggestion, rejectRoadmapSuggestion, saveRoadmapItem } from "./actions";

export const metadata = { title: "Roadmap" };

const day = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

function ItemFields({ item }: { item?: RoadmapItem }) {
  return (
    <>
      <input name="title" defaultValue={item?.title} required minLength={3} maxLength={ROADMAP_TITLE_MAX} placeholder="o quê (sem datas nem como)" className="input sm:flex-[2]" aria-label="Título" />
      <input name="summary" defaultValue={item?.summary ?? ""} maxLength={ROADMAP_SUMMARY_MAX} placeholder="resumo (opcional)" className="input sm:flex-[3]" aria-label="Resumo" />
      <select name="status" defaultValue={item?.status ?? "ideia"} className="input sm:w-[150px] sm:shrink-0" aria-label="Coluna">
        {ROADMAP_STATUSES.map((s) => (
          <option key={s} value={s}>{ROADMAP_COLUMNS[s].title}</option>
        ))}
      </select>
    </>
  );
}

/** Backoffice do roadmap público: moderar as ideias que chegam pelo painel e cuidar dos itens. */
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
          <h1 className="text-[26px] font-bold">Roadmap</h1>
          <p className="text-sm text-muted">O que aparece em <Link href="/roadmap" className="underline">/roadmap</Link> e no painel: o quê, sem datas nem como. As ideias de quem tem conta chegam aqui antes de aparecer.</p>
        </div>
      </div>

      <section className="card flex flex-col gap-4 p-5">
        <h2 className="text-lg font-bold">Ideias para moderar <span className="font-normal text-muted">({pending.length})</span></h2>
        {pending.length === 0 && <p className="text-sm text-muted">Nenhuma ideia nova.</p>}
        <ul className="flex flex-col gap-4">
          {pending.map((s) => (
            <li key={s.id} className="flex flex-col gap-3 border-t border-line-2 pt-4 first:border-0 first:pt-0">
              <div>
                <p className="font-semibold">{s.title}</p>
                {s.details && <p className="whitespace-pre-wrap text-sm text-ink-2">{s.details}</p>}
                <p className="text-xs text-muted">{s.agencyName ?? "conta apagada"} · {day(s.created_at)}</p>
              </div>
              <ActionForm action={publishRoadmapSuggestion.bind(null, s.id)} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input name="title" defaultValue={s.title.slice(0, ROADMAP_TITLE_MAX)} required minLength={3} maxLength={ROADMAP_TITLE_MAX} className="input sm:flex-[2]" aria-label="Título publicado" />
                <input name="summary" maxLength={ROADMAP_SUMMARY_MAX} placeholder="resumo (opcional)" className="input sm:flex-[3]" aria-label="Resumo publicado" />
                <SubmitButton className="btn-primary shrink-0" pendingLabel="…">Publicar em Ideias</SubmitButton>
              </ActionForm>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                {items.length > 0 && (
                  <ActionForm action={mergeRoadmapSuggestion.bind(null, s.id)} className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
                    <select name="item_id" required defaultValue="" className="input sm:flex-1" aria-label="Item parecido">
                      <option value="" disabled>juntar a um item parecido…</option>
                      {columns.map((c) => (
                        <optgroup key={c.status} label={c.title}>
                          {c.items.map((i) => (
                            <option key={i.id} value={i.id}>{i.title}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    <SubmitButton className="btn-ghost shrink-0" pendingLabel="…">Juntar</SubmitButton>
                  </ActionForm>
                )}
                <ConfirmAction action={rejectRoadmapSuggestion.bind(null, s.id)} title={`Recusar "${s.title}"?`} description="A pessoa vê no painel que a ideia não vai entrar agora." confirmLabel="Recusar" className="btn-ghost shrink-0 text-danger">
                  Recusar
                </ConfirmAction>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="card flex flex-col gap-4 p-5">
        <h2 className="text-lg font-bold">Itens <span className="font-normal text-muted">({items.length})</span></h2>
        <ActionForm action={saveRoadmapItem.bind(null, null)} success="Item criado." className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <ItemFields />
          <SubmitButton className="btn-primary shrink-0" pendingLabel="…">Adicionar</SubmitButton>
        </ActionForm>
        {columns.map((c) => (
          <div key={c.status} className="flex flex-col gap-2 border-t border-line-2 pt-4">
            <h3 className="text-sm font-bold">{c.title} <span className="font-normal text-muted">({c.items.length})</span></h3>
            {c.items.length === 0 && <p className="text-sm text-muted">Nada.</p>}
            <ul className="flex flex-col gap-2">
              {c.items.map((i) => (
                <li key={i.id} className="flex items-start gap-2">
                  <ActionForm action={saveRoadmapItem.bind(null, i.id)} className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
                    <ItemFields item={i} />
                    <span className="inline-flex w-14 shrink-0 items-center justify-end gap-1 text-xs text-muted tabular-nums" aria-label={`${i.likes} curtidas`}><ThumbsUp size={12} aria-hidden />{i.likes}</span>
                    <SubmitButton className="btn-ghost shrink-0" pendingLabel="…">Salvar</SubmitButton>
                  </ActionForm>
                  <ConfirmAction action={deleteRoadmapItem.bind(null, i.id)} title={`Apagar "${i.title}"?`} description="Some do roadmap junto com as curtidas." confirmLabel="Apagar" className="btn-icon mt-1.5">
                    <Trash2 size={15} />
                    <span className="sr-only">Apagar</span>
                  </ConfirmAction>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </>
  );
}
