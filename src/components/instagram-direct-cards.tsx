"use client";

import { useState } from "react";
import { Link2, Trash2 } from "lucide-react";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { CopyButton } from "@/components/copy-button";
import type { ActionResult } from "@/lib/action-result";
import { ICE_BREAKERS_MAX, ICE_BREAKER_MAX, REF_LABEL_MAX, REF_NOTE_MAX, igMeLink, refFromLabel } from "@/lib/instagram-links";
import { relativeTime } from "@/lib/utils";

/*
 * O direct do Instagram na aba Instagram (E1, parte 3a): as perguntas prontas (ice breakers) e os
 * links ig.me com origem para a bio, o QR impresso e o anúncio.
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
        <p className="text-sm text-muted">Um link do direct para cada lugar (bio, QR do balcão, anúncio): o painel mostra de onde a pessoa veio e o assistente sabe disso. Para o QR impresso, gere o código com o link no app que preferir.</p>
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
