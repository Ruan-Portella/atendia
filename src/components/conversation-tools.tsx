"use client";

import { useState } from "react";
import { ArrowRightLeft, Clock, StickyNote, Users, UserRound } from "lucide-react";
import type { ActionResult } from "@/lib/action-result";
import type { TransferOptions } from "@/lib/transfer";
import { NOTE_MAX } from "@/lib/note-text";
import { SNOOZE_CHOICES } from "@/lib/snooze";
import { cn } from "@/lib/utils";
import { DialogButton } from "@/components/ui/setting-row";
import { ConfirmAction } from "@/components/ui/confirm-action";

const until = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

const PILL = "inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs font-semibold text-muted transition-colors duration-[120ms] hover:border-line-strong hover:text-ink";

/** Uma escolha em cartão (setor, pessoa, prazo), no lugar do select e do rádio solto. */
function ChoiceCard({ name, value, checked, onChange, icon, label, hint }: { name: string; value: string; checked: boolean; onChange: () => void; icon?: React.ReactNode; label: string; hint?: string }) {
  return (
    <label className={cn("flex cursor-pointer items-center gap-2.5 rounded-[12px] border px-3 py-2.5 text-sm transition-colors duration-[120ms]", checked ? "border-brand bg-brand-soft/60 text-ink" : "border-line text-ink-2 hover:border-line-strong")}>
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} required className="sr-only" />
      {icon && <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px]", checked ? "bg-brand text-on-brand" : "bg-raised text-ink-2")}>{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}

/**
 * Transferir, nota interna e adiar (Caixa de entrada, parte 4), embaixo da resposta. Redesenho
 * (23/10/2026, a pedido do usuário): cada um abre um modal, os destinos e os prazos em cartões, e
 * "Tirar do adiamento" pergunta antes. Nota interna: quem vê a conversa. Transferir: o atendimento
 * aberto, se ninguém mais está com ele. Adiar: só quem está com a conversa.
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
  const [target, setTarget] = useState("");
  const [choice, setChoice] = useState<string>("1h");
  const noTargets = options.sectors.length === 0 && options.people.length === 0;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {canTransfer && (
        <DialogButton
          label="Transferir"
          icon={<ArrowRightLeft size={13} aria-hidden />}
          className={PILL}
          title="Transferir a conversa"
          description="O contato não recebe nada agora: a primeira mensagem de quem receber sai com o aviso de que o atendimento passou para essa pessoa."
          action={onTransfer}
          saveLabel="Transferir"
          footer={noTargets ? "close" : "save"}
        >
          {noTargets ? (
            <p className="text-sm text-muted">Não há para quem transferir: crie setores ou convide pessoas para atender este cliente.</p>
          ) : (
            <>
              {options.sectors.length > 0 && (
                <fieldset className="flex flex-col gap-2">
                  <legend className="label">Para um setor</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {options.sectors.map((s) => (
                      <ChoiceCard key={s.id} name="para" value={`setor:${s.id}`} checked={target === `setor:${s.id}`} onChange={() => setTarget(`setor:${s.id}`)} icon={<Users size={14} />} label={s.name} hint="Vai para a fila do setor" />
                    ))}
                  </div>
                </fieldset>
              )}
              {options.people.length > 0 && (
                <fieldset className="flex flex-col gap-2">
                  <legend className="label">Para uma pessoa</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {options.people.map((p) => (
                      <ChoiceCard key={`${p.type}:${p.id}`} name="para" value={`${p.type}:${p.id}`} checked={target === `${p.type}:${p.id}`} onChange={() => setTarget(`${p.type}:${p.id}`)} icon={<UserRound size={14} />} label={p.name} hint={p.type === "client_member" ? "Área do cliente" : "Equipe da agência"} />
                    ))}
                  </div>
                </fieldset>
              )}
              <div>
                <label htmlFor="transfer-note" className="label">
                  Nota interna (opcional, só a equipe vê)
                </label>
                <textarea id="transfer-note" name="nota" rows={3} maxLength={NOTE_MAX} className="input" placeholder="O que já foi feito e o que falta" />
              </div>
            </>
          )}
        </DialogButton>
      )}

      <DialogButton label="Nota interna" icon={<StickyNote size={13} aria-hidden />} className={PILL} title="Nota interna" description="Só a equipe vê: não vai para o contato nem para a IA. Fica no meio da conversa e no painel do contato." action={onNote} saveLabel="Gravar nota">
        <div>
          <label htmlFor="note-text" className="label">
            Nota
          </label>
          <textarea id="note-text" name="nota" required rows={4} maxLength={NOTE_MAX} className="input" placeholder="Ex.: pediu para ligar depois das 18h" />
        </div>
      </DialogButton>

      {canSnooze && !snoozedUntil && (
        <DialogButton
          label="Adiar"
          icon={<Clock size={13} aria-hidden />}
          className={PILL}
          title="Adiar a conversa"
          description="A conversa sai das filas e fica em Adiadas. Volta na data, ou antes, se o contato escrever. O assistente continua pausado."
          action={onSnooze}
          saveLabel="Adiar"
        >
          <fieldset className="flex flex-col gap-2">
            <legend className="label">Adiar até</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {SNOOZE_CHOICES.map((c) => (
                <ChoiceCard key={c.value} name="ate" value={c.value} checked={choice === c.value} onChange={() => setChoice(c.value)} icon={<Clock size={14} />} label={c.label} />
              ))}
            </div>
          </fieldset>
          {choice === "data" && (
            <div>
              <label htmlFor="snooze-date" className="label">
                Data e hora (Brasília)
              </label>
              <input id="snooze-date" type="datetime-local" name="data" required className="input w-fit" />
            </div>
          )}
        </DialogButton>
      )}

      {snoozedUntil && (
        <span className="inline-flex flex-wrap items-center gap-2 text-xs text-muted">
          <Clock size={13} aria-hidden />
          Adiada até {until(snoozedUntil)}
          {canSnooze && (
            <ConfirmAction action={onUnsnooze} title="Tirar do adiamento?" description="A conversa volta para as filas agora, como estava antes de adiar." confirmLabel="Tirar do adiamento" danger={false} className="font-semibold text-brand hover:underline">
              Tirar do adiamento
            </ConfirmAction>
          )}
        </span>
      )}
    </div>
  );
}
