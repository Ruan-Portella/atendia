"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AlertCircle, Eye, FileText, Globe, Images, Link2, ListChecks, Loader2, Pencil, Plus, RefreshCw, Search, Sheet, Trash2, Type } from "lucide-react";
import { relativeTime } from "@/lib/utils";
import { socialNetworkOf } from "@/lib/social-links";
import { Modal, ConfirmModal } from "@/components/ui/modal";
import { Menu } from "@/components/ui/menu";
import { useToast } from "@/components/ui/toast";
import { liveValidation, validateForm } from "@/components/ui/form-errors";
import { InstagramPostsModal } from "@/components/instagram-posts-modal";
import { FaqFields } from "@/components/faq-fields";

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
  /** Erro da última releitura automática (a fonte continua valendo com o conteúdo anterior). */
  refresh_error?: string | null;
  /** "agência" ou o e-mail de quem do cliente editou pela área do cliente */
  created_by?: string | null;
  updated_at: string;
  /** Posts do Instagram (E1): posts na janela do Instagram, leitura pedida e a última leitura. */
  sync_total?: number | null;
  sync_requested_at?: string | null;
  last_refreshed_at?: string | null;
}

/** A conta do Instagram do chatbot, para a fonte dos posts (null: o Instagram não vale para este chatbot). */
export interface InstagramSourceInfo {
  username: string | null;
  connected: boolean;
  /** Chatbot com IA (os posts só entram na base de quem tem IA). */
  withAi: boolean;
}

type Kind = "site" | "page" | "pdf" | "csv" | "text" | "faq" | "instagram";

const KIND: Record<Kind, { label: string; add: string; hint: string; icon: React.ComponentType<{ size?: number; className?: string }> }> = {
  site: { label: "Site", add: "Adicionar site", hint: "Lê até 40 páginas do mesmo domínio.", icon: Globe },
  page: { label: "Página", add: "Uma página", hint: "Só uma página, sem seguir os links.", icon: Link2 },
  pdf: { label: "PDF", add: "Enviar PDF", hint: "Até 15 MB, com texto selecionável.", icon: FileText },
  csv: { label: "Planilha", add: "Enviar planilha CSV", hint: "Produtos, preços, tabelas. Até 2 MB, com cabeçalho.", icon: Sheet },
  text: { label: "Texto", add: "Escrever texto", hint: "O que o assistente precisa saber e não está no site.", icon: Type },
  faq: { label: "FAQ", add: "Perguntas e respostas", hint: "As dúvidas de sempre, com a resposta certa.", icon: ListChecks },
  instagram: { label: "Instagram", add: "Posts do Instagram", hint: "Os posts da conta conectada, com a foto descrita.", icon: Images },
};
const KINDS = Object.keys(KIND) as Kind[];

/** A fonte do Instagram está lendo (a primeira leitura ou "Atualizar agora"). */
const syncing = (s: SourceItem) => s.kind === "instagram" && (s.status === "pending" || Boolean(s.sync_requested_at));

/** Andamento da leitura dos posts: "12 de 100 posts". */
function postsProgress(s: SourceItem): string {
  const total = s.sync_total ?? null;
  return total ? `${Math.min(s.pages, total)} de ${total} posts` : `${s.pages} post${s.pages === 1 ? "" : "s"}`;
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return res.json().catch(() => ({}));
}

export function SourcesManager({ botId, sources, instagram = null }: { botId: string; sources: SourceItem[]; instagram?: InstagramSourceInfo | null }) {
  const router = useRouter();
  const toast = useToast();
  const [adding, setAdding] = useState<Kind | null>(null);
  // o modal de adicionar começa pela escolha do tipo (redesenho, etapa 5)
  const [picking, setPicking] = useState(false);
  // a busca na lista, a partir de 6 fontes (redesenho, etapa 5)
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<SourceItem | null>(null);
  const [removing, setRemoving] = useState<SourceItem | null>(null);
  const [postsOf, setPostsOf] = useState<string | null>(null); // a fonte do Instagram com a lista dos posts aberta
  const [busyId, setBusyId] = useState<string | null>(null); // linha em processamento
  const [saving, setSaving] = useState(false);
  // os posts do Instagram são lidos em segundo plano: a lista se atualiza sozinha enquanto lê
  const reading = sources.some(syncing);
  useEffect(() => {
    if (!reading) return;
    let rounds = 0;
    const timer = setInterval(() => {
      // até uns 10 minutos; depois, só recarregando a página
      if (++rounds > 100) return clearInterval(timer);
      router.refresh();
    }, 6000);
    return () => clearInterval(timer);
  }, [reading, router]);
  // o botão dos posts: só com o Instagram valendo para o chatbot e sem a fonte ainda
  const kinds = KINDS.filter((k) => k !== "instagram" || (instagram && !sources.some((s) => s.kind === "instagram")));

  /* ---------- adicionar ---------- */
  async function submitAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!validateForm(e.currentTarget)) return;
    const fd = new FormData(e.currentTarget);
    fd.set("kind", adding!);
    setSaving(true);
    try {
      const res = await fetch(`/api/bots/${botId}/sources`, { method: "POST", body: fd });
      const j = await readJson(res);
      if (!res.ok) {
        toast.error(String(j.message ?? "Não deu certo. Tente de novo."));
      } else {
        toast.success(j.queued ? "Lendo os posts do Instagram. Leva alguns minutos; a lista mostra o andamento." : `Pronto: ${j.chunks} trechos de ${j.pages} página${j.pages === 1 ? "" : "s"}.`);
        setAdding(null);
        setPicking(false);
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
    if (s.kind === "pdf" || s.kind === "csv") {
      setEditing(s);
      return;
    }
    setBusyId(s.id);
    try {
      const res = await fetch(`/api/bots/${botId}/sources?sourceId=${s.id}`, { method: "PUT" });
      const j = await readJson(res);
      if (res.ok) toast.success(j.queued ? "Buscando os posts novos do Instagram. A lista mostra o andamento." : `“${s.title}” atualizada: ${j.chunks} trechos.`);
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
  // a busca: pelo título, pelo endereço e pelo tipo, sem diferença de acento e maiúscula
  const norm = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const shown = query.trim() ? sources.filter((s) => norm(`${s.title} ${s.url ?? ""} ${KIND[s.kind as Kind]?.label ?? ""}`).includes(norm(query.trim()))) : sources;
  const totalChunks = sources.reduce((a, s) => a + s.chunk_count, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setPicking(true)} className="btn-primary">
          <Plus size={15} />
          Adicionar fonte
        </button>
        {sources.length > 5 && (
          <label className="relative ml-auto w-full sm:w-64">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar nas fontes" placeholder="Buscar nas fontes" className="input pl-9" />
          </label>
        )}
      </div>

      {/* adicionar num modal (redesenho, etapa 5, a pedido do usuário em 22/10): primeiro o tipo, depois os campos */}
      <Modal
        open={picking || adding !== null}
        onClose={() => {
          if (saving) return;
          setAdding(null);
          setPicking(false);
        }}
        title={adding ? KIND[adding].add : "Adicionar à base"}
        description={adding ? KIND[adding].hint : "O que o assistente vai ler. Dá para juntar várias fontes."}
        size={adding === "text" || adding === "faq" ? "lg" : "md"}
        footer={
          adding ? (
            <>
              {picking && (
                <button type="button" onClick={() => setAdding(null)} disabled={saving} className="btn-ghost mr-auto">
                  Outro tipo
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setAdding(null);
                  setPicking(false);
                }}
                disabled={saving}
                className="btn-ghost"
              >
                Cancelar
              </button>
              <button type="submit" form="src-add" disabled={saving || (adding === "instagram" && !(instagram?.connected && instagram.withAi))} className="btn-primary">
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                {saving ? "Processando…" : adding === "instagram" ? "Ler os posts" : "Adicionar e treinar"}
              </button>
            </>
          ) : undefined
        }
      >
        {adding ? (
          <form id="src-add" key={adding} onSubmit={submitAdd} noValidate {...liveValidation} className="flex flex-col gap-3">
            {adding === "instagram" ? <InstagramFields info={instagram} /> : <SourceFields kind={adding} />}
            {saving && adding !== "instagram" && <p className="text-xs text-muted">Lendo, quebrando em trechos e gerando embeddings. Sites grandes levam até um minuto.</p>}
          </form>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {kinds.map((k) => {
              const Icon = KIND[k].icon;
              return (
                <button key={k} type="button" onClick={() => setAdding(k)} className="flex items-start gap-3 rounded-[14px] border border-line p-3 text-left transition-colors duration-[120ms] hover:border-brand hover:bg-raised/40">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-raised text-ink-2">
                    <Icon size={17} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink">{KIND[k].add}</span>
                    <span className="mt-0.5 block text-xs leading-snug text-muted">{KIND[k].hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </Modal>

      <div className="card overflow-hidden">
        <div className="hidden grid-cols-[2.4fr_1fr_1fr_1.2fr_auto] gap-3 border-b border-line-2 bg-raised/40 px-4 py-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-muted md:grid">
          <span>Fonte</span><span>Tipo</span><span>Trechos</span><span>Atualizado</span><span className="w-8" />
        </div>
        {sources.length === 0 && (
          <div className="flex flex-col items-start gap-2 p-5">
            <p className="text-sm text-ink-2">Nenhuma fonte ainda. Comece pelo site do cliente: em um minuto o assistente já sabe responder sobre ele.</p>
            <button type="button" onClick={() => setAdding("site")} className="btn-primary"><Globe size={15} />Adicionar site</button>
          </div>
        )}
        {sources.length > 0 && shown.length === 0 && <p className="px-5 py-6 text-center text-sm text-muted">Nenhuma fonte com &ldquo;{query.trim()}&rdquo;.</p>}
        {shown.map((s) => {
          const Icon = KIND[s.kind as Kind]?.icon ?? Type;
          const processing = busyId === s.id || s.status === "pending";
          const posts = s.kind === "instagram";
          return (
            <div key={s.id} className={`flex flex-col gap-1.5 border-b border-line-2 px-4 py-3 text-sm transition-colors duration-[120ms] last:border-0 hover:bg-raised/30 md:grid md:grid-cols-[2.4fr_1fr_1fr_1.2fr_auto] md:items-center md:gap-3 ${processing ? "opacity-70" : ""}`}>
              <div className="flex min-w-0 items-center gap-2.5 leading-tight">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-raised text-ink-2">
                  {processing ? <Loader2 size={15} className="animate-spin" /> : s.status === "error" ? <AlertCircle size={15} className="text-danger" /> : <Icon size={15} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{s.title}</span>
                  <span className="block truncate text-xs text-muted">
                    {posts && processing ? `lendo os posts… ${postsProgress(s)}` : processing ? "processando…" : s.status === "error" ? <span className="text-danger">{s.error ?? "erro ao processar"}</span> : posts ? `${postsProgress(s)}${syncing(s) ? " · buscando posts novos…" : s.last_refreshed_at ? ` · lidos ${relativeTime(s.last_refreshed_at)}` : ""}` : s.kind === "site" || s.kind === "pdf" ? `${s.pages} página${s.pages === 1 ? "" : "s"}${s.url ? ` · ${s.url.replace(/^https?:\/\//, "")}` : ""}` : s.url?.replace(/^https?:\/\//, "") ?? `${s.content?.length ?? 0} caracteres`}
                  </span>
                  {s.created_by && s.created_by !== "agência" && <span className="block truncate text-xs text-brand">editado pelo cliente · {s.created_by}</span>}
                  {s.refresh_error && s.status === "ready" && <span className="block truncate text-xs text-amber-ink" title={s.refresh_error}>{posts ? `Não consegui buscar os posts novos (${s.refresh_error}); usando os que já tinha.` : "Não consegui reler na última atualização automática; usando o conteúdo anterior."}</span>}
                </span>
                <span className="md:hidden">
                  <SourceMenu s={s} processing={processing} onEdit={() => setEditing(s)} onReprocess={() => reprocess(s)} onRemove={() => setRemoving(s)} onPosts={() => setPostsOf(s.id)} />
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-[42px] text-xs text-muted md:contents md:pl-0">
                <span className="md:text-sm md:text-ink-2">{KIND[s.kind as Kind]?.label ?? s.kind}</span>
                <span className="tabular md:text-sm md:text-ink">{s.chunk_count}<span className="md:hidden"> trechos</span></span>
                <span className="md:text-sm">{relativeTime(s.updated_at)}</span>
              </div>
              <span className="hidden justify-end md:flex">
                <SourceMenu s={s} processing={processing} onEdit={() => setEditing(s)} onReprocess={() => reprocess(s)} onRemove={() => setRemoving(s)} onPosts={() => setPostsOf(s.id)} />
              </span>
            </div>
          );
        })}
        {sources.length > 0 && (
          <div className="flex flex-wrap justify-between gap-2 border-t border-line-2 bg-raised/40 px-4 py-2 text-xs text-muted">
            <span>{readyCount} de {sources.length} fonte{sources.length === 1 ? "" : "s"} pronta{readyCount === 1 ? "" : "s"} · {totalChunks} trechos indexados</span>
            <span className="hidden sm:inline">Mudou algo no site do cliente? Use “Reler e atualizar”.</span>
          </div>
        )}
      </div>

      {/* posts do Instagram: a lista, com a descrição das fotos corrigível */}
      <InstagramPostsModal botId={botId} sourceId={postsOf} open={postsOf !== null} onClose={() => setPostsOf(null)} />

      {/* editar */}
      <Modal
        open={editing !== null}
        onClose={() => !saving && setEditing(null)}
        title={editing?.kind === "pdf" ? "Atualizar PDF" : editing?.kind === "csv" ? "Atualizar planilha" : editing?.kind === "text" || editing?.kind === "faq" ? "Editar conteúdo" : editing?.kind === "instagram" ? "Renomear fonte" : "Editar fonte"}
        description={
          editing?.kind === "pdf" || editing?.kind === "csv"
            ? "Envie a versão nova do arquivo. O conteúdo antigo é substituído."
            : editing?.kind === "site" || editing?.kind === "page"
              ? "Se mudar o endereço, o site é lido de novo. Só o título não reprocessa nada."
              : editing?.kind === "instagram"
                ? "Só o título muda. Para buscar os posts novos, use “Atualizar agora”."
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
                <UrlInput id="edit-url" defaultValue={editing.url ?? ""} />
              </div>
            )}
            {editing.kind === "faq" && <FaqFields id="edit-content" defaultValue={editing.content ?? ""} />}
            {editing.kind === "text" && (
              <div>
                <label htmlFor="edit-content" className="label">Texto</label>
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
            {editing.kind === "csv" && (
              <div>
                <label htmlFor="edit-file" className="label">Nova planilha CSV (até 2 MB, com cabeçalho)</label>
                <input id="edit-file" name="file" type="file" accept=".csv,text/csv" className="input" />
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
          <UrlInput id="src-url" autoFocus />
        </div>
      )}
      {kind === "pdf" && (
        <div>
          <label htmlFor="src-file" className="label">Arquivo PDF (até 15 MB, com texto selecionável)</label>
          <input id="src-file" name="file" type="file" accept="application/pdf" required className="input" />
        </div>
      )}
      {kind === "csv" && (
        <div>
          <label htmlFor="src-file" className="label">Planilha CSV (até 2 MB; a primeira linha é o cabeçalho)</label>
          <input id="src-file" name="file" type="file" accept=".csv,text/csv" required className="input" />
          <p className="mt-1 text-xs text-muted">No Excel ou no Google Planilhas: Arquivo, Salvar como (ou Fazer download), CSV.</p>
        </div>
      )}
      {(kind === "text" || kind === "faq") && (
        <>
          <div>
            <label htmlFor="src-title" className="label">Título</label>
            <input id="src-title" name="title" autoFocus className="input" placeholder={kind === "faq" ? "Perguntas frequentes" : "Convênios aceitos e horários"} />
          </div>
          {kind === "faq" ? (
            <FaqFields id="src-content" />
          ) : (
            <div>
              <label htmlFor="src-content" className="label">Texto</label>
              <textarea id="src-content" name="content" required rows={8} className="input font-mono text-[13px]" placeholder="Tudo que o assistente precisa saber e que não está no site." />
            </div>
          )}
        </>
      )}
    </>
  );
}

/** Posts do Instagram (E1): o que a leitura faz e o que falta para poder ler. */
function InstagramFields({ info }: { info: InstagramSourceInfo | null }) {
  if (!info?.connected) return <p className="text-sm text-ink-2">Conecte o Instagram do cliente na aba <strong>Instagram</strong>: os posts são lidos da conta conectada.</p>;
  if (!info.withAi) return <p className="text-sm text-ink-2">Os posts do Instagram só entram na base de chatbot com IA (tamanho P, M, G ou Volume, em Cobrança).</p>;
  return (
    <div className="flex flex-col gap-1.5 text-sm text-ink-2">
      <p>
        Lê os posts dos últimos 90 dias (até 100) de <strong>@{info.username}</strong>: a legenda, a data e o link de cada um, e uma descrição curta de cada foto feita pela IA (no carrossel, de cada foto; no vídeo e no reel, da capa).
      </p>
      <p className="text-xs text-muted">A primeira leitura leva alguns minutos. Depois, os posts novos entram sozinhos a cada 6 horas, e a foto de cada post é descrita uma vez só. Stories não entram.</p>
    </div>
  );
}

/** Campo de endereço que avisa quando é rede social (o robô só consegue ler a bio). */
function UrlInput({ id, defaultValue, autoFocus }: { id: string; defaultValue?: string; autoFocus?: boolean }) {
  const [network, setNetwork] = useState(() => socialNetworkOf(defaultValue ?? ""));
  return (
    <>
      <input id={id} name="url" defaultValue={defaultValue} required autoFocus={autoFocus} className="input" placeholder="https://" onChange={(e) => setNetwork(socialNetworkOf(e.target.value))} aria-describedby={network ? `${id}-social` : undefined} />
      {network && (
        <p id={`${id}-social`} role="status" className="mt-2 flex items-start gap-2 rounded-lg border border-amber-line bg-amber-soft px-3 py-2 text-xs text-amber-ink">
          <AlertCircle size={14} className="mt-px shrink-0" />
          <span>O {network} esconde quase tudo de quem não está logado: o assistente aprende no máximo a bio e as legendas dos posts, e às vezes nem isso. Para horários, produtos, preços e dúvidas comuns, cadastre também um <strong>Texto</strong> ou <strong>FAQ</strong>.</span>
        </p>
      )}
    </>
  );
}

function SourceMenu({ s, processing, onEdit, onReprocess, onRemove, onPosts }: { s: SourceItem; processing: boolean; onEdit: () => void; onReprocess: () => void; onRemove: () => void; onPosts: () => void }) {
  const editable = s.kind === "text" || s.kind === "faq";
  return (
    <Menu
      items={[
        ...(s.kind === "instagram" ? [{ label: "Ver e corrigir os posts", icon: Eye, onSelect: onPosts, disabled: s.pages === 0 }] : []),
        { label: s.kind === "pdf" ? "Enviar novo PDF" : s.kind === "csv" ? "Enviar nova planilha" : s.kind === "site" || s.kind === "page" ? "Reler e atualizar" : s.kind === "instagram" ? "Atualizar agora" : "Editar conteúdo", icon: s.kind === "pdf" ? FileText : s.kind === "csv" ? Sheet : editable ? Pencil : RefreshCw, onSelect: editable ? onEdit : onReprocess, disabled: processing || syncing(s) },
        { label: s.kind === "site" || s.kind === "page" ? "Editar endereço ou título" : "Renomear", icon: Pencil, onSelect: onEdit, disabled: processing },
        { type: "separator" },
        { label: "Remover", icon: Trash2, danger: true, onSelect: onRemove, disabled: processing },
      ]}
    />
  );
}
