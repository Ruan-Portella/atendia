"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  bots: Array<{ id: string; label: string; client: string; name: string }>;
  files: Array<{ value: string; label: string; categories: string[]; forBot: string | null; count: number }>;
  defaultModel: string;
  /** Bot da última rodada de cada arquivo de casos. */
  lastBotByFile: Record<string, string>;
}

const loose = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\(teste\)/g, "").replace(/\s+/g, " ").trim();

/** O bot é o do comentário do arquivo? Pelo nome do bot ou do cliente, sem acento, caixa e "(teste)". */
export function matchesHint(b: { name: string; client: string }, hint: string): boolean {
  const h = loose(hint);
  return Boolean(h) && (loose(b.name) === h || loose(b.client) === h);
}

/**
 * Bot que o formulário escolhe para um arquivo: o que o arquivo pede (casos de um bot de teste),
 * senão o da última rodada daquele arquivo, senão o primeiro da lista.
 */
export function pickBot(file: Props["files"][number] | undefined, bots: Props["bots"], lastBotByFile: Props["lastBotByFile"]): string {
  const named = file?.forBot ? bots.find((b) => matchesHint(b, file.forBot!)) : undefined;
  const last = file ? bots.find((b) => b.id === lastBotByFile[file.value]) : undefined;
  return (named ?? last ?? bots[0])?.id ?? "";
}

/** Valor do seletor de casos que roda todos os arquivos, um depois do outro. */
export const ALL_FILES = "todos";

export interface PlanItem {
  file: string;
  label: string;
  count: number;
  /** null: o bot de teste do arquivo não existe aqui (o arquivo é pulado). */
  bot: string | null;
  botLabel: string | null;
}

/**
 * Todos os arquivos: cada um com o bot para o qual foi escrito; sem bot de teste no arquivo (o
 * geral), o da última rodada dele. Arquivo de um bot de teste que não existe aqui é pulado (com
 * outro bot, o resultado não vale). Pura.
 */
export function planAll(files: Props["files"], bots: Props["bots"], lastBotByFile: Props["lastBotByFile"]): PlanItem[] {
  return files.map((f) => {
    const named = f.forBot ? bots.find((b) => matchesHint(b, f.forBot!)) : undefined;
    const id = f.forBot ? (named?.id ?? null) : pickBot(f, bots, lastBotByFile) || null;
    return { file: f.value, label: f.label, count: f.count, bot: id, botLabel: bots.find((b) => b.id === id)?.label ?? null };
  });
}

/** "RESULTADO: 15/16 casos passaram … obrigatórios (…): ✅ OK" do relatório da /api/eval. Pura. */
export function parseResult(report: string): { passed: number; total: number; mustOk: boolean } | null {
  const m = /RESULTADO: (\d+)\/(\d+) casos passaram[^\n]*?obrigatórios[^\n]*?: (✅ OK|❌ FALHOU)/.exec(report);
  return m ? { passed: Number(m[1]), total: Number(m[2]), mustOk: m[3] === "✅ OK" } : null;
}

type Progress = PlanItem & { status: "fila" | "rodando" | "feito" | "erro" | "pulado" | "parado"; result: ReturnType<typeof parseResult> };

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
export function EvalRunner({ bots, files, defaultModel, lastBotByFile }: Props) {
  const router = useRouter();
  const [file, setFile] = useState(files[0]?.value ?? "1");
  const [bot, setBot] = useState(() => pickBot(files[0], bots, lastBotByFile));
  const [categories, setCategories] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [effort, setEffort] = useState("");
  const [classifier, setClassifier] = useState("");
  const [runs, setRuns] = useState(3);
  const [output, setOutput] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress[]>([]);
  const abort = useRef<AbortController | null>(null);
  const pre = useRef<HTMLPreElement | null>(null);

  const all = file === ALL_FILES;
  const plan = all ? planAll(files, bots, lastBotByFile) : [];
  const totalCases = plan.filter((p) => p.bot).reduce((t, p) => t + p.count, 0);
  const fileInfo = files.find((f) => f.value === file);
  const available = all ? [] : (fileInfo?.categories ?? []);
  // casos escritos para um bot de teste rodando em outro bot: o resultado não vale
  const chosen = bots.find((b) => b.id === bot);
  const wrongBot = fileInfo?.forBot && !(chosen && matchesHint(chosen, fileInfo.forBot)) ? fileInfo.forBot : null;
  const chosenModel = model === "outro" ? customModel.trim() : model;

  useEffect(() => {
    if (pre.current) pre.current.scrollTop = pre.current.scrollHeight;
  }, [output]);

  /** Uma rodada da /api/eval, com o relatório entrando na tela à medida que chega. Devolve o texto inteiro. */
  async function runOne(botId: string, casos: string, cats: string[], signal: AbortSignal): Promise<string> {
    const q = new URLSearchParams({ bot: botId, casos, n: String(runs) });
    for (const c of cats) q.append("categoria", c);
    if (chosenModel) q.set("model", chosenModel);
    if (effort) q.set("esforco", effort);
    if (classifier) q.set("classificador", classifier);
    const res = await fetch(`/api/eval?${q}`, { signal, cache: "no-store" });
    if (!res.ok || !res.body) {
      const text = `Erro ${res.status}: ${await res.text()}`;
      setOutput((o) => o + text);
      throw new Error(text);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let text = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = dec.decode(value, { stream: true });
      text += chunk;
      setOutput((o) => o + chunk);
    }
    return text;
  }

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!all && !bot) return;
    setOutput("");
    setRunning(true);
    abort.current = new AbortController();
    const signal = abort.current.signal;
    try {
      if (!all) {
        setProgress([]);
        await runOne(bot, file, categories, signal);
        return;
      }
      // todos os arquivos, um depois do outro (cada um fica salvo no histórico)
      const items: Progress[] = plan.map((p) => ({ ...p, status: p.bot ? "fila" : "pulado", result: null }));
      setProgress(items);
      const update = (i: number, patch: Partial<Progress>) => setProgress((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
      for (const [i, p] of items.entries()) {
        if (!p.bot) continue;
        if (signal.aborted) {
          update(i, { status: "parado" });
          continue;
        }
        update(i, { status: "rodando" });
        setOutput((o) => `${o}${o ? "\n\n" : ""}━━━━━━━━ ${p.label} · ${p.botLabel} ━━━━━━━━\n`);
        try {
          const text = await runOne(p.bot, p.file, [], signal);
          update(i, { status: "feito", result: parseResult(text) });
        } catch (err) {
          update(i, { status: (err as Error).name === "AbortError" ? "parado" : "erro" });
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") setOutput((o) => `${o}\n\nERRO: ${(err as Error).message}`);
    } finally {
      if (signal.aborted) setOutput((o) => `${o}\n\n(parado)`);
      setRunning(false);
      abort.current = null;
      router.refresh();
    }
  }

  const done = progress.filter((p) => p.result);
  const sum = done.reduce((t, p) => ({ passed: t.passed + p.result!.passed, total: t.total + p.result!.total }), { passed: 0, total: 0 });

  const toggle = (c: string) => setCategories((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]));

  return (
    <section className="card flex flex-col gap-4 p-5">
      <form onSubmit={run} className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <label htmlFor="ev-bot" className="label">Chatbot</label>
            {all ? (
              <p className="input bg-panel text-muted">Cada arquivo roda no bot para o qual foi escrito</p>
            ) : (
              <select id="ev-bot" value={bot} onChange={(e) => setBot(e.target.value)} className="input">
                {bots.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
              </select>
            )}
          </div>
          <div>
            <label htmlFor="ev-file" className="label">Casos</label>
            <select id="ev-file" value={file} onChange={(e) => { setFile(e.target.value); setCategories([]); setProgress([]); if (e.target.value !== ALL_FILES) setBot(pickBot(files.find((f) => f.value === e.target.value), bots, lastBotByFile)); }} className="input">
              <option value={ALL_FILES}>Todos os arquivos ({files.reduce((t, f) => t + f.count, 0)} casos)</option>
              {files.map((f) => <option key={f.value} value={f.value}>{f.label} ({f.count})</option>)}
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

        {all && (
          <div className="rounded-lg border border-line bg-panel px-3 py-2 text-sm">
            <p>
              {totalCases} casos × {runs} {runs === 1 ? "rodada" : "rodadas"} = {totalCases * runs} respostas, um arquivo depois do outro (de {Math.max(1, Math.round((totalCases * runs) / 70))} a {Math.max(2, Math.round((totalCases * runs) / 35))} min; mantenha esta aba aberta). Cada arquivo fica salvo no histórico.
            </p>
            {plan.some((p) => !p.bot) && (
              <p className="mt-1 text-amber-ink">
                Sem o bot de teste, ficam de fora: {plan.filter((p) => !p.bot).map((p) => p.label).join(", ")}.
              </p>
            )}
          </div>
        )}

        {!all && wrongBot && (
          <p className="rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink">
            Estes casos foram escritos para o bot <strong>{wrongBot}</strong> (eles conferem preços e itens do cardápio dele). Com outro bot, o resultado não vale.
          </p>
        )}

        {!all && <fieldset className="flex flex-col gap-2">
          <legend className="label">Categorias {categories.length ? `(${categories.length} escolhidas)` : "(todas)"}</legend>
          <div className="flex flex-wrap gap-2">
            {available.map((c) => (
              <label key={c} className={`cursor-pointer rounded-full border px-3 py-1 text-sm ${categories.includes(c) ? "border-ink bg-ink text-ground" : "border-line bg-panel"}`}>
                <input type="checkbox" className="sr-only" checked={categories.includes(c)} onChange={() => toggle(c)} />
                {c}
              </label>
            ))}
          </div>
        </fieldset>}

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="btn-primary" disabled={running || (!all && !bot) || (all && !totalCases)}>{running ? "Rodando…" : all ? "Rodar todos" : "Rodar avaliação"}</button>
          {running && <button type="button" className="btn-ghost" onClick={() => abort.current?.abort()}>Parar</button>}
          <span className="text-xs text-muted">Gasta IA de verdade (uma resposta por rodada de cada caso). O conjunto inteiro leva de 2 a 4 minutos.</span>
        </div>
      </form>

      {progress.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[560px] text-sm">
            <tbody>
              {progress.map((p) => (
                <tr key={p.file} className="border-b border-line-2 last:border-0">
                  <td className="px-3 py-1.5">{p.label}</td>
                  <td className="px-3 py-1.5 text-xs text-muted">{p.botLabel ?? "bot de teste não encontrado"}</td>
                  <td className={`px-3 py-1.5 text-right text-xs font-semibold ${p.result && (p.result.passed < p.result.total || !p.result.mustOk) ? "text-danger" : ""}`}>
                    {p.result ? `${p.result.passed}/${p.result.total}${p.result.mustOk ? "" : " · obrigatório falhou"}` : { fila: "na fila", rodando: "rodando…", feito: "feito", erro: "erro", pulado: "pulado", parado: "parado" }[p.status]}
                  </td>
                </tr>
              ))}
              {done.length > 0 && (
                <tr className="bg-panel font-semibold">
                  <td className="px-3 py-1.5" colSpan={2}>Total ({done.length} de {progress.filter((p) => p.bot).length} arquivos)</td>
                  <td className="px-3 py-1.5 text-right">{sum.passed}/{sum.total}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {output && (
        <pre ref={pre} className="max-h-[560px] overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-ground p-4 text-xs leading-relaxed text-ink">{output}</pre>
      )}
    </section>
  );
}
