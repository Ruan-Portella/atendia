"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { ActionResult } from "@/lib/action-result";
import { fieldError } from "@/lib/field-errors";
import { ConfirmModal } from "./modal";
import { useToast } from "./toast";

/** Pergunta "tem certeza?" antes de enviar, no próprio sistema (nunca a janela do navegador). */
export interface ConfirmAsk {
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}

interface Props {
  /** Server action já com os argumentos fixos aplicados (ex.: `updateBot.bind(null, id)`). */
  action: (formData: FormData) => Promise<ActionResult | void>;
  /** Mensagem do toast quando a action devolve ok sem mensagem própria. */
  success?: string;
  /** Chamado depois de um ok (ex.: fechar o modal). */
  onSuccess?: () => void;
  /** Antes de enviar; preventDefault() segura o envio. */
  onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void;
  /** Confirmação antes de enviar (recebe o botão que enviou); null deixa seguir direto. */
  confirm?: (submitter: HTMLButtonElement | null) => ConfirmAsk | null;
  className?: string;
  children: React.ReactNode;
}

function isNextControlError(err: unknown) {
  const digest = (err as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK") || digest === "NEXT_NOT_FOUND");
}

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
const ERROR_ATTR = "data-bv-erro";

function isField(el: EventTarget | null): el is Field {
  return el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement;
}

/** Onde o erro entra: depois do campo, ou depois do rótulo que o envolve (caixas de marcar). */
function anchorOf(el: Field): Element {
  const label = el.closest("label");
  return label && label.contains(el) && (el.type === "checkbox" || el.type === "radio") ? label : el;
}

function errorNodeOf(el: Field): HTMLElement | null {
  const next = anchorOf(el).nextElementSibling;
  return next instanceof HTMLElement && next.getAttribute(ERROR_ATTR) === el.name + "|" + el.id ? next : null;
}

/** Num grupo de opções (radio), o erro é um só, depois da última opção. */
function leaderOf(el: Field): Field {
  if (!(el instanceof HTMLInputElement) || el.type !== "radio" || !el.form || !el.name) return el;
  const group = Array.from(el.form.elements).filter((x): x is HTMLInputElement => x instanceof HTMLInputElement && x.type === "radio" && x.name === el.name);
  return group[group.length - 1] ?? el;
}

/** Mostra (ou tira) o erro embaixo do campo, ligado pelo aria-describedby. Devolve se está válido. */
function showError(field: Field) {
  const el = leaderOf(field);
  const message = el.willValidate ? fieldError(el) : null;
  const existing = errorNodeOf(el);
  if (!message) {
    if (existing) {
      el.removeAttribute("aria-invalid");
      const ids = (el.getAttribute("aria-describedby") ?? "").split(" ").filter((x) => x && x !== existing.id);
      if (ids.length) el.setAttribute("aria-describedby", ids.join(" "));
      else el.removeAttribute("aria-describedby");
      existing.remove();
    }
    return true;
  }
  el.setAttribute("aria-invalid", "true");
  const node = existing ?? document.createElement("p");
  if (!existing) {
    node.setAttribute(ERROR_ATTR, el.name + "|" + el.id);
    node.id = `erro-${Math.random().toString(36).slice(2, 9)}`;
    node.setAttribute("role", "alert");
    node.className = "rise-in mt-1.5 flex items-start gap-1.5 text-[12.5px] leading-snug text-danger";
    anchorOf(el).after(node);
    el.setAttribute("aria-describedby", [el.getAttribute("aria-describedby"), node.id].filter(Boolean).join(" "));
  }
  node.textContent = message;
  return false;
}

/**
 * <form> que chama a server action e mostra um toast de sucesso ou erro.
 * Os campos continuam sendo HTML puro; só o feedback muda. Nunca deixa um erro da action
 * derrubar a página: vira toast.
 * Validação (redesenho, etapa 1): as regras são as do próprio campo (required, type, min,
 * pattern…); o erro aparece embaixo dele, ao enviar e depois ao sair do campo, e some ao corrigir.
 */
export function ActionForm({ action, success = "Salvo.", onSuccess, onSubmit, confirm, className, children }: Props) {
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const confirmed = useRef(false);
  const [ask, setAsk] = useState<{ q: ConfirmAsk; submitter: HTMLButtonElement | null } | null>(null);
  const [, formAction] = useActionState(async (_prev: ActionResult | null, fd: FormData) => {
    let r: ActionResult | void;
    try {
      r = await action(fd);
    } catch (err) {
      // redirect() da action chega aqui como erro de controle do Next: deixa seguir.
      if (isNextControlError(err)) throw err;
      toast.error("Não foi possível concluir agora. Verifique a conexão e tente de novo.");
      return null;
    }
    if (!r) return null; // a action redirecionou
    if (r.ok) {
      toast.success(r.message ?? success);
      onSuccess?.();
    } else toast.error(r.message);
    return r;
  }, null);

  // depois de mexer no campo: confere ao sair dele; com erro na tela, confere a cada tecla
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const touched = new WeakSet<Field>();
    const onInput = (e: Event) => {
      if (!isField(e.target)) return;
      touched.add(e.target);
      if (errorNodeOf(leaderOf(e.target))) showError(e.target);
    };
    const onBlur = (e: Event) => {
      if (isField(e.target) && touched.has(e.target)) showError(e.target);
    };
    form.addEventListener("input", onInput);
    form.addEventListener("change", onInput);
    form.addEventListener("focusout", onBlur);
    return () => {
      form.removeEventListener("input", onInput);
      form.removeEventListener("change", onInput);
      form.removeEventListener("focusout", onBlur);
    };
  }, []);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    const form = e.currentTarget;
    const submitter = ((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null) ?? null;
    // "formnovalidate" no botão (ex.: Cancelar) pula a validação, como no navegador
    if (!submitter?.formNoValidate) {
      const fields = Array.from(form.elements).filter(isField).filter((f) => leaderOf(f) === f);
      const valid = fields.map(showError);
      const firstBad = fields[valid.indexOf(false)];
      if (firstBad) {
        e.preventDefault();
        firstBad.focus();
        return;
      }
    }
    if (confirm && !confirmed.current) {
      const q = confirm(submitter);
      if (q) {
        e.preventDefault();
        setAsk({ q, submitter });
        return;
      }
    }
    confirmed.current = false;
    onSubmit?.(e);
  }

  return (
    <>
      <form ref={formRef} action={formAction} onSubmit={handleSubmit} noValidate className={className}>
        {children}
      </form>
      {confirm && (
        <ConfirmModal
          open={Boolean(ask)}
          onClose={() => setAsk(null)}
          onConfirm={() => {
            const pending = ask;
            setAsk(null);
            confirmed.current = true;
            formRef.current?.requestSubmit(pending?.submitter ?? undefined);
          }}
          title={ask?.q.title ?? ""}
          description={ask?.q.description}
          confirmLabel={ask?.q.confirmLabel}
          danger={ask?.q.danger}
        />
      )}
    </>
  );
}
