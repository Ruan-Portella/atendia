"use client";

import { useState } from "react";
import { ListChecks, Pencil, Plus, Trash2, Type } from "lucide-react";
import type { ActionResult } from "@/lib/action-result";
import { Modal } from "@/components/ui/modal";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmAction } from "@/components/ui/confirm-action";

export interface TextSourceItem {
  id: string;
  kind: string;
  title: string;
  content: string;
  meta: string; // "editado há 2 dias por joana@…"
  save: (fd: FormData) => Promise<ActionResult>;
  remove: () => Promise<ActionResult>;
}

/** Textos e FAQs do assistente, editáveis pelo cliente (sites e PDFs ficam com a agência). */
export function TextSources({ items, create }: { items: TextSourceItem[]; create: (fd: FormData) => Promise<ActionResult> }) {
  const [editing, setEditing] = useState<TextSourceItem | "new" | null>(null);
  const current = editing === "new" ? null : editing;
  return (
    <div className="flex flex-col gap-2">
      <div className="card overflow-hidden">
        {items.length === 0 && <p className="p-4 text-sm text-muted">Nenhum texto ainda. Escreva o que o assistente precisa saber e que não está no site (promoções, regras, perguntas frequentes).</p>}
        {items.map((s) => (
          <div key={s.id} className="flex items-center gap-3 border-b border-line-2 px-4 py-3 text-sm last:border-0">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ground text-muted">{s.kind === "faq" ? <ListChecks size={15} /> : <Type size={15} />}</span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate font-semibold">{s.title}</span>
              <span className="block truncate text-xs text-muted">{s.meta}</span>
            </span>
            <button type="button" onClick={() => setEditing(s)} className="btn-icon" aria-label={`Editar ${s.title}`}><Pencil size={15} /></button>
            <ConfirmAction action={s.remove} title="Excluir este conteúdo?" description={<>O assistente deixa de usar <strong className="text-ink">{s.title}</strong>. Não tem desfazer.</>} confirmLabel="Excluir" className="btn-icon">
              <Trash2 size={15} />
              <span className="sr-only">Excluir</span>
            </ConfirmAction>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => setEditing("new")} className="btn-ghost self-start"><Plus size={15} />Adicionar texto ou FAQ</button>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={current ? "Editar conteúdo" : "Ensinar algo novo"} description="Ao salvar, o assistente aprende na hora." size="lg">
        {editing !== null && (
          <ActionForm key={current?.id ?? "new"} action={current ? current.save : create} onSuccess={() => setEditing(null)} className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
              <div>
                <label htmlFor="ts-title" className="label">Título</label>
                <input id="ts-title" name="title" maxLength={120} defaultValue={current?.title ?? ""} className="input" placeholder="Ex.: Promoções de setembro" />
              </div>
              <div>
                <label htmlFor="ts-kind" className="label">Tipo</label>
                <select id="ts-kind" name="kind" defaultValue={current?.kind ?? "text"} disabled={Boolean(current)} className="input">
                  <option value="text">Texto livre</option>
                  <option value="faq">Perguntas e respostas</option>
                </select>
                {current && <input type="hidden" name="kind" value={current.kind} />}
              </div>
            </div>
            <div>
              <label htmlFor="ts-content" className="label">Conteúdo (no FAQ, uma pergunta e resposta por parágrafo: P: … / R: …)</label>
              <textarea id="ts-content" name="content" required minLength={20} maxLength={50000} rows={12} defaultValue={current?.content ?? ""} className="input font-mono text-[13px]" />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} className="btn-ghost">Cancelar</button>
              <SubmitButton pendingLabel="Treinando…">Salvar</SubmitButton>
            </div>
          </ActionForm>
        )}
      </Modal>
    </div>
  );
}
