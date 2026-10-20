"use client";

import { useState } from "react";
import { Link2, Trash2 } from "lucide-react";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { CopyButton } from "@/components/copy-button";
import type { ActionResult } from "@/lib/action-result";
import { ICE_BREAKERS_MAX, ICE_BREAKER_MAX, PUBLIC_REPLY_MAX, REF_LABEL_MAX, REF_NOTE_MAX, REPLY_MAX, igMeLink, refFromLabel } from "@/lib/instagram-links";
import { relativeTime } from "@/lib/utils";

/*
 * O direct do Instagram na aba Instagram (E1, partes 3a e 3b): as perguntas prontas (ice breakers),
 * os links ig.me com origem para a bio, o QR impresso e o anúncio, e as palavras-chave.
 */

type Save = (formData: FormData) => Promise<ActionResult>;

export function IceBreakersCard({ questions, syncedAt, error, connected, save }: { questions: string[]; syncedAt: string | null; error: string | null; connected: boolean; save: Save }) {
  return (
    <ActionForm action={save} className="card flex flex-col gap-3 p-5">
      <div>
        <div className="font-semibold">Perguntas prontas do direct</div>
        <p className="text-sm text-muted">Até {ICE_BREAKERS_MAX} perguntas que aparecem quando a pessoa abre o direct da loja pela primeira vez (no app; no computador, não). O toque chega como mensagem e o assistente responde.</p>
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: ICE_BREAKERS_MAX }, (_, i) => (
          <input key={i} name={`q${i + 1}`} defaultValue={questions[i] ?? ""} maxLength={ICE_BREAKER_MAX} aria-label={`Pergunta ${i + 1}`} placeholder={["Qual o horário de vocês?", "Vocês entregam no meu bairro?", "Quais as formas de pagamento?", "Como faço um pedido?"][i]} className="input" />
        ))}
      </div>
      {error ? (
        <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>
      ) : syncedAt ? (
        <p className="text-xs text-muted">No Instagram desde {relativeTime(syncedAt)}.</p>
      ) : !connected && questions.length ? (
        <p className="text-xs text-muted">Salvas no chatbot: vão para o Instagram quando a conta for conectada.</p>
      ) : null}
      <p className="text-xs text-muted">Com as perguntas prontas, a Meta também manda a origem do link ig.me em conversa nova (veja os links abaixo). Para tirar todas, apague os campos e salve.</p>
      <SubmitButton pendingLabel="Salvando…" className="btn-ghost self-start">
        Salvar perguntas
      </SubmitButton>
    </ActionForm>
  );
}

export interface RefLinkItem {
  id: string;
  ref: string;
  label: string;
  note: string | null;
  created_at: string;
}

export function RefLinksCard({ username, links, hasIceBreakers, add, remove }: { username: string | null; links: RefLinkItem[]; hasIceBreakers: boolean; add: Save; remove: Save }) {
  const [label, setLabel] = useState("");
  const [ref, setRef] = useState("");
  const shownRef = ref || refFromLabel(label);
  return (
    <div className="card flex flex-col gap-3 p-5">
      <div>
        <div className="font-semibold">Links com origem</div>
        <p className="text-sm text-muted">Um link do direct para cada lugar (bio, QR do balcão, anúncio): o painel mostra de onde a pessoa veio e o assistente sabe disso. O link abre o direct no app do Instagram, no celular (no computador, o Instagram não abre links ig.me). Para o QR impresso, gere o código com o link no app que preferir.</p>
      </div>
      {!hasIceBreakers && <p className="rounded-lg bg-amber-soft px-3 py-2 text-xs text-amber-ink">Em conversa nova, a Meta só manda a origem quando a conta tem perguntas prontas. Cadastre as perguntas acima para não perder a origem de quem chega pela primeira vez.</p>}
      {links.length > 0 && (
        <ul className="flex flex-col divide-y divide-line-2 rounded-xl border border-line">
          {links.map((l) => {
            const url = username ? igMeLink(username, l.ref) : null;
            return (
              <li key={l.id} className="flex flex-col gap-1.5 px-3 py-2.5 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Link2 size={14} className="text-muted" />
                  <span className="font-semibold">{l.label}</span>
                  <span className="text-xs text-muted">origem “{l.ref}”</span>
                  <span className="ml-auto flex items-center gap-2">
                    {url && <CopyButton text={url} label="Copiar link" className="text-xs font-semibold text-brand hover:underline" icon={false} />}
                    <ActionForm action={remove} success="Link removido.">
                      <input type="hidden" name="id" value={l.id} />
                      <SubmitButton pendingLabel="Removendo…" className="flex items-center gap-1 text-xs font-medium text-danger hover:underline" aria-label={`Remover o link ${l.label}`}>
                        <Trash2 size={13} />
                        Remover
                      </SubmitButton>
                    </ActionForm>
                  </span>
                </div>
                {url && <code className="break-all text-xs text-ink-2">{url}</code>}
                {l.note && <p className="text-xs text-muted">Nota para a IA: {l.note}</p>}
              </li>
            );
          })}
        </ul>
      )}
      <ActionForm action={add} onSuccess={() => (setLabel(""), setRef(""))} className="flex flex-col gap-2 rounded-xl bg-ground p-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <label htmlFor="ref-label" className="label">Nome do link</label>
            <input id="ref-label" name="label" required maxLength={REF_LABEL_MAX} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="QR do balcão" className="input" />
          </div>
          <div>
            <label htmlFor="ref-ref" className="label">Origem (no link)</label>
            <input id="ref-ref" name="ref" maxLength={40} value={ref} onChange={(e) => setRef(e.target.value.toLowerCase())} placeholder={shownRef || "qr-do-balcao"} className="input" />
          </div>
        </div>
        <div>
          <label htmlFor="ref-note" className="label">Nota para a IA (opcional)</label>
          <input id="ref-note" name="note" maxLength={REF_NOTE_MAX} placeholder="Ex.: o anúncio é do vestido midi floral, de R$ 129" className="input" />
        </div>
        {username && shownRef && <p className="break-all text-xs text-muted">O link vai ficar: {igMeLink(username, shownRef)}</p>}
        <SubmitButton pendingLabel="Criando…" className="btn-ghost self-start">
          Criar link
        </SubmitButton>
      </ActionForm>
    </div>
  );
}

export interface KeywordItem {
  id: string;
  words: string[];
  dm_reply: string | null;
  comment_reply: string | null;
  comment_public: string | null;
  media_ids: string[] | null;
  active: boolean;
}

/** Um post da fonte do Instagram, para escolher onde a palavra vale nos comentários. */
export interface PostChoice {
  media_id: string;
  caption: string | null;
  posted_at: string;
}

/** Os campos de uma palavra-chave (nova ou existente). */
function KeywordFields({ k, commentsOn, posts }: { k: KeywordItem | null; commentsOn: boolean; posts: PostChoice[] }) {
  const [scope, setScope] = useState(k?.media_ids ? "escolhidos" : "todos");
  const prefix = k ? k.id : "novo";
  return (
    <>
      {k && <input type="hidden" name="id" value={k.id} />}
      <div>
        <label htmlFor={`kw-words-${prefix}`} className="label">Palavras (separadas por vírgula)</label>
        <input id={`kw-words-${prefix}`} name="words" required defaultValue={k?.words.join(", ") ?? ""} placeholder="preço, eu quero" className="input" />
      </div>
      <div>
        <label htmlFor={`kw-dm-${prefix}`} className="label">Resposta pronta no direct (quando a pessoa manda só a palavra)</label>
        <textarea id={`kw-dm-${prefix}`} name="dm_reply" rows={3} maxLength={REPLY_MAX} defaultValue={k?.dm_reply ?? ""} placeholder="Oi! A tabela de preços está aqui: …" className="input" />
      </div>
      {commentsOn && (
        <>
          <div>
            <label htmlFor={`kw-cr-${prefix}`} className="label">Resposta privada ao comentário (vai no direct; uma por comentário, até 7 dias)</label>
            <textarea id={`kw-cr-${prefix}`} name="comment_reply" rows={3} maxLength={REPLY_MAX} defaultValue={k?.comment_reply ?? ""} placeholder="Oi! Te mandei os detalhes por aqui 😊" className="input" />
          </div>
          <div>
            <label htmlFor={`kw-cp-${prefix}`} className="label">Resposta pública no comentário (opcional, curta)</label>
            <input id={`kw-cp-${prefix}`} name="comment_public" maxLength={PUBLIC_REPLY_MAX} defaultValue={k?.comment_public ?? ""} placeholder="Te chamei no direct!" className="input" />
          </div>
          <fieldset className="flex flex-col gap-1.5 text-sm">
            <legend className="label">Nos comentários de</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="posts" value="todos" checked={scope === "todos"} onChange={() => setScope("todos")} /> todos os posts
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="posts" value="escolhidos" checked={scope === "escolhidos"} onChange={() => setScope("escolhidos")} disabled={!posts.length} /> posts escolhidos{!posts.length && <span className="text-xs text-muted"> (leia os posts na aba Base de conhecimento)</span>}
            </label>
            {scope === "escolhidos" && (
              <div className="ml-6 flex max-h-48 flex-col gap-1 overflow-y-auto rounded-lg border border-line p-2">
                {posts.map((p) => (
                  <label key={p.media_id} className="flex items-start gap-2 text-xs">
                    <input type="checkbox" name="media_ids" value={p.media_id} defaultChecked={k?.media_ids?.includes(p.media_id)} className="mt-0.5" />
                    <span className="min-w-0">
                      <span className="text-muted">{new Date(p.posted_at).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })} · </span>
                      {p.caption?.trim().slice(0, 90) || "(sem legenda)"}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        </>
      )}
      {k && (
        <label className="flex items-center gap-2 text-sm">
          <input type="hidden" name="has_active" value="1" />
          <input type="checkbox" name="active" value="on" defaultChecked={k.active} /> ligada
        </label>
      )}
    </>
  );
}

export function KeywordsCard({ keywords, commentsOn, posts, save, remove }: { keywords: KeywordItem[]; commentsOn: boolean; posts: PostChoice[]; save: Save; remove: Save }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="card flex flex-col gap-3 p-5">
      <div>
        <div className="font-semibold">Palavras-chave</div>
        <p className="text-sm text-muted">
          A pessoa manda só a palavra no direct (ex.: PREÇO) e recebe a resposta pronta da loja, sem IA.{commentsOn ? " Nos comentários, a palavra dispara a resposta privada no direct (para quem não segue a conta, ela cai em Solicitações) e, se quiser, uma resposta pública." : ""} Para começar um roteiro pela palavra, cadastre a palavra no próprio roteiro (aba Roteiros).
        </p>
      </div>
      {keywords.length > 0 && (
        <ul className="flex flex-col divide-y divide-line-2 rounded-xl border border-line">
          {keywords.map((k) => (
            <li key={k.id} className="px-3 py-2.5 text-sm">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center gap-1.5">
                  {k.words.map((w) => (
                    <span key={w} className="rounded-full bg-ground px-2 py-0.5 text-xs font-semibold">{w}</span>
                  ))}
                  {!k.active && <span className="text-xs text-muted">desligada</span>}
                  <span className="ml-auto text-xs text-muted">{[k.dm_reply && "direct", (k.comment_reply || k.comment_public) && "comentários"].filter(Boolean).join(" e ")}</span>
                </summary>
                <ActionForm action={save} className="mt-3 flex flex-col gap-2">
                  <KeywordFields k={k} commentsOn={commentsOn} posts={posts} />
                  <div className="flex flex-wrap items-center gap-3">
                    <SubmitButton pendingLabel="Salvando…" className="btn-ghost">Salvar</SubmitButton>
                  </div>
                </ActionForm>
                <ActionForm action={remove} success="Palavra-chave removida." className="mt-2">
                  <input type="hidden" name="id" value={k.id} />
                  <SubmitButton pendingLabel="Removendo…" className="flex items-center gap-1 text-xs font-medium text-danger hover:underline">
                    <Trash2 size={13} />
                    Remover
                  </SubmitButton>
                </ActionForm>
              </details>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <ActionForm action={save} onSuccess={() => setAdding(false)} className="flex flex-col gap-2 rounded-xl bg-ground p-3">
          <KeywordFields k={null} commentsOn={commentsOn} posts={posts} />
          <div className="flex items-center gap-3">
            <SubmitButton pendingLabel="Salvando…" className="btn-ghost">Criar palavra-chave</SubmitButton>
            <button type="button" onClick={() => setAdding(false)} className="text-sm text-muted">Cancelar</button>
          </div>
        </ActionForm>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="btn-ghost self-start">Nova palavra-chave</button>
      )}
    </div>
  );
}

/** IA nos comentários (parte 4b): desligada, em todos os posts ou nos escolhidos. */
export function CommentsAiForm({ mode, mediaIds, posts, withAi, save }: { mode: string; mediaIds: string[] | null; posts: PostChoice[]; withAi: boolean; save: Save }) {
  const [choice, setChoice] = useState(mode);
  return (
    <ActionForm action={save} className="flex flex-col gap-2 rounded-xl bg-ground p-3">
      <div className="text-sm font-semibold">IA nos comentários sem palavra-chave</div>
      <p className="text-xs text-muted">A IA responde em público as perguntas que a base responde, agradece os elogios e manda a resposta privada no direct quando a pessoa quer comprar ou falar com alguém. Ofensa e spam ficam sem resposta, e item proibido ou 18+ nunca é citado. Cada resposta da IA conta como uma resposta do atendimento.</p>
      {!withAi && <p className="text-xs text-amber-ink">Vale para chatbot com IA (tamanho P, M, G ou Volume).</p>}
      <fieldset className="flex flex-col gap-1.5 text-sm" disabled={!withAi}>
        <legend className="sr-only">Onde a IA responde</legend>
        {[
          ["off", "desligada"],
          ["todos", "em todos os posts"],
          ["escolhidos", "nos posts escolhidos"],
        ].map(([v, label]) => (
          <label key={v} className="flex items-center gap-2">
            <input type="radio" name="mode" value={v} checked={choice === v} onChange={() => setChoice(v)} disabled={v === "escolhidos" && !posts.length} /> {label}
            {v === "escolhidos" && !posts.length && <span className="text-xs text-muted">(leia os posts na aba Base de conhecimento)</span>}
          </label>
        ))}
        {choice === "escolhidos" && (
          <div className="ml-6 flex max-h-48 flex-col gap-1 overflow-y-auto rounded-lg border border-line bg-panel p-2">
            {posts.map((p) => (
              <label key={p.media_id} className="flex items-start gap-2 text-xs">
                <input type="checkbox" name="media_ids" value={p.media_id} defaultChecked={mediaIds?.includes(p.media_id)} className="mt-0.5" />
                <span className="min-w-0">
                  <span className="text-muted">{new Date(p.posted_at).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })} · </span>
                  {p.caption?.trim().slice(0, 90) || "(sem legenda)"}
                </span>
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <SubmitButton pendingLabel="Salvando…" className="btn-ghost self-start" disabled={!withAi}>
        Salvar
      </SubmitButton>
    </ActionForm>
  );
}
