"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LinkIcon, LogOut, Pencil, Search, UserMinus, XCircle } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { InviteLink, MemberFields, type InviteResult, type MemberDefaults, type ScopeClient } from "@/components/team-forms";
import { StatusPill } from "@/components/ui/form-section";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { ConfirmModal, Modal } from "@/components/ui/modal";
import { EditDialog } from "@/components/ui/setting-row";
import { useToast } from "@/components/ui/toast";
import type { ActionResult } from "@/lib/action-result";
import type { AgencyRole } from "@/lib/roles";
import { cn, initials } from "@/lib/utils";

/** Uma pessoa da equipe como a lista mostra (montada no servidor). */
export interface TeamRow {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
  you: boolean;
  role: AgencyRole;
  roleLabel: string;
  scope: string;
  /** último acesso ("há 2 horas") ou null */
  access: string | null;
  invite: { state: "open"; until: string } | { state: "expired" } | null;
  /** editar, mandar um link novo, remover ou cancelar o convite */
  canManage: boolean;
  canEndSessions: boolean;
  defaults: MemberDefaults;
}

type Ask = { row: TeamRow; kind: "remove" | "sessions" };

/**
 * A lista da Equipe (redesenho, etapa 5): cada pessoa numa linha com o papel, o que vê e o último
 * acesso; as ações no menu "…" (editar, link novo do convite, encerrar as sessões, remover). Tocar na
 * linha abre o papel e o escopo. Com mais de 5 pessoas, a busca e os filtros pelo papel.
 */
export function TeamList({
  rows,
  clients,
  allowAdmin,
  update,
  reinvite,
  endSessions,
  remove,
}: {
  rows: TeamRow[];
  clients: ScopeClient[];
  allowAdmin: boolean;
  update: (memberId: string, fd: FormData) => Promise<ActionResult>;
  reinvite: (memberId: string) => Promise<InviteResult>;
  endSessions: (memberId: string) => Promise<ActionResult>;
  remove: (memberId: string) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, start] = useTransition();
  const [editing, setEditing] = useState<TeamRow | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"todos" | "convites" | AgencyRole>("todos");

  const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const q = norm(query.trim());
  const shown = rows.filter((r) => (filter === "todos" ? true : filter === "convites" ? Boolean(r.invite) : r.role === filter && !r.invite)).filter((r) => !q || norm(`${r.name} ${r.email}`).includes(q));
  const count = (f: typeof filter) => rows.filter((r) => (f === "convites" ? Boolean(r.invite) : r.role === f && !r.invite)).length;
  const chips: Array<[typeof filter, string]> = [
    ["todos", "Todos"],
    ["admin", "Administradores"],
    ["editor", "Editores"],
    ["agent", "Atendentes"],
    ["convites", "Convites"],
  ];

  const run = (fn: () => Promise<ActionResult>, done?: (r: ActionResult) => void) =>
    start(async () => {
      try {
        const r = await fn();
        if (!r.ok) return toast.error(r.message);
        if (r.message) toast.success(r.message);
        done?.(r);
        router.refresh();
      } catch {
        toast.error("Não foi possível concluir agora. Verifique a conexão e tente de novo.");
      }
    });
  const sendLink = (row: TeamRow) => run(() => reinvite(row.id), (r) => setLink((r as InviteResult).link ?? null));
  const items = (r: TeamRow): MenuItem[] => {
    const out: MenuItem[] = [];
    if (r.canManage && !r.invite) out.push({ label: "Editar o papel e o que vê", icon: Pencil, onSelect: () => setEditing(r) });
    if (r.canManage && r.invite) out.push({ label: "Mandar um link novo", hint: "O link anterior para de valer", icon: LinkIcon, onSelect: () => sendLink(r) });
    if (r.canEndSessions) out.push({ label: "Encerrar as sessões", hint: "Sai do painel em todos os aparelhos", icon: LogOut, onSelect: () => setAsk({ row: r, kind: "sessions" }) });
    if (r.canManage) out.push({ type: "separator" }, r.invite ? { label: "Cancelar o convite", icon: XCircle, danger: true, onSelect: () => setAsk({ row: r, kind: "remove" }) } : { label: "Remover da equipe", icon: UserMinus, danger: true, onSelect: () => setAsk({ row: r, kind: "remove" }) });
    return out;
  };

  return (
    <div className="flex flex-col gap-3">
      {rows.length > 5 && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative w-full sm:w-72">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar na equipe" placeholder="Buscar pelo nome ou e-mail" className="input pl-9" />
          </label>
          <div role="group" aria-label="Filtrar pelo papel" className="flex flex-wrap gap-1.5">
            {chips.map(([k, label]) =>
              k !== "todos" && count(k) === 0 ? null : (
                <button
                  key={k}
                  type="button"
                  aria-pressed={filter === k}
                  onClick={() => setFilter(k)}
                  className={cn("rounded-full border px-3 py-1 text-[13px] font-medium transition-colors duration-[120ms]", filter === k ? "border-brand bg-brand-soft text-brand" : "border-line text-ink-2 hover:border-line-strong")}
                >
                  {label} {k !== "todos" && <span className="tabular text-xs opacity-70">{count(k)}</span>}
                </button>
              ),
            )}
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        {shown.map((r) => {
          const menu = items(r);
          const clickable = r.canManage && !r.invite;
          return (
            <div key={r.id} className={cn("group relative flex items-center gap-3 border-b border-line-2 px-4 py-3 transition-colors duration-[120ms] last:border-0 lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_minmax(0,1fr)_40px] lg:px-[18px]", clickable && "hover:bg-raised/40")}>
              {clickable && <button type="button" onClick={() => setEditing(r)} className="absolute inset-0" aria-label={`Editar o papel de ${r.name}`} />}
              <span className="pointer-events-none flex min-w-0 flex-1 items-center gap-3">
                {r.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.avatar} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
                ) : (
                  <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold", r.invite ? "bg-raised text-muted" : "bg-brand-soft text-brand")}>{initials(r.name)}</span>
                )}
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate text-[15px] font-medium text-ink">
                      {r.name}
                      {r.you && <span className="font-normal text-muted"> (você)</span>}
                    </span>
                    <StatusPill tone={r.role === "owner" || r.role === "admin" ? "ok" : "muted"}>{r.roleLabel}</StatusPill>
                  </span>
                  {r.email !== r.name && <span className="mt-0.5 block truncate text-xs text-muted">{r.email}</span>}
                  {/* no celular, o que vê e o acesso embaixo */}
                  <span className="mt-0.5 block truncate text-xs text-ink-2 lg:hidden">
                    {r.scope} · {r.invite ? (r.invite.state === "open" ? `convite até ${r.invite.until}` : "convite vencido") : (r.access ?? "ainda não entrou")}
                  </span>
                </span>
              </span>
              <span className="pointer-events-none hidden min-w-0 truncate text-sm text-ink-2 lg:block">{r.scope}</span>
              <span className="pointer-events-none hidden text-xs lg:block">
                {r.invite ? (
                  r.invite.state === "open" ? (
                    <span className="flex flex-col items-start gap-0.5">
                      <StatusPill tone="warn">Convite pendente</StatusPill>
                      <span className="text-muted">vale até {r.invite.until}</span>
                    </span>
                  ) : (
                    <StatusPill tone="danger">Convite vencido</StatusPill>
                  )
                ) : (
                  <span className="text-muted">{r.access ? `Entrou ${r.access}` : "Ainda não entrou"}</span>
                )}
              </span>
              <span className="relative z-[1] flex w-10 shrink-0 justify-end">{menu.length > 0 && <Menu label={`Mais ações de ${r.name}`} items={menu} />}</span>
            </div>
          );
        })}
        {shown.length === 0 && <p className="px-5 py-6 text-center text-sm text-muted">{q ? <>Ninguém com &ldquo;{query.trim()}&rdquo;.</> : "Ninguém neste filtro."}</p>}
      </div>

      {editing && (
        <EditDialog key={editing.id} open onClose={() => setEditing(null)} title={`Papel de ${editing.name}`} description="O papel diz o que a pessoa pode fazer; o escopo, quais clientes e chatbots ela vê." action={(fd) => update(editing.id, fd)}>
          <MemberFields clients={clients} allowAdmin={allowAdmin || editing.defaults.role === "admin"} withEmail={false} defaults={editing.defaults} />
        </EditDialog>
      )}

      <ConfirmModal
        open={Boolean(ask)}
        onClose={() => setAsk(null)}
        onConfirm={() => {
          if (!ask) return;
          const { row, kind } = ask;
          run(() => (kind === "remove" ? remove(row.id) : endSessions(row.id)), () => setAsk(null));
        }}
        title={!ask ? "" : ask.kind === "sessions" ? `Encerrar as sessões de ${ask.row.name}?` : ask.row.invite ? "Cancelar este convite?" : `Remover ${ask.row.name} da equipe?`}
        description={
          !ask
            ? ""
            : ask.kind === "sessions"
              ? `${ask.row.name} sai do painel em todos os aparelhos (celular perdido, computador emprestado) e recebe um e-mail. Para voltar, basta entrar de novo; o acesso continua. Pede o código do app autenticador.`
              : ask.row.invite
                ? `O link mandado para ${ask.row.email} deixa de valer.`
                : `${ask.row.name} perde o acesso ao painel na hora. O que a pessoa fez continua na auditoria.`
        }
        confirmLabel={!ask ? "" : ask.kind === "sessions" ? "Encerrar as sessões" : ask.row.invite ? "Cancelar o convite" : "Remover"}
        cancelLabel="Voltar"
        danger={ask?.kind === "remove"}
        busy={busy}
      />

      <Modal
        open={Boolean(link)}
        onClose={() => setLink(null)}
        title="Link novo do convite"
        description="O link anterior parou de valer."
        footer={
          <>
            <button type="button" onClick={() => setLink(null)} className="btn-ghost">
              Fechar
            </button>
            <CopyButton text={link ?? ""} label="Copiar link" className="btn-primary" />
          </>
        }
      >
        {link && <InviteLink link={link} />}
      </Modal>
    </div>
  );
}
