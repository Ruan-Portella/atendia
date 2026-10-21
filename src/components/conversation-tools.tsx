"use client";

import { useState } from "react";
import { ArrowRightLeft, Clock, StickyNote } from "lucide-react";
import type { ActionResult } from "@/lib/action-result";
import type { TransferOptions } from "@/lib/transfer";
import { NOTE_MAX } from "@/lib/note-text";
import { SNOOZE_CHOICES } from "@/lib/snooze";
import { cn } from "@/lib/utils";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";

type Panel = "transferir" | "nota" | "adiar" | null;

const until = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/**
 * Transferir, nota interna e adiar (Caixa de entrada, parte 4), embaixo da resposta. Nota interna:
 * quem vê a conversa. Transferir: o atendimento aberto, se ninguém mais está com ele. Adiar: só
 * quem está com a conversa.
 */
export function ConversationTools({
  canTransfer,
  canSnooze,
  snoozedUntil,
  options,
  onTransfer,
  onNote,
  onSnooze,
  onUnsnooze,
}: {
  canTransfer: boolean;
  canSnooze: boolean;
  snoozedUntil: string | null;
  options: TransferOptions;
  onTransfer: (fd: FormData) => Promise<ActionResult>;
  onNote: (fd: FormData) => Promise<ActionResult>;
  onSnooze: (fd: FormData) => Promise<ActionResult>;
  onUnsnooze: () => Promise<ActionResult>;
}) {
  const [open, setOpen] = useState<Panel>(null);
  const [choice, setChoice] = useState<string>("1h");
  const toggle = (p: Panel) => setOpen((o) => (o === p ? null : p));
  const tab = (p: Exclude<Panel, null>, label: string, Icon: typeof Clock) => (
    <button type="button" onClick={() => toggle(p)} aria-expanded={open === p} className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold", open === p ? "border-brand bg-brand-soft text-brand" : "border-line text-muted hover:text-ink")}>
      <Icon size={13} aria-hidden />
      {label}
    </button>
  );
  const noTargets = options.sectors.length === 0 && options.people.length === 0;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {canTransfer && tab("transferir", "Transferir", ArrowRightLeft)}
        {tab("nota", "Nota interna", StickyNote)}
        {canSnooze && !snoozedUntil && tab("adiar", "Adiar", Clock)}
        {snoozedUntil && (
          <span className="inline-flex items-center gap-2 text-xs text-muted">
            <Clock size={13} aria-hidden />
            Adiada até {until(snoozedUntil)}
            {canSnooze && (
              <ActionForm action={onUnsnooze}>
                <SubmitButton pendingLabel="Voltando…" className="font-semibold text-brand hover:underline">Tirar do adiamento</SubmitButton>
              </ActionForm>
            )}
          </span>
        )}
      </div>

      {open === "transferir" && canTransfer && (
        <ActionForm action={onTransfer} className="flex flex-col gap-2 rounded-lg border border-line bg-panel p-3" onSuccess={() => setOpen(null)}>
          {noTargets ? (
            <p className="text-sm text-muted">Não há para quem transferir: crie setores ou convide pessoas para atender este cliente.</p>
          ) : (
            <>
              <label className="flex flex-col gap-1 text-sm">
                <span className="label">Para</span>
                <select name="para" required defaultValue="" className="input">
                  <option value="" disabled>Escolha um setor ou uma pessoa</option>
                  {options.sectors.length > 0 && (
                    <optgroup label="Setores">
                      {options.sectors.map((s) => <option key={s.id} value={`setor:${s.id}`}>{s.name}</option>)}
                    </optgroup>
                  )}
                  {options.people.length > 0 && (
                    <optgroup label="Pessoas">
                      {options.people.map((p) => <option key={`${p.type}:${p.id}`} value={`${p.type}:${p.id}`}>{p.name}{p.type === "client_member" ? " (área do cliente)" : ""}</option>)}
                    </optgroup>
                  )}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="label">Nota interna (opcional, só a equipe vê)</span>
                <textarea name="nota" rows={2} maxLength={NOTE_MAX} className="input" placeholder="O que já foi feito e o que falta" />
              </label>
              <p className="text-xs text-muted">O contato não recebe nada agora: a primeira mensagem de quem receber sai com o aviso de que o atendimento passou para essa pessoa.</p>
              <SubmitButton className="btn-dark w-fit py-1.5" pendingLabel="Transferindo…">Transferir</SubmitButton>
            </>
          )}
        </ActionForm>
      )}

      {open === "nota" && (
        <ActionForm action={onNote} className="flex flex-col gap-2 rounded-lg border border-dashed border-line bg-panel p-3" onSuccess={() => setOpen(null)}>
          <label className="flex flex-col gap-1 text-sm">
            <span className="label">Nota interna (só a equipe vê; não vai para o contato nem para a IA)</span>
            <textarea name="nota" required rows={2} maxLength={NOTE_MAX} className="input" />
          </label>
          <SubmitButton className="btn-ghost w-fit py-1.5" pendingLabel="Gravando…">Gravar nota</SubmitButton>
        </ActionForm>
      )}

      {open === "adiar" && canSnooze && (
        <ActionForm action={onSnooze} className="flex flex-col gap-2 rounded-lg border border-line bg-panel p-3" onSuccess={() => setOpen(null)}>
          <fieldset className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <legend className="label mb-1">Adiar até</legend>
            {SNOOZE_CHOICES.map((c) => (
              <label key={c.value} className="flex items-center gap-1.5">
                <input type="radio" name="ate" value={c.value} checked={choice === c.value} onChange={() => setChoice(c.value)} />
                {c.label}
              </label>
            ))}
          </fieldset>
          {choice === "data" && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="label">Data e hora (Brasília)</span>
              <input type="datetime-local" name="data" required className="input w-fit" />
            </label>
          )}
          <p className="text-xs text-muted">A conversa sai das filas e fica em Adiadas. Volta na data, ou antes, se o contato escrever. O assistente continua pausado.</p>
          <SubmitButton className="btn-dark w-fit py-1.5" pendingLabel="Adiando…">Adiar</SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}
