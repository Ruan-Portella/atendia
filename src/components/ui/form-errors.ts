import { fieldError } from "@/lib/field-errors";

/*
 * Erro embaixo do campo (redesenho, etapa 1), para qualquer <form> do painel: as regras são as
 * do próprio campo (required, type, min, pattern…); o erro aparece ao enviar e depois ao sair do
 * campo, e some ao corrigir. O form leva noValidate (sem o balão do navegador), os
 * liveValidation nos eventos e chama validateForm no envio. O ActionForm já faz tudo isso.
 */

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
 * Confere o form inteiro no envio: mostra os erros e leva o cursor ao primeiro. "formnovalidate"
 * no botão que enviou (ex.: Cancelar) pula a conferência, como no navegador.
 */
export function validateForm(form: HTMLFormElement, submitter?: HTMLElement | null): boolean {
  if (submitter instanceof HTMLButtonElement && submitter.formNoValidate) return true;
  const fields = Array.from(form.elements).filter(isField).filter((f) => leaderOf(f) === f);
  const valid = fields.map(showError);
  // campo com erro dentro de um <details> fechado: o bloco abre para o erro aparecer
  fields.forEach((f, i) => {
    if (!valid[i]) f.closest("details")?.setAttribute("open", "");
  });
  const firstBad = fields[valid.indexOf(false)];
  // ou dentro de um modal de editar fechado (ui/setting-row): o modal abre
  const dialog = firstBad?.closest("dialog");
  if (dialog && !dialog.open) dialog.dispatchEvent(new Event("bv-open"));
  firstBad?.focus();
  return !firstBad;
}

const touched = new WeakSet<Field>();

/** Nos eventos do form: depois de mexer no campo, confere ao sair dele; com erro na tela, a cada tecla. */
export const liveValidation = {
  onInput: (e: React.FormEvent<HTMLFormElement>) => {
    if (!isField(e.target)) return;
    touched.add(e.target);
    if (errorNodeOf(leaderOf(e.target))) showError(e.target);
  },
  onChange: (e: React.FormEvent<HTMLFormElement>) => {
    if (!isField(e.target)) return;
    touched.add(e.target);
    if (errorNodeOf(leaderOf(e.target))) showError(e.target);
  },
  onBlur: (e: React.FocusEvent<HTMLFormElement>) => {
    if (isField(e.target) && touched.has(e.target)) showError(e.target);
  },
};
