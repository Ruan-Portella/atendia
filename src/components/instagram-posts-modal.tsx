"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Loader2, Pencil } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { postDate } from "@/lib/post-context";

interface PostItem {
  id: string;
  media_type: string;
  is_reel: boolean;
  caption: string | null;
  permalink: string | null;
  posted_at: string;
  description: string | null;
  description_edited_at: string | null;
  description_edited_by: string | null;
}

const kindLabel = (p: PostItem) => (p.media_type === "CAROUSEL_ALBUM" ? "Carrossel" : p.media_type === "VIDEO" ? (p.is_reel ? "Reel" : "Vídeo") : "Foto");
const lineLabel = (p: PostItem, i: number) => (p.media_type === "CAROUSEL_ALBUM" ? `Foto ${i + 1}` : p.media_type === "VIDEO" ? "Capa" : "Foto");

/**
 * Os posts do Instagram lidos para a base (itens menores da conferência de 20/10, parte 5): a
 * legenda, o link e a descrição de cada foto. A descrição automática pode errar o produto, a cor
 * ou o sabor; a equipe corrige aqui e os trechos do post são refeitos com o texto novo.
 */
export function InstagramPostsModal({ botId, sourceId, open, onClose }: { botId: string; sourceId: string | null; open: boolean; onClose: () => void }) {
  const toast = useToast();
  // a lista fica presa à fonte: abrir de novo relê (e mostra a anterior até chegar)
  const [loaded, setLoaded] = useState<{ sourceId: string; posts: PostItem[] | null; failed: boolean } | null>(null);
  const current = loaded && loaded.sourceId === sourceId ? loaded : null;
  const posts = current?.posts ?? null;
  const failed = current?.failed ?? false;
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !sourceId) return;
    let alive = true;
    fetch(`/api/bots/${botId}/sources/${sourceId}/posts`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { posts: PostItem[] }) => alive && setLoaded({ sourceId, posts: j.posts, failed: false }))
      .catch(() => alive && setLoaded({ sourceId, posts: null, failed: true }));
    return () => {
      alive = false;
    };
  }, [open, botId, sourceId]);

  async function save(p: PostItem) {
    setSaving(true);
    try {
      const res = await fetch(`/api/bots/${botId}/sources/${sourceId}/posts`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ postId: p.id, description: draft }) });
      const j = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) return toast.error(j.message ?? "Não foi possível salvar a descrição.");
      const lines = draft.split(/\r\n?|\n/).map((l) => l.replace(/^\s*(foto|capa)(\s+\d+)?\s*:\s*/i, "").replace(/\s+/g, " ").trim()).filter(Boolean);
      setLoaded((l) => (l ? { ...l, posts: l.posts?.map((x) => (x.id === p.id ? { ...x, description: lines.length ? lines.join("\n") : null, description_edited_at: new Date().toISOString() } : x)) ?? null } : l));
      setEditing(null);
      toast.success("Descrição salva: o assistente já usa o texto novo.");
    } catch {
      toast.error("Não foi possível salvar agora. Verifique a conexão e tente de novo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        if (saving) return;
        setEditing(null);
        onClose();
      }} title="Posts do Instagram" description="O que o assistente sabe de cada post: a legenda e a descrição das fotos. A descrição é automática e pode errar; corrija o que estiver errado (uma linha por foto, na ordem)." size="lg">
      {failed ? (
        <p className="text-sm text-danger">Não foi possível carregar os posts. Feche e abra de novo.</p>
      ) : !posts ? (
        <p className="flex items-center gap-2 text-sm text-muted"><Loader2 size={15} className="animate-spin" />Carregando os posts…</p>
      ) : posts.length === 0 ? (
        <p className="text-sm text-muted">Nenhum post lido ainda. A leitura leva alguns minutos; a lista da base mostra o andamento.</p>
      ) : (
        <ul className="flex max-h-[65dvh] flex-col gap-3 overflow-y-auto pr-1">
          {posts.map((p) => {
            const lines = (p.description ?? "").split("\n").filter(Boolean);
            return (
              <li key={p.id} className="flex flex-col gap-2 rounded-lg border border-line-2 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                  <span className="font-semibold text-ink">{kindLabel(p)} de {postDate(p.posted_at)}</span>
                  {p.description_edited_at && <span className="rounded bg-brand-soft px-1.5 py-0.5 font-semibold text-brand">descrição revisada pela equipe</span>}
                  {p.permalink && (
                    <a href={p.permalink} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 hover:underline">
                      Abrir no Instagram <ExternalLink size={12} />
                    </a>
                  )}
                </div>
                <p className="line-clamp-3 whitespace-pre-line text-ink-2">{p.caption?.trim() || <span className="text-muted">(sem legenda)</span>}</p>
                {editing === p.id ? (
                  <div className="flex flex-col gap-2">
                    <label htmlFor={`desc-${p.id}`} className="label">Descrição das fotos (uma linha por foto, na ordem)</label>
                    <textarea id={`desc-${p.id}`} value={draft} onChange={(e) => setDraft(e.target.value)} rows={Math.min(10, Math.max(3, lines.length + 1))} maxLength={8000} className="input text-[13px]" placeholder="Ex.: Tênis de corrida azul-marinho, numeração 34 a 44." />
                    <p className="text-xs text-muted">Vazio: o post fica só com a legenda. A leitura de 6 em 6 horas não troca o que você escreveu.</p>
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => setEditing(null)} disabled={saving} className="btn-ghost">Cancelar</button>
                      <button type="button" onClick={() => save(p)} disabled={saving} className="btn-primary">
                        {saving && <Loader2 size={15} className="animate-spin" />}
                        {saving ? "Salvando…" : "Salvar"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {lines.length ? (
                      <ul className="flex flex-col gap-1 border-l-2 border-line pl-3 text-xs text-ink-2">
                        {lines.map((l, i) => (
                          <li key={i}><span className="font-semibold">{lineLabel(p, i)}:</span> {l}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-muted">Sem descrição das fotos (o assistente usa só a legenda).</p>
                    )}
                    <button type="button" onClick={() => { setEditing(p.id); setDraft(lines.join("\n")); }} disabled={saving || (editing !== null && editing !== p.id)} className="btn-ghost self-start text-xs">
                      <Pencil size={13} />Corrigir a descrição
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
