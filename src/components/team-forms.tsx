"use client";

import { useState, useTransition } from "react";
import { Pencil, UserPlus } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { CopyButton } from "@/components/copy-button";
import type { ActionResult } from "@/lib/action-result";
import { ROLE_HINTS, ROLE_LABELS, type InvitableRole, type MemberScope } from "@/lib/roles";

/*
 * Formulários da Equipe (leva B1'): convidar e editar papel e escopo. O escopo é uma lista de
 * clientes com os chatbots dentro: marcar o cliente libera todos os chatbots dele (inclusive os
 * que vierem depois); marcar só um chatbot libera só ele.
 */

export interface ScopeClient {
  id: string;
  name: string;
  bots: Array<{ id: string; name: string }>;
}

interface Defaults {
  role: InvitableRole;
  scope: MemberScope;
  clientIds: string[];
  botIds: string[];
}

type Result = ActionResult & { link?: string };

function MemberFields({ clients, allowAdmin, defaults, withEmail }: { clients: ScopeClient[]; allowAdmin: boolean; defaults: Defaults; withEmail: boolean }) {
  const [role, setRole] = useState<InvitableRole>(defaults.role);
  const [scope, setScope] = useState<MemberScope>(defaults.scope);
  const [clientIds, setClientIds] = useState(new Set(defaults.clientIds));
  const roles: InvitableRole[] = allowAdmin ? ["admin", "editor", "agent"] : ["editor", "agent"];
  const selectedScope = role !== "admin" && scope === "selected";
  return (
    <>
      {withEmail && (
        <div>
          <label htmlFor="team-email" className="label">E-mail</label>
          <input id="team-email" name="email" type="email" required maxLength={120} autoComplete="off" className="input" placeholder="pessoa@agencia.com" />
          <p className="mt-1 text-xs text-muted">A pessoa entra com este e-mail. Cada e-mail fica em uma agência só.</p>
        </div>
      )}
      <fieldset className="flex flex-col gap-2">
        <legend className="label">Papel</legend>
        {roles.map((r) => (
          <label key={r} className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line px-3 py-2.5 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
            <input type="radio" name="role" value={r} checked={role === r} onChange={() => setRole(r)} className="mt-0.5" />
            <span><span className="font-semibold">{ROLE_LABELS[r]}</span><span className="block text-xs text-muted">{ROLE_HINTS[r]}</span></span>
          </label>
        ))}
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="label">Escopo</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="scope" value="all" checked={!selectedScope} onChange={() => setScope("all")} />
          Todos os clientes{role === "admin" ? " (administrador vê tudo)" : ""}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="scope" value="selected" checked={selectedScope} disabled={role === "admin"} onChange={() => setScope("selected")} />
          Escolher clientes e chatbots
        </label>
        {selectedScope && (
          <div className="flex max-h-64 flex-col gap-2 overflow-y-auto rounded-lg border border-line p-3">
            {clients.length === 0 && <p className="text-sm text-muted">Nenhum cliente ainda.</p>}
            {clients.map((c) => (
              <div key={c.id} className="flex flex-col gap-1">
                <label className="flex items-center gap-2 text-sm font-semibold">
                  <input
                    type="checkbox"
                    name="scope_item"
                    value={`client:${c.id}`}
                    defaultChecked={defaults.clientIds.includes(c.id)}
                    onChange={(e) => setClientIds((prev) => { const n = new Set(prev); if (e.target.checked) n.add(c.id); else n.delete(c.id); return n; })}
                  />
                  {c.name} <span className="font-normal text-muted">(todos os chatbots)</span>
                </label>
                {!clientIds.has(c.id) && c.bots.map((b) => (
                  <label key={b.id} className="ml-6 flex items-center gap-2 text-sm">
                    <input type="checkbox" name="scope_item" value={`bot:${b.id}`} defaultChecked={defaults.botIds.includes(b.id)} />
                    {b.name}
                  </label>
                ))}
              </div>
            ))}
          </div>
        )}
      </fieldset>
    </>
  );
}

function useSubmit(action: (fd: FormData) => Promise<Result>, onDone: (r: Result) => void) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      try {
        const r = await action(fd);
        if (r.ok) {
          if (r.message) toast.success(r.message);
          onDone(r);
        } else toast.error(r.message);
      } catch {
        toast.error("Não foi possível concluir agora. Verifique a conexão e tente de novo.");
      }
    });
  };
  return { pending, submit };
}

/** Convidar: e-mail, papel e escopo; depois mostra o link do convite para copiar. */
export function InviteMemberButton({ action, clients, allowAdmin, full }: { action: (fd: FormData) => Promise<Result>; clients: ScopeClient[]; allowAdmin: boolean; full: string | null }) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const { pending, submit } = useSubmit(action, (r) => setLink(r.link ?? null));
  const close = () => {
    setOpen(false);
    setLink(null);
  };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} disabled={Boolean(full)} title={full ?? ""} className="btn-primary w-full sm:w-auto"><UserPlus size={15} />Convidar</button>
      <Modal open={open} onClose={close} title={link ? "Convite criado" : "Convidar para a equipe"} description={link ? undefined : "A pessoa recebe um link por e-mail, que vale por 7 dias."}>
        {link ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">Se o e-mail não chegar, mande este link para a pessoa. Ele só funciona para quem entrar com o e-mail convidado.</p>
            <input readOnly value={link} className="input text-xs" onFocus={(e) => e.currentTarget.select()} />
            <div className="flex gap-2">
              <CopyButton text={link} label="Copiar link" className="btn-primary" />
              <button type="button" onClick={close} className="btn-ghost">Fechar</button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <MemberFields clients={clients} allowAdmin={allowAdmin} withEmail defaults={{ role: "agent", scope: "all", clientIds: [], botIds: [] }} />
            <button type="submit" disabled={pending} className="btn-primary self-start">{pending ? "Convidando…" : "Enviar convite"}</button>
          </form>
        )}
      </Modal>
    </>
  );
}

/** Editar papel e escopo de alguém da equipe. */
export function EditMemberButton({ action, clients, allowAdmin, defaults, name }: { action: (fd: FormData) => Promise<Result>; clients: ScopeClient[]; allowAdmin: boolean; defaults: Defaults; name: string }) {
  const [open, setOpen] = useState(false);
  const { pending, submit } = useSubmit(action, () => setOpen(false));
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-ghost text-xs"><Pencil size={13} />Editar</button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Papel e escopo de ${name}`}>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <MemberFields clients={clients} allowAdmin={allowAdmin || defaults.role === "admin"} withEmail={false} defaults={defaults} />
          <button type="submit" disabled={pending} className="btn-primary self-start">{pending ? "Salvando…" : "Salvar"}</button>
        </form>
      </Modal>
    </>
  );
}

/** Convite pendente ou vencido: gera um link novo (o anterior para de valer) e mostra para copiar. */
export function ReinviteButton({ action }: { action: () => Promise<Result> }) {
  const [link, setLink] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const run = () =>
    start(async () => {
      const r = await action();
      if (!r.ok) return toast.error(r.message);
      if (r.message) toast.success(r.message);
      setLink(r.link ?? null);
    });
  return (
    <>
      <button type="button" onClick={run} disabled={pending} className="btn-ghost text-xs">{pending ? "Gerando…" : "Convidar de novo"}</button>
      <Modal open={Boolean(link)} onClose={() => setLink(null)} title="Link novo do convite">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">O link anterior parou de valer. Este vale por 7 dias e só funciona para quem entrar com o e-mail convidado.</p>
          <input readOnly value={link ?? ""} className="input text-xs" onFocus={(e) => e.currentTarget.select()} />
          <div className="flex gap-2">
            <CopyButton text={link ?? ""} label="Copiar link" className="btn-primary" />
            <button type="button" onClick={() => setLink(null)} className="btn-ghost">Fechar</button>
          </div>
        </div>
      </Modal>
    </>
  );
}
