"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ChevronRight, X } from "lucide-react";
import type { ActionResult } from "@/lib/action-result";
import { ActionForm, type ConfirmAsk } from "./action-form";
import { ConfirmModal } from "./modal";
import { SubmitButton } from "./submit-button";
import { useToast } from "./toast";
import { cn } from "@/lib/utils";

/*
 * Ajustes em linhas que abrem um modal (redesenho, etapa 5, a pedido do usuário em 22/10): a linha
 * mostra o resumo do que está configurado; o modal tem os campos e o Salvar. Os editores longos
 * (roteiro, ação) abrem num painel lateral (size "sheet").
 */

type Size = "sm" | "md" | "lg" | "sheet";

/**
 * O modal de editar: título, campos e o rodapé fixo com Cancelar e Salvar. Com `action`, o modal
 * tem o próprio formulário; sem, os campos são do formulário em volta (o Salvar envia aquele).
 * Fechar sem salvar desfaz o que foi mexido (os campos voltam ao valor salvo); com algo mexido,
 * pergunta antes ("Descartar as alterações?"). Um formulário de dentro que salva (ActionForm,
 * evento "bv-saved") fecha o modal. Para mais de um modal na mesma
 * linha (editar e testar), cada um fica fora do formulário do outro.
 */
export function EditDialog({
  open,
  onClose,
  onOpen,
  title,
  description,
  action,
  size = "md",
  saveLabel = "Salvar",
  pendingLabel = "Salvando…",
  footerStart,
  footer = "save",
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** para o modal abrir sozinho quando um campo dele tem erro */
  onOpen?: () => void;
  title: string;
  description?: React.ReactNode;
  action?: (formData: FormData) => Promise<ActionResult | void>;
  size?: Size;
  saveLabel?: string;
  pendingLabel?: string;
  /** à esquerda do rodapé (ex.: Apagar) */
  footerStart?: React.ReactNode;
  /** "save": Cancelar e Salvar; "close": só Fechar (para ler, ou quando os formulários de dentro têm o próprio botão) */
  footer?: "save" | "close";
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [gen, setGen] = useState(0);
  // os valores dos campos ao abrir: fechar com algo diferente pergunta antes de descartar
  const snapshot = useRef<string | null>(null);
  const [asking, setAsking] = useState(false);
  const close = () => {
    snapshot.current = null;
    onClose();
    setGen((g) => g + 1);
  };
  const tryClose = () => {
    const d = ref.current;
    if (footer === "save" && d && snapshot.current !== null && fieldsOf(d) !== snapshot.current) setAsking(true);
    else close();
  };
  const closeRef = useRef(close);
  const openRef = useRef(onOpen);
  useEffect(() => {
    closeRef.current = close;
    openRef.current = onOpen;
  });

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // depois de os campos montarem (e acertarem os valores calculados)
      requestAnimationFrame(() => {
        snapshot.current = fieldsOf(d);
      });
    } else if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const saved = () => closeRef.current();
    d.addEventListener("bv-saved", saved);
    return () => d.removeEventListener("bv-saved", saved);
  }, []);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    // um campo com erro aqui dentro, no Salvar do formulário em volta (ui/form-errors)
    const reopen = () => openRef.current?.();
    d.addEventListener("bv-open", reopen);
    return () => d.removeEventListener("bv-open", reopen);
  }, []);

  const inner = (
    <>
      <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-line-2 bg-panel px-5 py-4 sm:px-6">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-medium leading-tight">{title}</h2>
          {description && <p className="mt-1 text-sm leading-relaxed text-muted">{description}</p>}
        </div>
        <button type="button" onClick={tryClose} aria-label="Fechar" className="btn-icon -mr-2 -mt-1">
          <X size={16} />
        </button>
      </div>
      <div key={gen} className="flex flex-1 flex-col gap-4 px-5 py-5 sm:px-6">
        {/* com o próprio formulário, os campos só existem com o modal aberto (sempre com o valor salvo de agora);
            sem, ficam montados porque o formulário em volta envia todos */}
        {(!action || open) && children}
      </div>
      <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 border-t border-line-2 bg-panel px-5 py-3 sm:px-6">
        <div className="mr-auto">{footerStart}</div>
        {footer === "close" ? (
          <button type="button" onClick={close} className="btn-ghost">
            Fechar
          </button>
        ) : (
          <>
            <button type="button" onClick={tryClose} className="btn-ghost">
              Cancelar
            </button>
            <SubmitButton className="btn-primary px-5" pendingLabel={pendingLabel}>
              {saveLabel}
            </SubmitButton>
          </>
        )}
      </div>
    </>
  );

  return (
    <dialog
      ref={ref}
      data-edit-dialog
      onCancel={(e) => {
        // Esc: fecha e desfaz o que não foi salvo (com algo mexido, pergunta antes)
        e.preventDefault();
        tryClose();
      }}
      className={cn("modal", size === "sheet" ? "sheet" : size === "lg" ? "max-w-2xl" : size === "sm" ? "max-w-sm" : "max-w-lg")}
    >
      {action ? (
        <ActionForm action={action} className="flex min-h-full flex-col">
          {inner}
        </ActionForm>
      ) : (
        <div className="flex min-h-full flex-col">{inner}</div>
      )}
      <ConfirmModal
        open={asking}
        onClose={() => setAsking(false)}
        onConfirm={() => {
          setAsking(false);
          close();
        }}
        title="Descartar as alterações?"
        description="O que você mexeu aqui ainda não foi salvo."
        confirmLabel="Descartar"
        cancelLabel="Continuar editando"
        danger
      />
    </dialog>
  );
}

/** Os valores dos campos deste modal (sem os de um modal de dentro), para saber se algo mudou. */
function fieldsOf(d: HTMLDialogElement): string {
  return Array.from(d.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea"))
    .filter((el) => el.closest("dialog") === d && (el.name || el.id))
    .map((el) => `${el.name || el.id}=${el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio") ? String(el.checked) : el.value}`)
    .join("\n");
}

/** Um grupo de linhas de ajuste, num cartão só, com um título opcional em cima. */
export function SettingGroup({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      {title && <h3 className="kpi-label px-1">{title}</h3>}
      <div className="card flex flex-col divide-y divide-line-2 overflow-hidden">{children}</div>
    </section>
  );
}

/**
 * Uma linha de ajuste: o ícone, o título e o resumo; à direita, uma chave (`trailing`) e a seta
 * que abre o modal com os campos (`children`). Sem `children`, a linha só mostra (e a chave age).
 */
export function SettingRow({
  icon,
  title,
  badge,
  summary,
  summaryTone,
  trailing,
  children,
  dialogTitle,
  description,
  action,
  size,
  saveLabel,
  footer,
  footerStart,
  mono = false,
}: {
  icon?: React.ReactNode;
  title: string;
  /** ao lado do título (ex.: a pílula de situação) */
  badge?: React.ReactNode;
  /** para nomes técnicos (o nome da ação) */
  mono?: boolean;
  summary?: React.ReactNode;
  summaryTone?: "muted" | "ok" | "warn";
  trailing?: React.ReactNode;
  children?: React.ReactNode;
  dialogTitle?: string;
  description?: React.ReactNode;
  action?: (formData: FormData) => Promise<ActionResult | void>;
  size?: Size;
  saveLabel?: string;
  footer?: "save" | "close";
  footerStart?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const head = (
    <>
      {icon && <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-raised text-ink-2">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn("text-[15px] font-medium text-ink", mono && "font-mono text-sm")}>{title}</span>
          {badge}
        </span>
        {summary && <span className={cn("mt-0.5 block text-[12.5px] leading-snug", summaryTone === "ok" ? "text-brand" : summaryTone === "warn" ? "text-amber-ink" : "text-muted")}>{summary}</span>}
      </span>
    </>
  );
  return (
    <div className={cn("group/set flex items-center gap-3 px-4 py-3.5 transition-colors duration-[120ms]", Boolean(children) && "hover:bg-raised/40")}>
      {children ? (
        <button type="button" onClick={() => setOpen(true)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          {head}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3">{head}</div>
      )}
      {trailing}
      {children && (
        <>
          <button type="button" onClick={() => setOpen(true)} aria-label={`Abrir ${title}`} className="btn-icon shrink-0">
            <ChevronRight size={16} className="transition-transform duration-[120ms] group-hover/set:translate-x-0.5" />
          </button>
          <EditDialog open={open} onClose={() => setOpen(false)} onOpen={() => setOpen(true)} title={dialogTitle ?? title} description={description} action={action} size={size} saveLabel={saveLabel} footer={footer} footerStart={footerStart}>
            {children}
          </EditDialog>
        </>
      )}
    </div>
  );
}

/** Um botão que abre o modal de editar (ex.: Novo roteiro, Testar). */
export function DialogButton({
  label,
  icon,
  className = "btn-ghost",
  children,
  ...dialog
}: {
  label: string;
  icon?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: (formData: FormData) => Promise<ActionResult | void>;
  size?: Size;
  saveLabel?: string;
  footer?: "save" | "close";
  footerStart?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {icon}
        {label}
      </button>
      <EditDialog open={open} onClose={() => setOpen(false)} onOpen={() => setOpen(true)} {...dialog}>
        {children}
      </EditDialog>
    </>
  );
}

/** Um ajuste de ligar e desligar dentro de um formulário: vai no Salvar, como um checkbox. */
export function SwitchField({ name, value, defaultChecked, label, hint, disabled, className }: { name: string; /** o valor enviado ligado (padrão "on") */ value?: string; defaultChecked?: boolean; label: React.ReactNode; hint?: React.ReactNode; disabled?: boolean; className?: string }) {
  return (
    <label className={cn("flex items-start justify-between gap-4 text-sm", disabled && "opacity-70", className)}>
      <span className="min-w-0">
        <span className="block font-medium text-ink">{label}</span>
        {hint && <span className="mt-0.5 block text-xs leading-relaxed text-muted">{hint}</span>}
      </span>
      <input type="checkbox" role="switch" name={name} value={value} defaultChecked={defaultChecked} disabled={disabled} className="switch mt-0.5" />
    </label>
  );
}

/**
 * Chave que salva sozinha ao mudar (sem Salvar): chama a server action com o `name` marcado quando
 * liga. `offAction` serve às actions que recebem o valor já fixado (ex.: set…(id, false)).
 * `confirmOff` pergunta antes de desligar (quando desligar apaga algo).
 */
export function AutoSwitch({
  checked,
  action,
  offAction,
  name = "on",
  fields,
  label,
  confirmOff,
  disabled,
}: {
  checked: boolean;
  action: (formData: FormData) => Promise<ActionResult | void>;
  offAction?: (formData: FormData) => Promise<ActionResult | void>;
  name?: string;
  /** campos fixos que vão junto (ex.: o marcador do formulário que a action espera) */
  fields?: Record<string, string>;
  label: string;
  confirmOff?: ConfirmAsk;
  disabled?: boolean;
}) {
  const toast = useToast();
  const [on, setOn] = useState(checked);
  const [prev, setPrev] = useState(checked);
  const [busy, start] = useTransition();
  const [ask, setAsk] = useState(false);
  // o servidor mudou o valor (outra aba, outra pessoa): a chave segue
  if (prev !== checked) {
    setPrev(checked);
    setOn(checked);
  }

  const run = (next: boolean) =>
    start(async () => {
      setOn(next);
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields ?? {})) fd.set(k, v);
      if (next) fd.set(name, "on");
      try {
        const r = await (!next && offAction ? offAction : action)(fd);
        if (r && !r.ok) {
          setOn(!next);
          toast.error(r.message);
        } else toast.success(r?.message ?? (next ? "Ligado." : "Desligado."));
      } catch {
        setOn(!next);
        toast.error("Não foi possível concluir agora. Verifique a conexão e tente de novo.");
      }
    });

  return (
    <>
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={on}
        disabled={disabled || busy}
        onChange={(e) => {
          const next = e.target.checked;
          if (!next && confirmOff) setAsk(true);
          else run(next);
        }}
        className="switch"
      />
      {confirmOff && (
        <ConfirmModal
          open={ask}
          onClose={() => setAsk(false)}
          onConfirm={() => {
            setAsk(false);
            run(false);
          }}
          title={confirmOff.title}
          description={confirmOff.description}
          confirmLabel={confirmOff.confirmLabel ?? "Desligar"}
          danger={confirmOff.danger ?? true}
        />
      )}
    </>
  );
}

/** Chave dentro do formulário em volta que salva ao mudar (envia o formulário inteiro). */
export function SubmitSwitch({ name, defaultChecked, label, disabled }: { name: string; defaultChecked?: boolean; label: string; disabled?: boolean }) {
  return <input type="checkbox" role="switch" name={name} aria-label={label} defaultChecked={defaultChecked} disabled={disabled} onChange={(e) => e.currentTarget.form?.requestSubmit()} className="switch" />;
}
