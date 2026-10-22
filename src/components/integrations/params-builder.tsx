"use client";

import { useEffect, useRef, useState } from "react";
import { Braces, Plus, Rows3, Terminal, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { parseCurl, type CurlImport } from "@/lib/curl-import";
import type { ParamsSchema } from "@/lib/actions";
import { cn } from "@/lib/utils";

/*
 * Os parâmetros e os cabeçalhos de uma ação em linhas (redesenho, etapa 5, a pedido do usuário em
 * 22/10: "toda essa parte do JSON"). O que vai para o servidor continua igual: o JSON Schema no
 * campo params_schema e os cabeçalhos em "Nome: valor" no campo headers. Quem prefere o JSON
 * ainda edita direto ("Editar como JSON").
 */

type ParamType = "string" | "number" | "integer" | "boolean" | "array";
type Row = { key: number; name: string; type: ParamType; description: string; required: boolean; options: string };

export const PARAM_TYPE_LABEL: Record<ParamType, string> = { string: "Texto", number: "Número", integer: "Número inteiro", boolean: "Sim ou não", array: "Lista de textos" };
// o mesmo MAX_PARAMS de lib/actions (que não pode vir para o navegador: usa módulos do servidor)
const MAX_PARAMS = 10;
const EMPTY: ParamsSchema = { type: "object", properties: {}, required: [] };
let seq = 0;

/** As linhas de um schema, ou null quando ele usa algo que as linhas não mostram (fica no JSON). */
function rowsOf(schema: ParamsSchema | null | undefined): Row[] | null {
  const props = schema?.properties ?? {};
  const required = schema?.required ?? [];
  const rows: Row[] = [];
  for (const [name, p] of Object.entries(props)) {
    if (!p || typeof p !== "object") return null;
    if (p.type === "array" && p.items?.type !== "string") return null;
    if (!["string", "number", "integer", "boolean", "array"].includes(p.type)) return null;
    const options = p.type === "array" ? p.items?.enum : p.enum;
    rows.push({ key: seq++, name, type: p.type, description: p.description ?? "", required: required.includes(name), options: (options ?? []).join(", ") });
  }
  return rows;
}

function schemaOf(rows: Row[]): ParamsSchema {
  const properties: ParamsSchema["properties"] = {};
  for (const r of rows) {
    const name = r.name.trim();
    if (!name) continue;
    const list = r.options
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
    const values = r.type === "number" || r.type === "integer" ? list.map(Number).filter((n) => Number.isFinite(n)) : list;
    const desc = r.description.trim() ? { description: r.description.trim() } : {};
    if (r.type === "array") properties[name] = { type: "array", ...desc, items: { type: "string", ...(values.length ? { enum: values } : {}) } };
    else properties[name] = { type: r.type, ...desc, ...(values.length && r.type !== "boolean" ? { enum: values } : {}) };
  }
  return { type: "object", properties, required: rows.filter((r) => r.required && r.name.trim()).map((r) => r.name.trim()) };
}

/** Ouve o cURL importado (evento "bv-curl" no formulário em volta, de CurlImportButton). */
function useCurlImport(ref: React.RefObject<HTMLElement | null>, onImport: (imp: CurlImport) => void) {
  const handler = useRef(onImport);
  useEffect(() => {
    handler.current = onImport;
  });
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const listen = (e: Event) => handler.current((e as CustomEvent<CurlImport>).detail);
    form.addEventListener("bv-curl", listen);
    return () => form.removeEventListener("bv-curl", listen);
  }, [ref]);
}

/** Os parâmetros que a IA manda para a ação, em linhas; vai como JSON Schema no campo params_schema. */
export function ParamsBuilder({ initial }: { initial?: ParamsSchema | null }) {
  const [start] = useState(() => rowsOf(initial ?? EMPTY));
  const [mode, setMode] = useState<"rows" | "json">(start ? "rows" : "json");
  const [rows, setRows] = useState<Row[]>(start ?? []);
  const [json, setJson] = useState(() => JSON.stringify(initial ?? EMPTY, null, 2));
  const [problem, setProblem] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useCurlImport(root, (imp) => {
    if (!imp.params.length) return;
    setRows(imp.params.map((p) => ({ key: seq++, name: p.name, type: p.type, description: "", required: false, options: "" })));
    setProblem(null);
    setMode("rows");
  });

  const patch = (key: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const value = mode === "rows" ? JSON.stringify(schemaOf(rows)) : json;

  const toJson = () => {
    setJson(JSON.stringify(schemaOf(rows), null, 2));
    setProblem(null);
    setMode("json");
  };
  const toRows = () => {
    try {
      const back = rowsOf(JSON.parse(json) as ParamsSchema);
      if (!back) return setProblem("Este JSON usa algo que as linhas não mostram (lista que não é de textos, por exemplo): continue no JSON.");
      setRows(back);
      setProblem(null);
      setMode("rows");
    } catch {
      setProblem("O JSON não é válido: corrija para voltar às linhas.");
    }
  };

  return (
    <div ref={root} className="flex flex-col gap-2.5">
      <input type="hidden" name="params_schema" value={value} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">O que a IA manda para a ação (até {MAX_PARAMS}). A descrição é o que a IA lê para preencher.</p>
        <button type="button" onClick={mode === "rows" ? toJson : toRows} className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand hover:underline">
          {mode === "rows" ? <Braces size={13} /> : <Rows3 size={13} />}
          {mode === "rows" ? "Editar como JSON" : "Voltar às linhas"}
        </button>
      </div>
      {problem && <p className="text-xs text-danger">{problem}</p>}
      {mode === "json" ? (
        <textarea aria-label="Parâmetros em JSON Schema" rows={8} value={json} onChange={(e) => setJson(e.target.value)} className="input font-mono text-xs" spellCheck={false} />
      ) : (
        <>
          {rows.length === 0 && <p className="rounded-[12px] border border-dashed border-line-strong px-3 py-3 text-center text-xs text-muted">Sem parâmetros: a IA chama a ação sem mandar dados.</p>}
          {rows.map((r, i) => (
            <div key={r.key} className="flex flex-col gap-2 rounded-[14px] border border-line p-3">
              <div className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1.2fr_1fr_auto_auto] sm:items-end">
                <div>
                  <label className="label" htmlFor={`pname-${r.key}`}>Nome</label>
                  <input id={`pname-${r.key}`} value={r.name} onChange={(e) => patch(r.key, { name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} className="input font-mono" placeholder={i === 0 ? "numero_pedido" : "nome_do_parametro"} maxLength={40} />
                </div>
                <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label={`Apagar o parâmetro ${r.name || i + 1}`} className="btn-icon self-end hover:text-danger sm:order-4 sm:mb-1">
                  <Trash2 size={15} />
                </button>
                <div className="col-span-2 sm:order-2 sm:col-span-1">
                  <label className="label" htmlFor={`ptype-${r.key}`}>Tipo</label>
                  <select id={`ptype-${r.key}`} value={r.type} onChange={(e) => patch(r.key, { type: e.target.value as ParamType })} className="input">
                    {(Object.keys(PARAM_TYPE_LABEL) as ParamType[]).map((t) => (
                      <option key={t} value={t}>
                        {PARAM_TYPE_LABEL[t]}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="col-span-2 flex items-center gap-2 text-xs font-medium text-ink-2 sm:order-3 sm:col-span-1 sm:mb-2.5">
                  <input type="checkbox" role="switch" className="switch" checked={r.required} onChange={(e) => patch(r.key, { required: e.target.checked })} />
                  Obrigatório
                </label>
              </div>
              <div className={cn("grid gap-2", r.type !== "boolean" && "sm:grid-cols-[1.4fr_1fr]")}>
                <div>
                  <label className="label" htmlFor={`pdesc-${r.key}`}>Descrição</label>
                  <input id={`pdesc-${r.key}`} value={r.description} onChange={(e) => patch(r.key, { description: e.target.value })} maxLength={200} className="input" placeholder={i === 0 ? "o número do pedido, ex.: 1042" : "o que é, com um exemplo"} />
                </div>
                {r.type !== "boolean" && (
                  <div>
                    <label className="label" htmlFor={`popt-${r.key}`}>Só estas opções (opcional)</label>
                    <input id={`popt-${r.key}`} value={r.options} onChange={(e) => patch(r.key, { options: e.target.value })} className="input" placeholder="pix, boleto, cartão" />
                  </div>
                )}
              </div>
            </div>
          ))}
          {rows.length < MAX_PARAMS && (
            <button type="button" onClick={() => setRows((rs) => [...rs, { key: seq++, name: "", type: "string", description: "", required: false, options: "" }])} className="inline-flex items-center justify-center gap-1.5 rounded-[14px] border border-dashed border-line-strong px-3 py-2 text-sm font-medium text-ink-2 transition-colors duration-[120ms] hover:border-brand hover:text-brand">
              <Plus size={15} /> Parâmetro
            </button>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Cabeçalhos personalizados (ex.: x-api-key do gateway do cliente) em linhas de nome e valor. Os
 * valores ficam cifrados e nunca voltam à tela: preencher troca todos os guardados; vazio mantém.
 */
export function HeadersBuilder({ saved }: { saved: string[] }) {
  const [rows, setRows] = useState<Array<{ key: number; name: string; value: string }>>([]);
  const root = useRef<HTMLDivElement>(null);
  useCurlImport(root, (imp) => {
    if (imp.headers.length) setRows(imp.headers.map((h) => ({ key: seq++, ...h })));
  });
  const text = rows
    .filter((r) => r.name.trim())
    .map((r) => `${r.name.trim()}: ${r.value}`)
    .join("\n");
  return (
    <div ref={root} className="flex flex-col gap-2.5">
      <input type="hidden" name="headers" value={text} />
      {saved.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-[12px] bg-raised/50 px-3 py-2.5 text-xs text-muted">
          <span>
            Guardados (valores ocultos): <span className="font-mono text-ink-2">{saved.join(", ")}</span>. Preencher abaixo troca todos.
          </span>
          <label className="flex items-center gap-2 font-medium text-ink-2">
            <input type="checkbox" role="switch" name="headers_clear" className="switch" /> Apagar todos os guardados
          </label>
        </div>
      ) : (
        <p className="text-xs text-muted">Vão cifrados e junto da assinatura; os de assinatura, de transporte e o Content-Type são reservados.</p>
      )}
      {rows.map((r) => (
        <div key={r.key} className="grid grid-cols-[1fr_1.4fr_auto] items-center gap-2">
          <input aria-label="Nome do cabeçalho" value={r.name} onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, name: e.target.value } : x)))} className="input font-mono text-xs" placeholder="x-api-key" autoComplete="off" />
          <input aria-label="Valor do cabeçalho" value={r.value} onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, value: e.target.value } : x)))} className="input font-mono text-xs" placeholder="valor" autoComplete="off" />
          <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label="Apagar o cabeçalho" className="btn-icon hover:text-danger">
            <Trash2 size={15} />
          </button>
        </div>
      ))}
      <button type="button" onClick={() => setRows((rs) => [...rs, { key: seq++, name: "", value: "" }])} className="inline-flex items-center gap-1 self-start text-xs font-semibold text-brand hover:underline">
        <Plus size={13} /> Cabeçalho
      </button>
    </div>
  );
}

/** Os parâmetros de um teste, um campo por parâmetro; vai como JSON no campo params. */
export function TestParams({ schema }: { schema: ParamsSchema }) {
  const props = Object.entries(schema.properties ?? {});
  const [values, setValues] = useState<Record<string, string>>({});
  const [json, setJson] = useState<string | null>(props.length ? null : "{}");
  const params: Record<string, unknown> = {};
  for (const [name, p] of props) {
    const v = (values[name] ?? "").trim();
    if (!v) continue;
    if (p.type === "number" || p.type === "integer") params[name] = Number(v);
    else if (p.type === "boolean") params[name] = v === "sim";
    else if (p.type === "array")
      params[name] = v
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
    else params[name] = v;
  }
  if (json !== null)
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <label className="label mb-0" htmlFor="test-json">Parâmetros (JSON)</label>
          {props.length > 0 && (
            <button type="button" onClick={() => setJson(null)} className="text-xs font-semibold text-brand hover:underline">
              Voltar aos campos
            </button>
          )}
        </div>
        <textarea id="test-json" name="params" rows={4} value={json} onChange={(e) => setJson(e.target.value)} className="input font-mono text-xs" spellCheck={false} />
      </div>
    );
  return (
    <div className="flex flex-col gap-2.5">
      <input type="hidden" name="params" value={JSON.stringify(params)} />
      <div className="flex items-center justify-between gap-2">
        <span className="kpi-label">Os dados do teste</span>
        <button type="button" onClick={() => setJson(JSON.stringify(params, null, 2))} className="text-xs font-semibold text-brand hover:underline">
          Editar como JSON
        </button>
      </div>
      {props.map(([name, p]) => {
        const options = p.type === "array" ? undefined : p.enum;
        const id = `tp-${name}`;
        return (
          <div key={name}>
            <label className="label" htmlFor={id}>
              <span className="font-mono">{name}</span>
              {schema.required?.includes(name) ? " (obrigatório)" : ""}
              {p.description ? <span className="font-normal text-muted"> · {p.description}</span> : null}
            </label>
            {p.type === "boolean" || options?.length ? (
              <select id={id} value={values[name] ?? ""} onChange={(e) => setValues({ ...values, [name]: e.target.value })} className="input">
                <option value="">(sem valor)</option>
                {p.type === "boolean" ? (
                  <>
                    <option value="sim">sim</option>
                    <option value="nao">não</option>
                  </>
                ) : (
                  options!.map((o) => (
                    <option key={String(o)} value={String(o)}>
                      {String(o)}
                    </option>
                  ))
                )}
              </select>
            ) : (
              <input id={id} type={p.type === "number" || p.type === "integer" ? "number" : "text"} step={p.type === "integer" ? 1 : "any"} value={values[name] ?? ""} onChange={(e) => setValues({ ...values, [name]: e.target.value })} className="input" placeholder={p.type === "array" ? "separados por vírgula" : undefined} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Importar de um cURL (redesenho, etapa 5): cola o comando que o sistema do cliente documenta e
 * preenche o endereço, o nome (se vazio), os cabeçalhos e os parâmetros do corpo. A descrição de
 * cada parâmetro fica para a pessoa escrever.
 */
export function CurlImportButton() {
  const toast = useToast();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const apply = () => {
    const imp = parseCurl(text);
    if (!imp) return setProblem("Não achei um endereço HTTPS no comando. Cole o cURL inteiro, começando por curl.");
    const form = anchor.current?.closest("form");
    if (form) {
      const url = form.elements.namedItem("url");
      if (url instanceof HTMLInputElement) url.value = imp.url;
      const name = form.elements.namedItem("name");
      if (name instanceof HTMLInputElement && !name.value.trim() && imp.name) name.value = imp.name;
      form.dispatchEvent(new CustomEvent("bv-curl", { detail: imp }));
    }
    toast.success(`Importado: o endereço, ${imp.headers.length} ${imp.headers.length === 1 ? "cabeçalho" : "cabeçalhos"} e ${imp.params.length} ${imp.params.length === 1 ? "parâmetro" : "parâmetros"}. Escreva a descrição de cada um.`);
    setOpen(false);
    setText("");
    setProblem(null);
  };

  return (
    <>
      <button ref={anchor} type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 self-start text-xs font-semibold text-brand hover:underline">
        <Terminal size={13} /> Importar de um cURL
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Importar de um cURL"
        description="Cole o comando da documentação do sistema do cliente. O endereço, os cabeçalhos e os parâmetros do corpo entram nos campos; confira antes de salvar."
        size="lg"
        footer={
          <>
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">
              Cancelar
            </button>
            <button type="button" onClick={apply} disabled={!text.trim()} className="btn-primary">
              Importar
            </button>
          </>
        }
      >
        <textarea
          aria-label="Comando cURL"
          rows={8}
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          className="input font-mono text-xs"
          placeholder={"curl -X POST https://api.loja.com/pedidos/consultar \\\n  -H 'x-api-key: SUA_CHAVE' \\\n  -d '{\"numero_pedido\": \"1042\"}'"}
        />
        {problem && <p className="text-xs text-danger">{problem}</p>}
      </Modal>
    </>
  );
}
