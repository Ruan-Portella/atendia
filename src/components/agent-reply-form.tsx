"use client";

import { useEffect, useRef, useState } from "react";
import { Paperclip, X } from "lucide-react";
import type { ActionResult } from "@/lib/action-result";
import { QUOTE_EVENT, type QuoteDetail } from "@/components/message-actions";
import { EmojiPicker } from "@/components/emoji-picker";
import { AGENT_FILE_ACCEPT } from "@/lib/agent-file-rules";
import { fileSizeLabel, prepareAgentFile } from "@/lib/image-shrink";
import { mentionsPayment } from "@/lib/gate/payment";
import { renderQuickReply, type QuickReply } from "@/lib/quick-replies";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";

/**
 * Resposta da equipe na conversa. Numa conversa com bebida ou remédio (paymentCheck), se o texto
 * fala de Pix, boleto ou link de pagamento, pergunta antes de enviar, sem bloquear. As respostas
 * prontas do cliente (Caixa de entrada, parte 4) entram no campo com {nome} e {atendente} trocados,
 * para a pessoa revisar antes de enviar. "Responder" numa mensagem (Conversa mais natural) cita
 * ela na próxima resposta; o botão de emoji insere onde o cursor está. O clipe (ou colar uma foto
 * no campo) manda uma foto ou um PDF de até 4 MB junto, com o texto como legenda; foto maior é
 * reduzida aqui antes de sair. allowFile false: no chamado do site (a resposta vai por e-mail).
 */
export function AgentReplyForm({ action, paymentCheck = false, quickReplies = [], contactName = null, attendantName = "", allowFile = true, onRequestPhone }: { action: (fd: FormData) => Promise<ActionResult>; paymentCheck?: boolean; quickReplies?: QuickReply[]; contactName?: string | null; attendantName?: string; allowFile?: boolean; /** quem conversa pelo nome de usuário (o número não aparece): o botão para a pessoa compartilhar */ onRequestPhone?: () => Promise<ActionResult> }) {
  const [asking, setAsking] = useState(false);
  const confirmed = useRef(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const [quote, setQuote] = useState<QuoteDetail | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<{ name: string; size: number } | null>(null);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);

  // o formulário volta ao estado inicial depois de cada envio (o React limpa os campos): o arquivo sai junto
  useEffect(() => {
    const form = fileInput.current?.form;
    if (!form) return;
    const onReset = () => {
      setPicked(null);
      setFileNote(null);
    };
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, [allowFile]);

  const takeFile = async (f: File | null | undefined) => {
    const input = fileInput.current;
    if (!input) return;
    setFileNote(null);
    if (!f) {
      input.value = "";
      setPicked(null);
      return;
    }
    setPreparing(true);
    const r = await prepareAgentFile(f);
    setPreparing(false);
    if (!r.ok) {
      input.value = "";
      setPicked(null);
      setFileNote(r.message);
      return;
    }
    // foto reduzida (ou colada no campo): o arquivo pronto entra no campo do formulário
    if (r.file !== f || input.files?.[0] !== f) {
      const dt = new DataTransfer();
      dt.items.add(r.file);
      input.files = dt.files;
    }
    setPicked({ name: r.file.name, size: r.file.size });
    if (r.file !== f) setFileNote(`Foto reduzida para ${fileSizeLabel(r.file.size)} para caber no limite de 4 MB.`);
    field.current?.focus();
  };

  useEffect(() => {
    const onQuote = (e: Event) => {
      setQuote((e as CustomEvent<QuoteDetail>).detail);
      field.current?.focus();
    };
    window.addEventListener(QUOTE_EVENT, onQuote);
    return () => window.removeEventListener(QUOTE_EVENT, onQuote);
  }, []);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    // a foto ainda está sendo reduzida: espera
    if (preparing) {
      e.preventDefault();
      return;
    }
    if (!paymentCheck || confirmed.current) {
      confirmed.current = false;
      setAsking(false);
      return;
    }
    if (mentionsPayment(field.current?.value ?? "")) {
      e.preventDefault();
      setAsking(true);
    }
  };

  const insertEmoji = (emoji: string) => {
    const el = field.current;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    el.value = el.value.slice(0, start) + emoji + el.value.slice(end);
    el.focus();
    el.setSelectionRange(start + emoji.length, start + emoji.length);
  };

  const insert = (id: string) => {
    const reply = quickReplies.find((q) => q.id === id);
    const el = field.current;
    if (!reply || !el) return;
    const text = renderQuickReply(reply.body, { contact: contactName, attendant: attendantName });
    el.value = el.value.trim() ? `${el.value.trimEnd()}\n${text}` : text;
    el.focus();
  };

  return (
    <div className="flex flex-col gap-2">
      {onRequestPhone && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span>O número desta pessoa não aparece (ela conversa pelo nome de usuário).</span>
          <ActionForm action={onRequestPhone}>
            <SubmitButton pendingLabel="Pedindo…" className="btn-ghost py-1 text-xs">📞 Pedir o telefone</SubmitButton>
          </ActionForm>
        </div>
      )}
      {asking && (
        <div role="alert" className="rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink">
          <strong>Este pagamento inclui bebida ou remédio?</strong> Se sim, mande o link do site (ou ofereça telefone, retirada ou o chat do site) em vez de Pix ou link de pagamento por aqui.
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="btn-ghost py-1 text-xs" onClick={() => (setAsking(false), field.current?.focus())}>
              Voltar e editar
            </button>
            <button
              type="button"
              className="btn-dark py-1 text-xs"
              onClick={() => {
                confirmed.current = true;
                field.current?.form?.requestSubmit();
              }}
            >
              Não inclui, enviar
            </button>
          </div>
        </div>
      )}
      {quote && (
        <div className="flex items-start gap-2 rounded-lg border-l-2 border-brand bg-panel px-3 py-1.5 text-xs">
          <span className="min-w-0 flex-1">
            <span className="font-semibold text-brand">Respondendo a</span>
            <span className="block truncate text-muted">{quote.snippet}</span>
          </span>
          <button type="button" onClick={() => setQuote(null)} aria-label="Tirar a citação" className="shrink-0 rounded-md p-0.5 text-muted hover:text-ink">
            <X size={14} />
          </button>
        </div>
      )}
      {(picked || fileNote || preparing) && (
        <div className="flex items-start gap-2 rounded-lg border border-line bg-panel px-3 py-1.5 text-xs">
          <span className="min-w-0 flex-1">
            {preparing ? (
              <span className="text-muted">Preparando o arquivo…</span>
            ) : picked ? (
              <span className="block truncate"><span className="font-semibold">📎 {picked.name}</span> <span className="text-muted">· {fileSizeLabel(picked.size)}</span></span>
            ) : null}
            {fileNote && <span className={`block ${picked ? "text-muted" : "font-semibold text-danger"}`}>{fileNote}</span>}
          </span>
          {(picked || fileNote) && (
            <button type="button" onClick={() => void takeFile(null)} aria-label="Tirar o arquivo" className="shrink-0 rounded-md p-0.5 text-muted hover:text-ink">
              <X size={14} />
            </button>
          )}
        </div>
      )}
      {/* redesenho, etapa 2: o campo numa caixa só, com as ferramentas embaixo */}
      <ActionForm action={action} onSubmit={onSubmit} onSuccess={() => setQuote(null)} className="flex flex-col gap-1 rounded-[16px] bg-field p-2 shadow-[inset_0_0_0_1px_var(--color-line-strong)] transition-shadow duration-[120ms] focus-within:shadow-[inset_0_0_0_1px_var(--color-brand),0_0_0_3px_color-mix(in_oklab,var(--color-brand)_20%,transparent)]">
        {quote && <input type="hidden" name="reply_to_id" value={quote.id} />}
        <label htmlFor="agent-msg" className="sr-only">Sua resposta</label>
        <textarea
          ref={field}
          id="agent-msg"
          name="content"
          required={!picked}
          maxLength={2000}
          rows={2}
          className="min-h-[52px] w-full resize-y bg-transparent px-2 py-1.5 text-sm leading-relaxed text-ink placeholder:text-muted focus:outline-none"
          placeholder={picked ? "Legenda (opcional)…" : "Escreva sua resposta para o visitante…"}
          onPaste={(e) => {
            // foto colada no campo vira o anexo
            const f = allowFile ? Array.from(e.clipboardData.files).find((x) => x.type.startsWith("image/")) : undefined;
            if (!f) return;
            e.preventDefault();
            void takeFile(f);
          }}
        />
        <div className="flex flex-wrap items-center gap-1">
          <EmojiPicker onPick={insertEmoji} />
          {allowFile && (
            <label className="btn-icon h-8 w-8 cursor-pointer" title="Anexar foto ou PDF (até 4 MB)">
              <Paperclip size={17} />
              <span className="sr-only">Anexar foto ou PDF</span>
              <input ref={fileInput} type="file" name="file" accept={AGENT_FILE_ACCEPT} className="sr-only" onChange={(e) => void takeFile(e.currentTarget.files?.[0])} />
            </label>
          )}
          {quickReplies.length > 0 && (
            <label className="flex items-center">
              <span className="sr-only">Respostas prontas</span>
              <select value="" onChange={(e) => insert(e.target.value)} className="max-w-[180px] cursor-pointer rounded-[9px] bg-transparent px-2 py-1.5 text-[12.5px] text-muted transition-colors duration-[120ms] hover:bg-raised hover:text-ink focus:outline-none">
                <option value="">Respostas prontas…</option>
                {quickReplies.map((q) => <option key={q.id} value={q.id}>{q.title}</option>)}
              </select>
            </label>
          )}
          <SubmitButton pendingLabel="Enviando…" className="btn-primary ml-auto px-3.5 py-2">Enviar</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}
