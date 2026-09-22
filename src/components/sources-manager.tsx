"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { relativeTime } from "@/lib/utils";

export interface SourceItem {
  id: string;
  kind: string;
  title: string;
  url: string | null;
  status: string;
  chunk_count: number;
  pages: number;
  error: string | null;
  updated_at: string;
}

const KIND_LABEL: Record<string, string> = { site: "Site", page: "Página", pdf: "PDF", text: "Texto", faq: "FAQ" };

export function SourcesManager({ botId, sources }: { botId: string; sources: SourceItem[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<"site" | "page" | "pdf" | "text" | "faq" | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const fd = new FormData(e.currentTarget);
    fd.set("kind", mode!);
    const res = await fetch(`/api/bots/${botId}/sources`, { method: "POST", body: fd });
    const j = await res.json();
    setBusy(false);
    if (!res.ok) {
      setMsg(j.message ?? "Não deu certo.");
      router.refresh();
      return;
    }
    setMsg(`Pronto: ${j.chunks} trechos de ${j.pages} página${j.pages === 1 ? "" : "s"}.`);
    setMode(null);
    router.refresh();
  }

  async function remove(id: string) {
    if (!confirm("Remover esta fonte? O assistente deixa de saber o que estava nela.")) return;
    await fetch(`/api/bots/${botId}/sources?sourceId=${id}`, { method: "DELETE" });
    router.refresh();
  }
  async function reprocess(id: string) {
    setBusy(true);
    const res = await fetch(`/api/bots/${botId}/sources?sourceId=${id}`, { method: "PUT" });
    const j = await res.json();
    setBusy(false);
    setMsg(res.ok ? `Atualizado: ${j.chunks} trechos.` : j.message);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {(["site", "page", "pdf", "text", "faq"] as const).map((k) => (
          <button key={k} type="button" onClick={() => setMode(mode === k ? null : k)} className={mode === k ? "btn-dark" : "btn-ghost"}>
            {k === "site" ? "Adicionar site" : k === "page" ? "Uma página" : k === "pdf" ? "Enviar PDF" : k === "text" ? "Escrever texto" : "Perguntas e respostas"}
          </button>
        ))}
      </div>

      {mode && (
        <form onSubmit={submit} className="card flex flex-col gap-3 bg-ground p-4">
          {(mode === "site" || mode === "page") && (
            <div>
              <label htmlFor="src-url" className="label">{mode === "site" ? "Endereço do site (lê até 40 páginas do mesmo domínio)" : "Endereço da página"}</label>
              <input id="src-url" name="url" required className="input" placeholder="https://" />
            </div>
          )}
          {mode === "pdf" && (
            <div>
              <label htmlFor="src-file" className="label">Arquivo PDF (até 15 MB, com texto selecionável)</label>
              <input id="src-file" name="file" type="file" accept="application/pdf" required className="input" />
            </div>
          )}
          {(mode === "text" || mode === "faq") && (
            <>
              <div>
                <label htmlFor="src-title" className="label">Título</label>
                <input id="src-title" name="title" className="input" placeholder={mode === "faq" ? "Perguntas frequentes" : "Convênios aceitos e horários"} />
              </div>
              <div>
                <label htmlFor="src-content" className="label">{mode === "faq" ? "Uma pergunta e resposta por parágrafo (P: … / R: …)" : "Texto"}</label>
                <textarea id="src-content" name="content" required rows={8} className="input font-mono text-[13px]" placeholder={mode === "faq" ? "P: Aceitam Unimed?\nR: Sim, para consultas e limpeza.\n\nP: Tem estacionamento?\nR: Sim, gratuito no subsolo." : "Tudo que o assistente precisa saber e que não está no site."} />
              </div>
            </>
          )}
          <div className="flex items-center gap-3">
            <button type="submit" disabled={busy} className="btn-primary">{busy ? "Processando…" : "Adicionar e treinar"}</button>
            <button type="button" onClick={() => setMode(null)} className="text-sm text-muted">Cancelar</button>
          </div>
          {busy && <p className="text-xs text-muted">Lendo, quebrando em trechos e gerando embeddings. Sites grandes levam até um minuto.</p>}
        </form>
      )}
      {msg && <p className="rounded-lg bg-brand-soft px-3 py-2 text-sm text-brand">{msg}</p>}

      <div className="card overflow-hidden">
        <div className="hidden grid-cols-[2.4fr_1fr_1fr_1.2fr_1fr] gap-3 border-b border-line bg-ground px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.06em] text-muted md:grid">
          <span>Fonte</span><span>Tipo</span><span>Trechos</span><span>Atualizado</span><span />
        </div>
        {sources.length === 0 && <p className="p-5 text-sm text-muted">Nenhuma fonte ainda. Comece pelo site do cliente.</p>}
        {sources.map((s) => (
          <div key={s.id} className="grid grid-cols-1 gap-1 border-b border-line-2 px-4 py-3 text-sm last:border-0 md:grid-cols-[2.4fr_1fr_1fr_1.2fr_1fr] md:items-center md:gap-3">
            <div className="min-w-0 leading-tight">
              <span className="block truncate font-semibold">{s.title}</span>
              <span className="block truncate text-xs text-muted">
                {s.status === "error" ? <span className="text-danger">{s.error}</span> : s.status === "pending" ? "processando…" : s.kind === "site" ? `${s.pages} páginas` : s.kind === "pdf" ? `${s.pages} páginas` : s.url ?? ""}
              </span>
            </div>
            <span>{KIND_LABEL[s.kind] ?? s.kind}</span>
            <span className="tabular">{s.chunk_count}</span>
            <span className="text-muted">{relativeTime(s.updated_at)}</span>
            <span className="flex gap-3 text-[13px] font-semibold md:justify-end">
              {s.kind !== "pdf" && <button type="button" onClick={() => reprocess(s.id)} disabled={busy} className="text-brand">Atualizar</button>}
              <button type="button" onClick={() => remove(s.id)} className="text-danger">Remover</button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
