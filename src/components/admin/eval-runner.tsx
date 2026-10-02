"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  bots: Array<{ id: string; label: string }>;
  files: Array<{ value: string; label: string; categories: string[] }>;
  defaultModel: string;
}

const MODELS = ["gpt-4.1-mini", "gpt-5-mini", "gpt-5.4-mini", "gpt-5.4-nano", "gpt-4.1-nano", "gpt-4o-mini"];
const EFFORTS = [
  { value: "", label: "Mínimo do modelo" },
  { value: "low", label: "Baixo (low)" },
  { value: "medium", label: "Médio (medium)" },
  { value: "minimal", label: "Mínimo (minimal, gpt-5)" },
  { value: "none", label: "Nenhum (none, gpt-5.1+)" },
];

/**
 * Roda o conjunto fixo pela própria /api/eval (o mesmo caminho do chat) e mostra o relatório à
 * medida que os casos terminam. Cada rodada fica salva no histórico logo abaixo.
 */
export function EvalRunner({ bots, files, defaultModel }: Props) {
  const router = useRouter();
  const [bot, setBot] = useState(bots[0]?.id ?? "");
  const [file, setFile] = useState(files[0]?.value ?? "1");
  const [categories, setCategories] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [effort, setEffort] = useState("");
  const [classifier, setClassifier] = useState("");
  const [runs, setRuns] = useState(3);
  const [output, setOutput] = useState("");
  const [running, setRunning] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const pre = useRef<HTMLPreElement | null>(null);

  const available = files.find((f) => f.value === file)?.categories ?? [];
  const chosenModel = model === "outro" ? customModel.trim() : model;

  useEffect(() => {
    if (pre.current) pre.current.scrollTop = pre.current.scrollHeight;
  }, [output]);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!bot) return;
    const q = new URLSearchParams({ bot, casos: file, n: String(runs) });
    for (const c of categories) q.append("categoria", c);
    if (chosenModel) q.set("model", chosenModel);
    if (effort) q.set("esforco", effort);
    if (classifier) q.set("classificador", classifier);
    setOutput("");
    setRunning(true);
    abort.current = new AbortController();
    try {
      const res = await fetch(`/api/eval?${q}`, { signal: abort.current.signal, cache: "no-store" });
      if (!res.ok || !res.body) {
        setOutput(`Erro ${res.status}: ${await res.text()}`);
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        setOutput((o) => o + dec.decode(value, { stream: true }));
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") setOutput((o) => `${o}\n\nERRO: ${(err as Error).message}`);
      else setOutput((o) => `${o}\n\n(parado)`);
    } finally {
      setRunning(false);
      abort.current = null;
      router.refresh();
    }
  }

  const toggle = (c: string) => setCategories((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]));

  return (
    <section className="card flex flex-col gap-4 p-5">
      <form onSubmit={run} className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <label htmlFor="ev-bot" className="label">Chatbot</label>
            <select id="ev-bot" value={bot} onChange={(e) => setBot(e.target.value)} className="input">
              {bots.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="ev-file" className="label">Casos</label>
            <select id="ev-file" value={file} onChange={(e) => { setFile(e.target.value); setCategories([]); }} className="input">
              {files.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="ev-runs" className="label">Rodadas por caso</label>
            <select id="ev-runs" value={runs} onChange={(e) => setRuns(Number(e.target.value))} className="input">
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}{n === 3 ? " (padrão)" : n === 5 ? " (pega falha que só aparece às vezes)" : ""}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="ev-model" className="label">Modelo</label>
            <select id="ev-model" value={model} onChange={(e) => setModel(e.target.value)} className="input">
              <option value="">Padrão ({defaultModel})</option>
              {MODELS.filter((m) => m !== defaultModel).map((m) => <option key={m} value={m}>{m}</option>)}
              <option value="outro">Outro…</option>
            </select>
            {model === "outro" && <input value={customModel} onChange={(e) => setCustomModel(e.target.value)} placeholder="ex.: gpt-5.5-mini" className="input mt-2" />}
          </div>
          <div>
            <label htmlFor="ev-effort" className="label">Raciocínio (só gpt-5+)</label>
            <select id="ev-effort" value={effort} onChange={(e) => setEffort(e.target.value)} className="input">
              {EFFORTS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="ev-classifier" className="label">Classificador do portão</label>
            <select id="ev-classifier" value={classifier} onChange={(e) => setClassifier(e.target.value)} className="input">
              <option value="">Padrão (modelo do chat)</option>
              <option value="gpt-4.1-mini">gpt-4.1-mini</option>
              <option value="gpt-4.1-nano">gpt-4.1-nano</option>
            </select>
          </div>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="label">Categorias {categories.length ? `(${categories.length} escolhidas)` : "(todas)"}</legend>
          <div className="flex flex-wrap gap-2">
            {available.map((c) => (
              <label key={c} className={`cursor-pointer rounded-full border px-3 py-1 text-sm ${categories.includes(c) ? "border-ink bg-ink text-ground" : "border-line bg-panel"}`}>
                <input type="checkbox" className="sr-only" checked={categories.includes(c)} onChange={() => toggle(c)} />
                {c}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="btn-primary" disabled={running || !bot}>{running ? "Rodando…" : "Rodar avaliação"}</button>
          {running && <button type="button" className="btn-ghost" onClick={() => abort.current?.abort()}>Parar</button>}
          <span className="text-xs text-muted">Gasta IA de verdade (uma resposta por rodada de cada caso). O conjunto inteiro leva de 2 a 4 minutos.</span>
        </div>
      </form>

      {output && (
        <pre ref={pre} className="max-h-[560px] overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-ground p-4 text-xs leading-relaxed text-ink">{output}</pre>
      )}
    </section>
  );
}
