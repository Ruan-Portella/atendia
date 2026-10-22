"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ChartColumn, CircleUser, Contact, Inbox, Loader2, Megaphone, MessageSquare, Plus, Search, Settings, Users } from "lucide-react";
import { BotFace } from "@/components/bot-face";
import { chooseTema } from "@/components/theme";
import { openOnboardingWidget } from "@/components/onboarding-widget";
import { showOnboarding } from "@/app/painel/actions";
import { openCreate } from "@/components/create-dialogs";
import { buildGroups, type GoToGroup, type GoToItem } from "@/lib/go-to";
import type { AgencyRole } from "@/lib/roles";
import { cn } from "@/lib/utils";

interface Props {
  role: AgencyRole;
  packs: string[];
  /** Os clientes do menu: filtram na hora, sem esperar o servidor. */
  clients: Array<{ id: string; name: string; color: string | null; face?: unknown }>;
}

function ItemIcon({ item }: { item: GoToItem }) {
  if (item.kind === "client" || item.kind === "bot") return <BotFace color={item.color} face={item.face} size={30} />;
  if (item.kind === "contact")
    return <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-raised text-[11px] font-semibold text-ink">{item.title.split(/\s+/).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join("")}</span>;
  const page = { "/painel/caixa": Inbox, "/painel/contatos": Contact, "/painel/campanhas": Megaphone, "/painel/relatorios": ChartColumn, "/painel/clientes": Users }[item.id];
  const Icon = item.kind === "conversation" ? MessageSquare : item.kind === "action" ? (item.run && !item.run.startsWith("novo-") ? ArrowRight : Plus) : page ?? (item.id === "/painel/perfil" ? CircleUser : Settings);
  const tone = item.kind === "action" ? "bg-brand text-on-brand" : item.kind === "conversation" ? "bg-amber-soft text-amber-ink" : "bg-raised text-ink-2";
  return (
    <span className={cn("flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px]", tone)}>
      <Icon size={15} />
    </span>
  );
}

/**
 * Ir para (Ctrl K): acha contato, conversa, cliente, chatbot, ação e ajuste numa busca só. Abre
 * pelo atalho (Ctrl K ou ⌘K) ou pelo botão do menu; ↑↓ escolhem, Enter abre, Esc fecha.
 */
export function GoTo({ role, packs, clients }: Props) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<{ q: string; groups: GoToGroup[] }>({ q: "", groups: [] });
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("bv-ir-para", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("bv-ir-para", onOpen);
    };
  }, []);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      input.current?.focus();
    } else if (!open && d.open) d.close();
  }, [open]);

  // contatos, conversas e chatbots: no servidor, um pouco depois de parar de digitar
  const term = query.trim();
  useEffect(() => {
    if (!open || term.length < 2) return;
    const ctrl = new AbortController();
    const t = window.setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/painel/ir-para", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q: term }), signal: ctrl.signal, cache: "no-store" });
        setRemote({ q: term, groups: res.ok ? ((await res.json()) as { groups: GoToGroup[] }).groups : [] });
      } catch {
        // sem rede: fica o que filtra na hora (cancelada, a busca seguinte assume)
        if (!ctrl.signal.aborted) setRemote({ q: term, groups: [] });
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 180);
    return () => {
      window.clearTimeout(t);
      ctrl.abort();
    };
  }, [term, open]);

  const clientItems = useMemo<GoToItem[]>(() => clients.map((c) => ({ id: c.id, kind: "client", title: c.name, sub: "Cliente", href: `/painel/clientes/${c.id}`, color: c.color, face: c.face })), [clients]);
  const groups = useMemo(() => buildGroups({ query, role, packs, clients: clientItems, remote: term.length >= 2 && remote.q === term ? remote.groups : [] }), [query, role, packs, clientItems, remote, term]);
  const flat = groups.flatMap((g) => g.items);
  const current = Math.min(picked, Math.max(0, flat.length - 1));

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  function close() {
    setOpen(false);
    setQuery("");
    setPicked(0);
  }

  function go(item: GoToItem | undefined) {
    if (!item) return;
    close();
    if (item.run === "sair") {
      const f = document.createElement("form");
      f.method = "post";
      f.action = "/auth/signout";
      document.body.appendChild(f);
      f.submit();
      return;
    }
    // criar abre o modal, sem sair da tela
    if (item.run === "novo-cliente" || item.run === "novo-chatbot") {
      openCreate(item.run === "novo-cliente" ? "cliente" : "chatbot");
      return;
    }
    // mostrar os primeiros passos de novo: abre o widget, tira o cookie do Ocultar e vai para Clientes
    if (item.run === "primeiros-passos") {
      openOnboardingWidget();
      void showOnboarding().then(() => router.push("/painel/clientes"));
      return;
    }
    if (item.run) chooseTema(item.run === "tema-escuro" ? "escuro" : item.run === "tema-claro" ? "claro" : "sistema");
    else if (item.href) router.push(item.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setPicked(flat.length ? (current + 1) % flat.length : 0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setPicked(flat.length ? (current - 1 + flat.length) % flat.length : 0);
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(flat[current]);
    }
  }

  let n = 0;
  const searching = term.length >= 2 && (loading || remote.q !== term);
  return (
    <dialog
      ref={dialog}
      aria-label="Ir para"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      className="modal palette w-[calc(100%-24px)] max-w-[640px] overflow-hidden"
    >
      <div className="flex items-center gap-3 border-b border-line px-4 py-3.5">
        {searching ? <Loader2 size={18} className="shrink-0 animate-spin text-brand" /> : <Search size={18} className="shrink-0 text-brand" />}
        <label htmlFor="ir-para" className="sr-only">Buscar</label>
        <input
          ref={input}
          id="ir-para"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPicked(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Busque um contato, conversa, cliente, chatbot ou ajuste…"
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded="true"
          aria-controls="ir-para-lista"
          aria-activedescendant={flat.length ? `ir-para-${current}` : undefined}
          className="min-w-0 flex-1 bg-transparent text-[16px] text-ink placeholder:text-muted focus:outline-none"
        />
        <kbd className="hidden rounded-md bg-raised px-2 py-0.5 font-mono text-[11px] text-muted sm:block">Esc</kbd>
      </div>
      <div ref={list} id="ir-para-lista" role="listbox" aria-label="Resultados" className="flex max-h-[min(60vh,520px)] flex-col gap-0.5 overflow-y-auto p-2">
        {flat.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-muted">{searching ? "Procurando…" : `Nada com "${term}". Tente o nome do contato, do cliente, do chatbot ou de um ajuste.`}</p>
        )}
        {groups.map((g) => (
          <div key={g.title} role="group" aria-label={g.title} className="flex flex-col gap-0.5">
            <div className="px-2.5 pb-1 pt-2.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted">{g.title}</div>
            {g.items.map((item) => {
              const i = n++;
              const on = i === current;
              return (
                <button
                  key={`${g.title}-${item.id}`}
                  id={`ir-para-${i}`}
                  data-index={i}
                  type="button"
                  role="option"
                  aria-selected={on}
                  onMouseMove={() => picked !== i && setPicked(i)}
                  onClick={() => go(item)}
                  className={cn("rise-in flex items-center gap-3 rounded-[12px] px-2.5 py-2 text-left transition-colors duration-[120ms]", on ? "bg-raised" : "hover:bg-raised/60")}
                >
                  <ItemIcon item={item} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium text-ink">{item.title}</span>
                    {item.sub && <span className="truncate text-[12.5px] text-muted">{item.sub}</span>}
                  </span>
                  <span className={cn("shrink-0 font-mono text-[10.5px]", on ? "text-brand" : "text-muted")}>{on ? "Enter" : LABEL[item.kind]}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-2.5 text-[12px] text-muted">
        <span><kbd className="rounded bg-raised px-1.5 font-mono">↑↓</kbd> escolher</span>
        <span><kbd className="rounded bg-raised px-1.5 font-mono">Enter</kbd> abrir</span>
        <span className="hidden sm:inline sm:ml-auto">Também acha ajustes, como &ldquo;assinatura&rdquo; ou &ldquo;webhook&rdquo;.</span>
      </div>
    </dialog>
  );
}

const LABEL: Record<GoToItem["kind"], string> = { page: "tela", contact: "contato", conversation: "conversa", client: "cliente", bot: "chatbot", action: "ação", setting: "ajuste" };
