"use client";

import { useState, useTransition } from "react";
import { Check, Search, UserPlus } from "lucide-react";
import { liveValidation, validateForm } from "@/components/ui/form-errors";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { CopyButton } from "@/components/copy-button";
import { Segmented } from "@/components/template-slots";
import type { ActionResult } from "@/lib/action-result";
import { ROLE_HINTS, ROLE_LABELS, type InvitableRole, type MemberScope } from "@/lib/roles";
import { cn } from "@/lib/utils";

/*
 * Formulários da Equipe (leva B1'; redesenho, etapa 5): convidar e editar papel e escopo. O escopo é
 * uma lista de clientes com os chatbots dentro: marcar o cliente libera todos os chatbots dele
 * (inclusive os que vierem depois); marcar só um chatbot libera só ele.
 */

export interface ScopeClient {
  id: string;
  name: string;
  bots: Array<{ id: string; name: string }>;
}

export interface MemberDefaults {
  role: InvitableRole;
  scope: MemberScope;
  clientIds: string[];
  botIds: string[];
}

export type InviteResult = ActionResult & { link?: string };

/** Uma linha marcável da lista de escopo (o checkbox fica escondido; o quadrado desenha). */
function CheckRow({ name, value, defaultChecked, onChange, children, nested }: { name: string; value: string; defaultChecked: boolean; onChange?: (on: boolean) => void; children: React.ReactNode; nested?: boolean }) {
  return (
    <label className={cn("group/ck flex cursor-pointer items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-sm hover:bg-raised/50", nested && "ml-7")}>
      <input type="checkbox" name={name} value={value} defaultChecked={defaultChecked} onChange={(e) => onChange?.(e.target.checked)} className="peer sr-only" />
      <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] text-transparent shadow-[inset_0_0_0_1.5px_var(--color-line-strong)] peer-checked:bg-brand peer-checked:text-on-brand peer-checked:shadow-none peer-focus-visible:ring-[3px] peer-focus-visible:ring-brand/25">
        <Check size={12} strokeWidth={3} />
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </label>
  );
}

export function MemberFields({ clients, allowAdmin, defaults, withEmail }: { clients: ScopeClient[]; allowAdmin: boolean; defaults: MemberDefaults; withEmail: boolean }) {
  const [role, setRole] = useState<InvitableRole>(defaults.role);
  const [scope, setScope] = useState<MemberScope>(defaults.scope);
  const [clientIds, setClientIds] = useState(new Set(defaults.clientIds));
  const [query, setQuery] = useState("");
  const roles: InvitableRole[] = allowAdmin ? ["admin", "editor", "agent"] : ["editor", "agent"];
  const selected = role !== "admin" && scope === "selected";
  const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const q = norm(query.trim());
  // a busca só esconde (os marcados continuam no formulário)
  const hit = (c: ScopeClient) => !q || norm(c.name).includes(q) || c.bots.some((b) => norm(b.name).includes(q));
  return (
    <>
      {withEmail && (
        <div>
          <label htmlFor="team-email" className="label">
            E-mail
          </label>
          <input id="team-email" name="email" type="email" required maxLength={120} autoComplete="off" className="input" placeholder="pessoa@agencia.com" />
          <p className="mt-1 text-xs text-muted">A pessoa entra com este e-mail. Cada e-mail fica em uma conta só.</p>
        </div>
      )}
      <div role="radiogroup" aria-label="Papel" className="flex flex-col gap-2">
        <span className="label mb-0">Papel</span>
        {roles.map((r) => (
          <label key={r} className={cn("flex cursor-pointer items-start gap-3 rounded-[14px] border p-3 transition-colors duration-[120ms]", role === r ? "border-brand bg-brand-soft/60" : "border-line hover:border-line-strong")}>
            <input type="radio" name="role" value={r} checked={role === r} onChange={() => setRole(r)} className="sr-only" />
            <span className={cn("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full", role === r ? "bg-brand" : "shadow-[inset_0_0_0_1.5px_var(--color-line-strong)]")}>{role === r && <span className="h-1.5 w-1.5 rounded-full bg-on-brand" />}</span>
            <span>
              <span className="block text-sm font-medium text-ink">{ROLE_LABELS[r]}</span>
              <span className="mt-0.5 block text-xs leading-snug text-muted">{ROLE_HINTS[r]}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        <span className="label mb-0">O que a pessoa vê</span>
        <input type="hidden" name="scope" value={selected ? "selected" : "all"} />
        {role === "admin" ? (
          <p className="rounded-[12px] bg-raised px-3 py-2 text-sm text-ink-2">Todos os clientes: o administrador vê tudo.</p>
        ) : (
          <>
            <Segmented
              label="O que a pessoa vê"
              value={selected ? "selected" : "all"}
              options={[
                ["all", "Todos os clientes"],
                ["selected", "Escolher clientes e chatbots"],
              ]}
              onChange={setScope}
            />
            {selected && (
              <div className="flex flex-col gap-2 rounded-[14px] border border-line p-2">
                {clients.length > 6 && (
                  <label className="relative">
                    <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                    <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && e.preventDefault()} aria-label="Buscar clientes" placeholder="Buscar cliente ou chatbot" className="input py-1.5 pl-8 text-sm" />
                  </label>
                )}
                <div className="flex max-h-64 flex-col overflow-y-auto">
                  {clients.length === 0 && <p className="px-2 py-3 text-sm text-muted">Nenhum cliente ainda.</p>}
                  {clients.map((c) => (
                    <div key={c.id} className={cn("flex flex-col", !hit(c) && "hidden")}>
                      <CheckRow
                        name="scope_item"
                        value={`client:${c.id}`}
                        defaultChecked={defaults.clientIds.includes(c.id)}
                        onChange={(on) =>
                          setClientIds((prev) => {
                            const n = new Set(prev);
                            if (on) n.add(c.id);
                            else n.delete(c.id);
                            return n;
                          })
                        }
                      >
                        <span className="font-medium text-ink">{c.name}</span> <span className="text-xs text-muted">{clientIds.has(c.id) ? "todos os chatbots, também os que vierem" : c.bots.length ? "ou só alguns chatbots:" : "sem chatbots ainda"}</span>
                      </CheckRow>
                      {!clientIds.has(c.id) &&
                        c.bots.map((b) => (
                          <CheckRow key={b.id} name="scope_item" value={`bot:${b.id}`} defaultChecked={defaults.botIds.includes(b.id)} nested>
                            <span className="text-ink-2">{b.name}</span>
                          </CheckRow>
                        ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

/** Mandar o formulário (com a conferência dos campos) e mostrar o aviso. */
export function useMemberSubmit(action: (fd: FormData) => Promise<InviteResult>, onDone: (r: InviteResult) => void) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!validateForm(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter)) return;
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

/** O link do convite para copiar, quando o e-mail não chegar. */
export function InviteLink({ link }: { link: string }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">Se o e-mail não chegar, mande este link para a pessoa. Ele vale por 7 dias e só funciona para quem entrar com o e-mail convidado.</p>
      <input readOnly value={link} aria-label="Link do convite" className="input text-xs" onFocus={(e) => e.currentTarget.select()} />
    </div>
  );
}

/** Convidar: e-mail, papel e escopo; depois mostra o link do convite para copiar. */
export function InviteMemberButton({ action, clients, allowAdmin }: { action: (fd: FormData) => Promise<InviteResult>; clients: ScopeClient[]; allowAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const [gen, setGen] = useState(0);
  const [link, setLink] = useState<string | null>(null);
  const { pending, submit } = useMemberSubmit(action, (r) => setLink(r.link ?? null));
  const close = () => {
    setOpen(false);
    setLink(null);
    setGen((g) => g + 1);
  };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-primary w-full sm:w-auto">
        <UserPlus size={15} />
        Convidar
      </button>
      <Modal
        open={open}
        onClose={close}
        title={link ? "Convite criado" : "Convidar para a equipe"}
        description={link ? "A pessoa recebeu o convite por e-mail." : "A pessoa recebe um link por e-mail, que vale por 7 dias."}
        footer={
          link ? (
            <>
              <button type="button" onClick={close} className="btn-ghost">
                Fechar
              </button>
              <CopyButton text={link} label="Copiar link" className="btn-primary" />
            </>
          ) : (
            <>
              <button type="button" onClick={close} className="btn-ghost">
                Cancelar
              </button>
              <button type="submit" form="team-invite" disabled={pending} className="btn-primary">
                {pending ? "Convidando…" : "Enviar convite"}
              </button>
            </>
          )
        }
      >
        {link ? (
          <InviteLink link={link} />
        ) : (
          <form key={gen} id="team-invite" onSubmit={submit} noValidate {...liveValidation} className="flex flex-col gap-5">
            <MemberFields clients={clients} allowAdmin={allowAdmin} withEmail defaults={{ role: "agent", scope: "all", clientIds: [], botIds: [] }} />
          </form>
        )}
      </Modal>
    </>
  );
}
