"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Caixa "cole a URL e gere uma demo" da landing e do painel. */
export function DemoGenerator({ inPanel = false }: { inPanel?: boolean }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [clientName, setClientName] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("loading");
    setError(null);
    try {
      const res = await fetch("/api/demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, clientName }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message ?? j.error ?? "Não deu certo.");
      router.push(inPanel ? `/painel/bots/${j.botId}?demo=1` : j.url);
    } catch (err) {
      setState("error");
      setError((err as Error).message);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="demo-url" className="sr-only">Site do cliente</label>
        <input id="demo-url" type="text" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="site-do-cliente.com.br" className="input flex-1" disabled={state === "loading"} />
        <button type="submit" className="btn-dark whitespace-nowrap" disabled={state === "loading"}>
          {state === "loading" ? "Lendo o site…" : "Gerar demo"}
        </button>
      </div>
      {inPanel && (
        <div>
          <label htmlFor="demo-client" className="label">Nome do cliente (opcional)</label>
          <input id="demo-client" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Ex.: Pousada Brisa" className="input" />
        </div>
      )}
      {state === "loading" && <p className="text-xs text-muted">Lendo até 40 páginas do site e montando a base de conhecimento. Leva de 20 a 60 segundos.</p>}
      {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
    </form>
  );
}
