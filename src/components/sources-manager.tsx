"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertCircle, FileText, Globe, Link2, ListChecks, Loader2, Pencil, Plus, RefreshCw, Trash2, Type } from "lucide-react";
import { relativeTime } from "@/lib/utils";
import { Modal, ConfirmModal } from "@/components/ui/modal";
import { Menu } from "@/components/ui/menu";
import { useToast } from "@/components/ui/toast";

export interface SourceItem {
  id: string;
  kind: string;
  title: string;
  url: string | null;
  content: string | null;
  status: string;
  chunk_count: number;
  pages: number;
  error: string | null;
  updated_at: string;
}

type Kind = "site" | "page" | "pdf" | "text" | "faq";

const KIND: Record<Kind, { label: string; add: string; icon: React.ComponentType<{ size?: number; className?: string }> }> = {
  site: { label: "Site", add: "Adicionar site", icon: Globe },
  page: { label: "Página", add: "Uma página", icon: Link2 },
  pdf: { label: "PDF", add: "Enviar PDF", icon: FileText },
  text: { label: "Texto", add: "Escrever texto", icon: Type },
  faq: { label: "FAQ", add: "Perguntas e respostas", icon: ListChecks },
};
const KINDS = Object.keys(KIND) as Kind[];

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return res.json().catch(() => ({}));
}

export function SourcesManager({ botId, sources }: { botId: string; sources: SourceItem[] }) {
  const router = useRouter();
  const toast = useToast();
  const [adding, setAdding] = useState<Kind | null>(null);
  const [editing, setEditing] = useState<SourceItem | null>(null);
  const [removing, setRemoving] = useState<SourceItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null); // linha em processamento
  const [saving, setSaving] = useState(false);

  /* ---------- adicionar ---------- */
  async function submitAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("kind", adding!);
    setSaving(true);
    try {
      const res = await fetch(`/api/bots/${botId}/sources`, { method: "POST", body: fd });
      const j = await readJson(res);
      if (!res.ok) {
        toast.error(String(j.message ?? "Não deu certo. Tente de novo."));
      } else {
        toast.success(`Pronto: ${j.chunks} trechos de ${j.pages} página${j.pages === 1 ? "" : "s"}.`);
        setAdding(null);
      }
    } catch {
      toast.error("Sem resposta do servidor. Verifique a conexão e tente de novo.");
    }
    setSaving(false);
    router.refresh();
  }

  /* ---------- editar / reenviar ---------- */
  async function submitEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    const fd = new FormData(e.currentTarget);
    const file = fd.get("file");
    if (file instanceof File && file.size === 0) fd.delete("file");
    setSaving(true);
    setBusyId(editing.id);
    try {
      const res = await fetch(`/api/bots/${botId}/sources?sourceId=${editing.id}`, { method: "PUT", body: fd });
      const j = await readJson(res);
      if (!res.ok) toast.error(String(j.message ?? "Não deu certo."));
      else if (j.renamed) toast.success("Título atualizado.");
      else toast.success(`Atualizado: ${j.chunks} trechos de ${j.pages} página${j.pages === 1 ? "" : "s"}.`);
      if (res.ok) setEditing(null);
    } catch {
      toast.error("Sem resposta do servidor. Tente de novo.");
    }
    setSaving(false);
    setBusyId(null);
    router.refresh();
  }

  /* ---------- reprocessar ---------- */
  async function reprocess(s: SourceItem) {
    if (s.kind === "pdf") {
      setEditing(s);
      return;
    }
    setBusyId(s.id);
    try {
      const res = await fetch(`/api/bots/${botId}/sources?sourceId=${s.id}`, { method: "PUT" });
      const j = await readJson(res);
      if (res.ok) toast.success(`“${s.title}” atualizada: ${j.chunks} trechos.`);
      else toast.error(String(j.message ?? "Não foi possível atualizar."));
    } catch {
      toast.error("Sem resposta do servidor. Tente de novo.");
    }
    setBusyId(null);
    router.refresh();
  }

  /* ---------- remover ---------- */
  async function confirmRemove() {
    if (!removing) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/bots/${botId}/sources?sourceId=${removing.id}`, { method: "DELETE" });
      const j = await readJson(res);
      if (res.ok) {
        toast.success(`“${removing.title}” removida.`);
        setRemoving(null);
      } else toast.error(String(j.message ?? "Não foi possível remover."));
    } catch {
      toast.error("Sem resposta do servidor. Tente de novo.");
    }
    setSaving(false);
    router.refresh();
  }

  const readyCount = sources.filter((s) => s.status === "ready").length;
  const totalChunks = sources.reduce((a, s) => a + s.chunk_count, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {KINDS.map((k) => {
          const Icon = KIND[k].icon;
          return (
            <button key={k} type="button" onClick={() => setAdding(adding === k ? null : k)} aria-pressed={adding === k} className={adding === k ? "btn-dark" : "btn-ghost"}>
              <Icon size={15} />
              {KIND[k].add}
            </button>
          );
        })}
      </div>

      {adding && (
        <form onSubmit={submitAdd} className="card flex flex-col gap-3 bg-ground p-4">
          <SourceFields kind={adding} />
          <div className="flex items-center gap-3">
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
              {saving ? "Processando…" : "Adicionar e treinar"}
            </button>
            <button type="button" onClick={() => setAdding(null)} disabled={saving} className="text-sm text-muted">Cancelar</button>
          </div>
          {saving && <p className="text-xs text-muted">Lendo, quebrando em trechos e gerando embeddings. Sites grandes levam até um minuto.</p>}
        </form>
      )}

      <div className="card overflow-hidden">
        <div className="hidden grid-cols-[2.4fr_1fr_1fr_1.2fr_auto] gap-3 border-b border-line bg-ground px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.06em] text-muted md:grid">
          <span>Fonte</span><span>Tipo</span><span>Trechos</span><span>Atualizado</span><span className="w-8" />
        </div>
        {sources.length === 0 && (
          <div className="flex flex-col items-start gap-2 p-5">
            <p className="text-sm text-ink-2">Nenhuma fonte ainda. Comece pelo site do cliente: em um minuto o assistente já sabe responder sobre ele.</p>
            <button type="button" onClick={() => setAdding("site")} className="btn-primary"><Globe size={15} />Adicionar site</button>
          </div>
        )}
        {sources.map((s) => {
          const Icon = KIND[s.kind as Kind]?.icon ?? Type;
          const processing = busyId === s.id || s.status === "pending";
          return (
            <div key={s.id} className={`flex flex-col gap-1.5 border-b border-line-2 px-4 py-3 text-sm last:border-0 md:grid md:grid-cols-[2.4fr_1fr_1fr_1.2fr_auto] md:items-center md:gap-3 ${processing ? "opacity-70" : ""}`}>
              <div className="flex min-w-0 items-center gap-2.5 leading-tight">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ground text-muted">
                  {processing ? <Loader2 size={15} className="animate-spin" /> : s.status === "error" ? <AlertCircle size={15} className="text-danger" /> : <Icon size={15} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{s.title}</span>
                  <span className="block truncate text-xs text-muted">
                    {processing ? "processando…" : s.status === "error" ? <span className="text-danger">{s.error ?? "erro ao processar"}</span> : s.kind === "site" || s.kind === "pdf" ? `${s.pages} página${s.pages === 1 ? "" : "s"}${s.url ? ` · ${s.url.replace(/^https?:\/\//, "")}` : ""}` : s.url?.replace(/^https?:\/\//, "") ?? `${s.content?.length ?? 0} caracteres`}
                  </span>
                </span>
                <span className="md:hidden">
                  <SourceMenu s={s} processing={processing} onEdit={() => setEditing(s)} onReprocess={() => reprocess(s)} onRemove={() => setRemoving(s)} />
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-[42px] text-xs text-muted md:contents md:pl-0">
                <span className="md:text-sm md:text-ink-2">{KIND[s.kind as Kind]?.label ?? s.kind}</span>
                <span className="tabular md:text-sm md:text-ink">{s.chunk_count}<span className="md:hidden"> trechos</span></span>
                <span className="md:text-sm">{relativeTime(s.updated_at)}</span>
              </div>
              <span className="hidden justify-end md:flex">
                <SourceMenu s={s} processing={processing} onEdit={() => setEditing(s)} onReprocess={() => reprocess(s)} onRemove={() => setRemoving(s)} />
              </span>
            </div>
          );
        })}
        {sources.length > 0 && (
          <div className="flex flex-wrap justify-between gap-2 bg-ground px-4 py-2 text-xs text-muted">
            <span>{readyCount} de {sources.length} fonte{sources.length === 1 ? "" : "s"} pronta{readyCount === 1 ? "" : "s"} · {totalChunks} trechos indexados</span>
            <span className="hidden sm:inline">Mudou algo no site do cliente? Use “Reler e atualizar”.</span>
          </div>
        )}
      </div>

      {/* editar */}
      <Modal
        open={editing !== null}
        onClose={() => !saving && setEditing(null)}
        title={editing?.kind === "pdf" ? "Atualizar PDF" : editing?.kind === "text" || editing?.kind === "faq" ? "Editar conteúdo" : "Editar fonte"}
        description={
          editing?.kind === "pdf"
            ? "Envie a versão nova do arquivo. O conteúdo antigo é substituído."
            : editing?.kind === "site" || editing?.kind === "page"
              ? "Se mudar o endereço, o site é lido de novo. Só o título não reprocessa nada."
              : "Ao salvar, o assistente é retreinado com o texto novo."
        }
        size={editing?.kind === "text" || editing?.kind === "faq" ? "lg" : "md"}
      >
        {editing && (
          <form key={editing.id} onSubmit={submitEdit} className="flex flex-col gap-3">
            <div>
              <label htmlFor="edit-title" className="label">Título</label>
              <input id="edit-title" name="title" defaultValue={editing.title} required className="input" />
            </div>
            {(editing.kind === "site" || editing.kind === "page") && (
              <div>
                <label htmlFor="edit-url" className="label">Endereço</label>
                <input id="edit-url" name="url" defaultValue={editing.url ?? ""} required className="input" placeholder="https://" />
              </div>
            )}
            {(editing.kind === "text" || editing.kind === "faq") && (
              <div>
                <label htmlFor="edit-content" className="label">{editing.kind === "faq" ? "Uma pergunta e resposta por parágrafo (P: … / R: …)" : "Texto"}</label>
                <textarea id="edit-content" name="content" defaultValue={editing.content ?? ""} required rows={14} className="input font-mono text-[13px]" />
              </div>
            )}
            {editing.kind === "pdf" && (
              <div>
                <label htmlFor="edit-file" className="label">Novo arquivo PDF (até 15 MB, com texto selecionável)</label>
                <input id="edit-file" name="file" type="file" accept="application/pdf" className="input" />
                <p className="mt-1 text-xs text-muted">Sem arquivo, só o título é alterado.</p>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setEditing(null)} disabled={saving} className="btn-ghost">Cancelar</button>
              <button type="submit" disabled={saving} className="btn-primary">
                {saving && <Loader2 size={15} className="animate-spin" />}
                {saving ? "Processando…" : "Salvar"}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* remover */}
      <ConfirmModal
        open={removing !== null}
        onClose={() => !saving && setRemoving(null)}
        onConfirm={confirmRemove}
        busy={saving}
        danger
        title="Remover esta fonte?"
        description={
          removing ? (
            <>
              <strong className="text-ink">“{removing.title}”</strong> e seus {removing.chunk_count} trechos saem da base. O assistente deixa de saber o que estava nela. Isso não tem desfazer.
            </>
          ) : null
        }
        confirmLabel="Remover fonte"
      />
    </div>
  );
}

function SourceFields({ kind }: { kind: Kind }) {
  return (
    <>
      {(kind === "site" || kind === "page") && (
        <div>
          <label htmlFor="src-url" className="label">{kind === "site" ? "Endereço do site (lê até 40 páginas do mesmo domínio)" : "Endereço da página"}</label>
          <input id="src-url" name="url" required autoFocus className="input" placeholder="https://" />
        </div>
      )}
      {kind === "pdf" && (
        <div>
          <label htmlFor="src-file" className="label">Arquivo PDF (até 15 MB, com texto selecionável)</label>
          <input id="src-file" name="file" type="file" accept="application/pdf" required className="input" />
        </div>
      )}
      {(kind === "text" || kind === "faq") && (
        <>
          <div>
            <label htmlFor="src-title" className="label">Título</label>
            <input id="src-title" name="title" autoFocus className="input" placeholder={kind === "faq" ? "Perguntas frequentes" : "Convênios aceitos e horários"} />
          </div>
          <div>
            <label htmlFor="src-content" className="label">{kind === "faq" ? "Uma pergunta e resposta por parágrafo (P: … / R: …)" : "Texto"}</label>
            <textarea id="src-content" name="content" required rows={8} className="input font-mono text-[13px]" placeholder={kind === "faq" ? "P: Aceitam Unimed?\nR: Sim, para consultas e limpeza.\n\nP: Tem estacionamento?\nR: Sim, gratuito no subsolo." : "Tudo que o assistente precisa saber e que não está no site."} />
          </div>
        </>
      )}
    </>
  );
}

function SourceMenu({ s, processing, onEdit, onReprocess, onRemove }: { s: SourceItem; processing: boolean; onEdit: () => void; onReprocess: () => void; onRemove: () => void }) {
  const editable = s.kind === "text" || s.kind === "faq";
  return (
    <Menu
      items={[
        { label: s.kind === "pdf" ? "Enviar novo PDF" : s.kind === "site" || s.kind === "page" ? "Reler e atualizar" : "Editar conteúdo", icon: s.kind === "pdf" ? FileText : editable ? Pencil : RefreshCw, onSelect: editable ? onEdit : onReprocess, disabled: processing },
        { label: s.kind === "site" || s.kind === "page" ? "Editar endereço ou título" : "Renomear", icon: Pencil, onSelect: onEdit, disabled: processing },
        { type: "separator" },
        { label: "Remover", icon: Trash2, danger: true, onSelect: onRemove, disabled: processing },
      ]}
    />
  );
}
