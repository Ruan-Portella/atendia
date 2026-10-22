"use client";

import { useEffect, useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

/** O nome que a pessoa vê em cada variável (no texto salvo, continua {nome}, {volta}…). */
const VAR_LABEL: Record<string, string> = {
  nome: "Nome do assistente",
  empresa: "Nome da empresa",
  volta: "Quando a equipe volta",
  atendente: "Nome de quem atende",
};
const labelOf = (key: string) => VAR_LABEL[key] ?? key;
const DRAG_TYPE = "application/x-boavoz-var";
// marca invisível que deixa o cursor parar antes e depois de uma etiqueta no começo ou no fim
const ZW = "​";
const PILL = "mx-0.5 inline-flex select-none items-center rounded-full bg-brand-soft px-2 py-px align-baseline text-[12.5px] font-medium text-brand";

function pill(key: string): HTMLSpanElement {
  const s = document.createElement("span");
  s.contentEditable = "false";
  s.dataset.var = key;
  s.className = PILL;
  s.textContent = labelOf(key);
  return s;
}

/** O texto como é salvo: as etiquetas voltam a ser {nome}. */
function serialize(root: HTMLElement): string {
  const walk = (n: Node): string => {
    if (n.nodeType === Node.TEXT_NODE) return n.textContent ?? "";
    if (n instanceof HTMLElement) return n.dataset.var ? `{${n.dataset.var}}` : Array.from(n.childNodes).map(walk).join("");
    return "";
  };
  return Array.from(root.childNodes).map(walk).join("").replaceAll(ZW, "").replace(/\s+/g, " ");
}

function build(root: HTMLElement, value: string, keys: string[]) {
  root.replaceChildren();
  for (const part of value.split(/(\{[a-z_]+\})/)) {
    const m = /^\{([a-z_]+)\}$/.exec(part);
    if (m && keys.includes(m[1])) root.append(pill(m[1]));
    else if (part) root.append(document.createTextNode(part));
  }
  if (root.firstChild instanceof HTMLElement) root.prepend(document.createTextNode(ZW));
  if (!root.lastChild || root.lastChild instanceof HTMLElement) root.append(document.createTextNode(ZW));
}

function rangeAt(x: number, y: number): Range | null {
  const d = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null; caretRangeFromPoint?: (x: number, y: number) => Range | null };
  if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(x, y);
    if (!p) return null;
    const r = document.createRange();
    r.setStart(p.offsetNode, p.offset);
    r.collapse(true);
    return r;
  }
  return d.caretRangeFromPoint?.(x, y) ?? null;
}

/**
 * Texto editável com variáveis (redesenho, etapa 5, a pedido do usuário em 22/10): no lugar de
 * escrever {nome}, a pessoa arrasta a etiqueta para o texto ou toca nela para pôr onde está o
 * cursor. A prévia mostra a mensagem como chega ao contato, com os valores de exemplo.
 */
export function TemplateField({
  id,
  label,
  hint,
  defaultValue,
  fallback,
  vars,
  maxLength,
  required = [],
  disabled = false,
}: {
  id: string;
  label: string;
  hint?: string;
  defaultValue: string;
  /** O padrão, usado na prévia quando o campo fica vazio. */
  fallback: string;
  /** As variáveis e o valor de exemplo de cada uma, na prévia. */
  vars: Record<string, string>;
  maxLength: number;
  /** As variáveis que o texto precisa ter (aviso embaixo enquanto faltar). */
  required?: string[];
  /** Travado (o anúncio de um chatbot derivado, quando o modelo não libera). */
  disabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef<Range | null>(null);
  const [value, setValue] = useState(defaultValue);
  const keys = Object.keys(vars);

  useEffect(() => {
    if (ref.current) build(ref.current, defaultValue, Object.keys(vars));
    // monta uma vez (e de novo quando o modal desfaz: o componente é recriado)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sync = () => {
    if (ref.current) setValue(serialize(ref.current));
  };
  const remember = () => {
    const sel = window.getSelection();
    if (sel?.rangeCount && ref.current?.contains(sel.getRangeAt(0).startContainer)) last.current = sel.getRangeAt(0).cloneRange();
  };

  const insert = (key: string, at?: Range | null) => {
    const root = ref.current;
    if (!root || disabled) return;
    if (value.length + key.length + 2 > maxLength) return;
    let range = at && root.contains(at.startContainer) ? at : last.current && root.contains(last.current.startContainer) ? last.current : null;
    if (!range) {
      range = document.createRange();
      range.selectNodeContents(root);
      range.collapse(false);
    }
    range.deleteContents();
    // a etiqueta encostada numa palavra ganha o espaço (o texto salvo não tem a margem da etiqueta)
    const node = range.startContainer;
    const text = node.nodeType === Node.TEXT_NODE ? (node.textContent ?? "").replaceAll(ZW, "") : "";
    const offset = node.nodeType === Node.TEXT_NODE ? (node.textContent ?? "").slice(0, range.startOffset).replaceAll(ZW, "").length : 0;
    const before = text[offset - 1];
    const next = text[offset];
    const after = document.createTextNode(next && !/[\s.,!?;:)]/.test(next) ? " " : ZW);
    range.insertNode(after);
    range.insertNode(pill(key));
    if (before && !/[\s(]/.test(before)) range.insertNode(document.createTextNode(" "));
    const caret = document.createRange();
    caret.setStart(after, 1);
    caret.collapse(true);
    root.focus();
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(caret);
    last.current = caret.cloneRange();
    sync();
  };

  const preview = (value.trim() || fallback).split(/(\{[a-z_]+\})/).map((part, i) => {
    const m = /^\{([a-z_]+)\}$/.exec(part);
    return m && m[1] in vars ? (
      <span key={i} className="font-semibold text-brand">
        {vars[m[1]]}
      </span>
    ) : (
      <span key={i}>{part}</span>
    );
  });
  const missing = required.filter((k) => !value.includes(`{${k}}`));

  return (
    <div className="flex flex-col gap-2">
      <span id={`${id}-label`} className="label mb-0">
        {label}
      </span>
      {!disabled && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted">Arraste para o texto ou toque para pôr no cursor:</span>
          {keys.map((k) => (
            <button
              key={k}
              type="button"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_TYPE, k);
                e.dataTransfer.effectAllowed = "copy";
              }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insert(k)}
              className="inline-flex cursor-grab items-center gap-1 rounded-full border border-brand/40 bg-brand-soft py-0.5 pl-1 pr-2.5 text-[12.5px] font-medium text-brand transition-colors duration-[120ms] hover:border-brand active:cursor-grabbing"
            >
              <GripVertical size={12} className="opacity-60" />
              {labelOf(k)}
              {required.includes(k) && <span className="text-[11px] font-normal opacity-70">· obrigatório</span>}
            </button>
          ))}
        </div>
      )}
      <div
        ref={ref}
        role="textbox"
        aria-labelledby={`${id}-label`}
        aria-describedby={hint ? `${id}-hint` : undefined}
        aria-disabled={disabled || undefined}
        contentEditable={!disabled}
        suppressContentEditableWarning
        spellCheck
        onInput={() => {
          sync();
          remember();
        }}
        onKeyUp={remember}
        onMouseUp={remember}
        onBlur={remember}
        onKeyDown={(e) => {
          // uma linha só: o texto vira o começo de uma mensagem
          if (e.key === "Enter") e.preventDefault();
        }}
        onBeforeInput={(e) => {
          const ev = e.nativeEvent as InputEvent;
          if (ev.inputType.startsWith("insert") && value.length + (ev.data?.length ?? 1) > maxLength) e.preventDefault();
        }}
        onPaste={(e) => {
          e.preventDefault();
          const text = e.clipboardData.getData("text/plain").replace(/\s+/g, " ");
          document.execCommand("insertText", false, text.slice(0, Math.max(0, maxLength - value.length)));
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(DRAG_TYPE)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }
        }}
        onDrop={(e) => {
          const key = e.dataTransfer.getData(DRAG_TYPE);
          if (!key) return;
          e.preventDefault();
          insert(key, rangeAt(e.clientX, e.clientY));
        }}
        className={cn("input min-h-[64px] whitespace-pre-wrap break-words leading-[1.9]", disabled && "pointer-events-none opacity-60")}
      />
      <input type="hidden" name={id} value={value} disabled={disabled} />
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 text-xs">
        <span id={`${id}-hint`} className="text-muted">
          {missing.length > 0 ? <span className="text-amber-ink">Falta pôr: {missing.map(labelOf).join(", ")}. </span> : null}
          {hint}
        </span>
        <span className={cn("tabular shrink-0", value.length > maxLength ? "text-danger" : "text-muted")}>
          {value.length}/{maxLength}
        </span>
      </div>
      <div className="flex flex-col gap-1.5 rounded-[14px] bg-ground/60 p-3">
        <span className="kpi-label">Como chega para o contato</span>
        <div className="max-w-[92%] self-start rounded-2xl rounded-tl-md bg-raised px-3.5 py-2 text-sm leading-relaxed text-ink shadow-[inset_0_0_0_1px_var(--color-line-2)]">{preview}</div>
      </div>
    </div>
  );
}
