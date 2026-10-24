"use client";

import { useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { cn } from "@/lib/utils";

const BANDS = {
  agency: ["Começando (0 a 2 clientes)", "3 a 10 clientes", "11 a 30 clientes", "Mais de 30 clientes"],
  business: ["Até 100 conversas por mês", "100 a 500 por mês", "500 a 2.000 por mês", "Mais de 2.000 por mês"],
  saas: ["Até 50 clientes no software", "50 a 500 clientes", "500 a 5.000 clientes", "Mais de 5.000 clientes"],
} as const;

const COMPANY: Record<"agency" | "business" | "saas", string> = { agency: "Nome da agência", business: "Nome do negócio", saas: "Nome da empresa" };
const SIZE_QUESTION: Record<"agency" | "business" | "saas", string> = {
  agency: "Quantos clientes você atende hoje?",
  business: "Quantas conversas por mês, mais ou menos?",
  saas: "Quantos clientes usam o seu software?",
};

/**
 * Entrar na lista de espera (landing, 24/10/2026): só o e-mail para entrar; depois, a posição e, se
 * a pessoa quiser, o nome, a empresa e o tamanho (melhora a ordem dos convites). "site" é o campo
 * escondido contra robôs.
 */
export function WaitlistForm({ profile, source, align = "center", className }: { profile: "agency" | "business" | "saas"; source?: string; align?: "center" | "start"; className?: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "details-sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState<number | null>(null);

  async function post(extra: Record<string, unknown> = {}) {
    const res = await fetch("/api/lista-de-espera", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, profile, source, ...extra }) });
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; position?: number; message?: string };
    if (!res.ok || !j.ok) throw new Error(j.message ?? "Não foi possível entrar na lista agora. Tente de novo.");
    return j;
  }

  async function join(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const site = String(new FormData(e.currentTarget).get("site") ?? "");
    setState("sending");
    setError(null);
    try {
      const j = await post({ site });
      setPosition(j.position ?? null);
      setState("done");
    } catch (err) {
      setError((err as Error).message);
      setState("idle");
    }
  }

  async function details(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    try {
      await post({ name: fd.get("name"), company: fd.get("company"), sizeBand: fd.get("sizeBand") });
      setState("details-sent");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (state === "done" || state === "details-sent") {
    return (
      <div className={cn("flex w-full max-w-[520px] flex-col gap-4 rounded-2xl border border-brand-line bg-panel p-5 text-left", align === "center" && "mx-auto", className)} aria-live="polite">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-on-brand"><Check size={18} /></span>
          <div>
            <div className="display text-lg font-bold">{position ? `Você é o nº ${position} da lista.` : "Você está na lista."}</div>
            <p className="text-sm text-muted">O convite chega em {email} quando for a sua vez. Estamos abrindo aos poucos, por ordem de chegada.</p>
          </div>
        </div>
        {state === "details-sent" ? (
          <p className="text-sm font-medium text-brand">Anotado. Obrigado!</p>
        ) : (
          <form onSubmit={details} className="flex flex-col gap-2.5 border-t border-line pt-4">
            <p className="text-sm text-ink-2">Quer ajudar a gente a te chamar antes? Conte um pouco (opcional):</p>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <input name="name" maxLength={80} placeholder="Seu nome" className="input" aria-label="Seu nome" />
              <input name="company" maxLength={120} placeholder={COMPANY[profile]} className="input" aria-label={COMPANY[profile]} />
            </div>
            <select name="sizeBand" defaultValue="" className="input" aria-label={SIZE_QUESTION[profile]}>
              <option value="" disabled>{SIZE_QUESTION[profile]}</option>
              {BANDS[profile].map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
            {error && <p className="text-sm text-danger">{error}</p>}
            <button type="submit" className="btn-ghost self-start">Enviar</button>
          </form>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={join} className={cn("flex w-full max-w-[520px] flex-col gap-2", align === "center" && "mx-auto", className)}>
      <div className="flex flex-col gap-2 rounded-2xl border border-line-strong bg-panel p-1.5 shadow-[var(--shadow-pop)] sm:flex-row sm:items-center">
        <label htmlFor={`lista-email-${source ?? "x"}`} className="sr-only">Seu e-mail</label>
        <input
          id={`lista-email-${source ?? "x"}`}
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={profile === "business" ? "Seu melhor e-mail" : "Seu e-mail de trabalho"}
          className="min-w-0 flex-1 bg-transparent px-3.5 py-3 text-base outline-none placeholder:text-muted"
        />
        {/* contra robôs: gente não vê nem preenche */}
        <input name="site" tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-px w-px opacity-0" />
        <button type="submit" disabled={state === "sending"} className="btn-primary justify-center px-5 py-3 text-base">
          {state === "sending" ? "Entrando…" : "Entrar na lista"}
          <ArrowRight size={16} />
        </button>
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : <p className={cn("text-xs text-muted", align === "center" && "text-center")}>Só usamos o e-mail para o convite. Sem spam.</p>}
    </form>
  );
}
