"use client";

import { useState } from "react";
import { Link2, Plus, Tags, Trash2 } from "lucide-react";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { CopyButton } from "@/components/copy-button";
import type { ActionResult } from "@/lib/action-result";
import { ICE_BREAKERS_MAX, ICE_BREAKER_MAX, PUBLIC_REPLY_MAX, REF_LABEL_MAX, REF_NOTE_MAX, REPLY_MAX, igMeLink, refFromLabel } from "@/lib/instagram-links";
import { relativeTime } from "@/lib/utils";
import { TagsField } from "@/components/tags-field";
import { MultiSelect } from "@/components/ui/multi-select";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { StatusPill } from "@/components/ui/form-section";
import { DialogButton, SettingRow, SwitchField } from "@/components/ui/setting-row";

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

/**
 * Os campos de uma palavra-chave (nova ou existente). Com os comentários, o direct e os comentários
 * ficam em blocos separados: as duas respostas chegam no direct da pessoa, e no teste de 20/10 a
 * mensagem para quem comentou foi parar na resposta do direct. Rodada 2 das telas (23/10/2026, a
 * pedido do usuário): as palavras em etiquetas, onde vale em cartões, os posts num seletor com busca
 * e "ligada" numa chave.
 */
function KeywordFields({ k, commentsOn, posts }: { k: KeywordItem | null; commentsOn: boolean; posts: PostChoice[] }) {
  const [scope, setScope] = useState(k?.media_ids ? "escolhidos" : "todos");
  const prefix = k ? k.id : "novo";
  const dmField = (label: string) => (
    <div>
      <label htmlFor={`kw-dm-${prefix}`} className="label">{label}</label>
      <textarea id={`kw-dm-${prefix}`} name="dm_reply" rows={3} maxLength={REPLY_MAX} defaultValue={k?.dm_reply ?? ""} placeholder="Oi! A tabela de preços está aqui: …" className="input" />
    </div>
  );
  const postDate = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  return (
    <>
      {k && <input type="hidden" name="id" value={k.id} />}
      <div className="flex flex-col gap-1.5">
        <span className="label">Palavras</span>
        <TagsField name="words" initial={k?.words ?? []} placeholder="preço, eu quero…" empty="Nenhuma palavra ainda: escreva e toque em Adicionar." idPrefix={`kw-words-${prefix}`} />
      </div>
      {!commentsOn && dmField("Resposta pronta no direct (quando a pessoa manda só a palavra)")}
      {commentsOn && (
        <>
          <fieldset className="flex flex-col gap-2 rounded-[14px] border border-line p-3">
            <legend className="px-1 text-sm font-semibold">Quando a pessoa manda a palavra no direct</legend>
            {dmField("Resposta pronta (quando a mensagem é só a palavra; vazio, não responde no direct)")}
          </fieldset>
          <fieldset className="flex flex-col gap-3 rounded-[14px] border border-line p-3">
            <legend className="px-1 text-sm font-semibold">Quando a pessoa comenta a palavra num post</legend>
            <div>
              <label htmlFor={`kw-cr-${prefix}`} className="label">Mensagem no direct de quem comentou (uma por comentário, até 7 dias depois dele)</label>
              <textarea id={`kw-cr-${prefix}`} name="comment_reply" rows={3} maxLength={REPLY_MAX} defaultValue={k?.comment_reply ?? ""} placeholder="Oi! Te mandei os detalhes por aqui 😊" className="input" />
            </div>
            <div>
              <label htmlFor={`kw-cp-${prefix}`} className="label">Resposta pública no comentário (opcional, curta)</label>
              <input id={`kw-cp-${prefix}`} name="comment_public" maxLength={PUBLIC_REPLY_MAX} defaultValue={k?.comment_public ?? ""} placeholder="Te chamei no direct!" className="input" />
              <p className="mt-1 text-xs text-muted">Se ela diz que chamou a pessoa no direct, escreva também a mensagem acima.</p>
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className="label">Nos comentários de</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  ["todos", "Todos os posts", "Vale em qualquer post, inclusive os novos."],
                  ["escolhidos", "Posts escolhidos", posts.length ? "Só nos posts que você marcar." : "Leia os posts na aba Base de conhecimento para escolher."],
                ].map(([v, title, hint]) => (
                  <label key={v} className={`flex cursor-pointer items-start gap-2.5 rounded-[12px] border border-line p-3 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft/60 ${v === "escolhidos" && !posts.length ? "pointer-events-none opacity-60" : ""}`}>
                    <input type="radio" name="posts" value={v} checked={scope === v} onChange={() => setScope(v)} disabled={v === "escolhidos" && !posts.length} className="mt-0.5 accent-brand" />
                    <span>
                      <span className="block font-medium text-ink">{title}</span>
                      <span className="block text-xs text-muted">{hint}</span>
                    </span>
                  </label>
                ))}
              </div>
              {scope === "escolhidos" && posts.length > 0 && (
                <MultiSelect
                  name="media_ids"
                  label="Posts"
                  options={posts.map((p) => ({ value: p.media_id, label: `${postDate(p.posted_at)} · ${p.caption?.trim().slice(0, 70) || "(sem legenda)"}` }))}
                  defaultValue={k?.media_ids ?? []}
                  placeholder="Escolha os posts"
                />
              )}
            </fieldset>
          </fieldset>
        </>
      )}
      {k && (
        <>
          <input type="hidden" name="has_active" value="1" />
          <SwitchField name="active" defaultChecked={k.active} label="Ligada" hint="Desligada, a palavra fica guardada mas não responde." />
        </>
      )}
    </>
  );
}

const KEYWORDS_HELP = "A pessoa manda só a palavra no direct (ex.: PREÇO) e recebe a resposta pronta da loja, sem IA. Para começar um roteiro pela palavra, cadastre a palavra no próprio roteiro (aba Roteiros).";
const KEYWORDS_HELP_COMMENTS = "A pessoa manda só a palavra no direct (ex.: PREÇO) e recebe a resposta pronta da loja, sem IA. Nos comentários, a palavra manda uma mensagem no direct de quem comentou (para quem não segue a conta, ela cai em Solicitações) e, se quiser, uma resposta pública no post. Para começar um roteiro pela palavra, cadastre a palavra no próprio roteiro (aba Roteiros).";

/** O resumo da linha: onde a palavra responde. Pura. */
function keywordSummary(k: KeywordItem): string {
  const parts = [
    k.dm_reply ? `Direct: ${k.dm_reply}` : null,
    k.comment_reply || k.comment_public ? `Comentários${k.media_ids ? ` em ${k.media_ids.length} ${k.media_ids.length === 1 ? "post" : "posts"}` : " em todos os posts"}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Sem resposta pronta";
}

/**
 * As palavras-chave na aba Instagram (rodada 2 das telas, 23/10/2026, a pedido do usuário:
 * "melhorar a edição e o cadastro"): um grupo com uma linha por palavra, que abre o modal de editar
 * (com o Apagar no rodapé), e o "Nova palavra-chave" no alto, no lugar dos detalhes abertos na lista.
 */
export function KeywordsGroup({ keywords, commentsOn, posts, save, remove }: { keywords: KeywordItem[]; commentsOn: boolean; posts: PostChoice[]; save: Save; remove: Save }) {
  const help = commentsOn ? KEYWORDS_HELP_COMMENTS : KEYWORDS_HELP;
  const removeOne = (id: string) => () => {
    const fd = new FormData();
    fd.set("id", id);
    return remove(fd);
  };
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h3 className="kpi-label">Palavras-chave</h3>
        <DialogButton label="Nova palavra-chave" icon={<Plus size={14} />} className="btn-ghost py-1.5 text-[13px]" title="Nova palavra-chave" description={help} action={save} saveLabel="Criar palavra-chave" size="lg">
          <KeywordFields k={null} commentsOn={commentsOn} posts={posts} />
        </DialogButton>
      </div>
      <div className="card flex flex-col divide-y divide-line-2 overflow-hidden">
        {keywords.length === 0 && <p className="px-4 py-5 text-sm text-muted">Nenhuma palavra-chave ainda. {help}</p>}
        {keywords.map((k) => (
          <SettingRow
            key={k.id}
            icon={<Tags size={18} />}
            title={k.words.join(", ")}
            badge={k.active ? undefined : <StatusPill>desligada</StatusPill>}
            summary={keywordSummary(k)}
            summaryTone={k.active ? "muted" : "warn"}
            dialogTitle="Palavra-chave"
            description={help}
            action={save}
            size="lg"
            footerStart={
              <ConfirmAction action={removeOne(k.id)} title="Apagar esta palavra-chave?" description={`"${k.words.join(", ")}" deixa de responder no direct e nos comentários.`} confirmLabel="Apagar" className="btn-ghost text-danger">
                <Trash2 size={14} />
                Apagar
              </ConfirmAction>
            }
          >
            <KeywordFields k={k} commentsOn={commentsOn} posts={posts} />
          </SettingRow>
        ))}
      </div>
    </section>
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
