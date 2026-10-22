"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import type { ActionRow } from "@/lib/actions";
import { nameFromUrl } from "@/lib/curl-import";
import { SubmitButton } from "@/components/ui/submit-button";
import { SwitchField } from "@/components/ui/setting-row";
import { validateWithin } from "@/components/ui/form-errors";
import { CurlImportButton, HeadersBuilder, PARAM_TYPE_LABEL, ParamsBuilder } from "@/components/integrations/params-builder";
import { cn } from "@/lib/utils";

/*
 * Os campos de uma ação (redesenho, etapa 5, a pedido do usuário em 22/10: "muitas informações").
 * A ação nova é um assistente em 4 etapas (endereço, o que faz, dados, revisar), com o cURL logo na
 * primeira; a ação que já existe abre em abas (Básico, Parâmetros, Avançado). Os campos ficam todos
 * montados (só escondidos), então o Salvar manda tudo, como antes.
 */

/** Opções em cartões (um rádio por cartão), com a explicação de cada uma. */
function RadioCards({ name, defaultValue, options }: { name: string; defaultValue: string; options: Array<{ value: string; label: string; hint: string }> }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map((o) => (
        <label key={o.value} className="flex cursor-pointer items-start gap-2.5 rounded-[14px] border border-line p-3 transition-colors duration-[120ms] hover:border-line-strong has-checked:border-brand has-checked:bg-brand-soft/60">
          <input type="radio" name={name} value={o.value} defaultChecked={defaultValue === o.value} className="mt-1 accent-brand" />
          <span>
            <span className="block text-sm font-medium text-ink">{o.label}</span>
            <span className="mt-0.5 block text-xs leading-snug text-muted">{o.hint}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

const TYPE_OPTIONS = [
  { value: "query", label: "Consulta", hint: "Só lê: a IA chama na hora (status do pedido, agenda, saldo)." },
  { value: "execute", label: "Executa", hint: "Cria, altera ou cancela: só depois do Confirmar do contato." },
];

function UrlField({ a, p, onUrl }: { a?: ActionRow; p: string; onUrl?: (url: string) => void }) {
  return (
    <div>
      <label className="label" htmlFor={`url-${p}`}>Endereço (HTTPS)</label>
      <input id={`url-${p}`} name="url" type="url" required defaultValue={a?.url ?? ""} onInput={(e) => onUrl?.(e.currentTarget.value)} className="input" placeholder="https://api.loja.com/boavoz/cardapio" />
    </div>
  );
}

function NameField({ a, p }: { a?: ActionRow; p: string }) {
  return (
    <div>
      <label className="label" htmlFor={`name-${p}`}>Nome (snake_case)</label>
      <input id={`name-${p}`} name="name" required defaultValue={a?.name ?? ""} className="input font-mono" placeholder="buscar_cardapio" />
    </div>
  );
}

function DescriptionField({ a, p }: { a?: ActionRow; p: string }) {
  return (
    <div>
      <label className="label" htmlFor={`desc-${p}`}>Quando a IA deve chamar (ela lê esta descrição para decidir)</label>
      <textarea id={`desc-${p}`} name="description" required rows={3} maxLength={500} defaultValue={a?.description ?? ""} className="input" placeholder="Use quando o cliente perguntar o que tem no cardápio, preços ou se um prato está disponível." />
    </div>
  );
}

/** O que poucas ações precisam: quem pode usar, contexto, só no roteiro, resultados, prévia e cabeçalhos. */
function AdvancedFields({ a, p, savedHeaders }: { a?: ActionRow; p: string; savedHeaders: string[] }) {
  return (
    <>
      <div>
        <label className="label" htmlFor={`level-${p}`}>Quem pode usar</label>
        <select id={`level-${p}`} name="min_level" defaultValue={a?.min_level ?? "anonimo"} className="input">
          <option value="anonimo">Qualquer contato</option>
          <option value="canal">Telefone conhecido no WhatsApp</option>
          <option value="usuario">Identificado pela empresa</option>
        </select>
      </div>
      <SwitchField name="context_required" value="signed" defaultChecked={a?.context_required === "signed"} label="Exige a conta da pessoa (workspace, loja)" hint="A ação só aparece com a conta da pessoa: token, pareamento ou roteiro." />
      <SwitchField name="routine_only" defaultChecked={a?.routine_only ?? false} label="Só no roteiro" hint="A IA só usa esta ação no passo de um roteiro ligado." />
      <SwitchField name="supports_preview" defaultChecked={a?.supports_preview ?? false} label={<>Aceita prévia (mode: &quot;preview&quot;)</>} hint={<>Só se o endpoint não cria nada com mode: &quot;preview&quot; e devolve confirmation {"{summary, items, total_cents}"} para o resumo do Confirmar.</>} />
      <div>
        <label className="label" htmlFor={`out-${p}`}>Resultados possíveis (para os roteiros)</label>
        <input id={`out-${p}`} name="outcomes" defaultValue={a?.outcomes?.join(", ") ?? ""} className="input font-mono" placeholder="encontrado, nao_encontrado" />
        <p className="mt-1 text-xs text-muted">Separados por vírgula. Nos roteiros, cada resultado leva a um caminho.</p>
      </div>
      <div className="flex flex-col gap-2">
        <span className="label mb-0">Cabeçalhos</span>
        <HeadersBuilder saved={savedHeaders} />
      </div>
    </>
  );
}

/** Quantos ajustes avançados estão fora do padrão (no rótulo da aba). */
function advancedCount(a: ActionRow | undefined, savedHeaders: string[]): number {
  if (!a) return 0;
  return [a.min_level !== "anonimo", a.context_required === "signed", a.routine_only, a.supports_preview, a.outcomes.length > 0, savedHeaders.length > 0].filter(Boolean).length;
}

/** Ouve o "mostre esta aba/etapa" de ui/form-errors (campo com erro escondido). */
function usePanelEvent(ref: React.RefObject<HTMLElement | null>, onPanel: (key: string) => void) {
  const handler = useRef(onPanel);
  useEffect(() => {
    handler.current = onPanel;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const listen = (e: Event) => handler.current(String((e as CustomEvent<string>).detail));
    el.addEventListener("bv-panel", listen);
    return () => el.removeEventListener("bv-panel", listen);
  }, [ref]);
}

const TABS = [
  ["basico", "Básico"],
  ["parametros", "Parâmetros"],
  ["avancado", "Avançado"],
] as const;

/** A ação que já existe, em abas. */
export function ActionFieldsBody({ a, savedHeaders = [] }: { a?: ActionRow; savedHeaders?: string[] }) {
  const p = a?.id ?? "nova";
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("basico");
  const root = useRef<HTMLDivElement>(null);
  usePanelEvent(root, (k) => setTab(k as typeof tab));
  const params = Object.keys(a?.params_schema?.properties ?? {}).length;
  const adv = advancedCount(a, savedHeaders);
  return (
    <div ref={root} className="flex flex-col gap-4">
      <div role="tablist" aria-label="Partes da ação" className="flex gap-1 rounded-[12px] bg-raised/60 p-1">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("flex-1 rounded-[9px] px-3 py-1.5 text-sm font-medium transition-colors duration-[120ms]", tab === k ? "bg-panel text-ink shadow-[inset_0_0_0_1px_var(--color-line)]" : "text-muted hover:text-ink")}>
            {label}
            {k === "parametros" && params > 0 ? <span className="ml-1 text-xs text-muted">({params})</span> : null}
            {k === "avancado" && adv > 0 ? <span className="ml-1 text-xs text-brand">· {adv} {adv === 1 ? "ligado" : "ligados"}</span> : null}
          </button>
        ))}
      </div>
      <div data-panel="basico" hidden={tab !== "basico"} className="flex flex-col gap-3">
        <div className="flex justify-end">
          <CurlImportButton />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <NameField a={a} p={p} />
          <UrlField a={a} p={p} />
        </div>
        <DescriptionField a={a} p={p} />
        <RadioCards name="type" defaultValue={a?.type ?? "query"} options={TYPE_OPTIONS} />
        <SwitchField name="active" defaultChecked={a ? a.active : true} label="Ativa" hint="Desativada, a IA não chama esta ação." className="rounded-[14px] border border-line px-4 py-3" />
      </div>
      <div data-panel="parametros" hidden={tab !== "parametros"} className="flex flex-col gap-3">
        <ParamsBuilder initial={a?.params_schema ?? null} />
      </div>
      <div data-panel="avancado" hidden={tab !== "avancado"} className="flex flex-col gap-3">
        <AdvancedFields a={a} p={p} savedHeaders={savedHeaders} />
      </div>
    </div>
  );
}

const STEPS = [
  ["endereco", "Endereço"],
  ["faz", "O que faz"],
  ["dados", "Dados"],
  ["revisar", "Revisar"],
] as const;

type Review = { name: string; url: string; description: string; type: string; params: Array<{ name: string; type: string; required: boolean }> };

/**
 * A ação nova num assistente: uma etapa por vez, com o Continuar conferindo só a etapa. Vai num
 * EditDialog com footer "none" (o rodapé é daqui) e o formulário do modal.
 */
export function ActionWizard() {
  const p = "nova";
  const [step, setStep] = useState(0);
  const [review, setReview] = useState<Review | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const panels = useRef<Record<string, HTMLDivElement | null>>({});
  usePanelEvent(root, (k) => setStep(Math.max(0, STEPS.findIndex(([key]) => key === k))));

  const formOf = () => root.current?.closest("form") ?? null;
  const next = () => {
    const panel = panels.current[STEPS[step][0]];
    if (panel && !validateWithin(panel)) return;
    if (step === STEPS.length - 2) {
      // a revisão lê o que está no formulário agora
      const form = formOf();
      if (form) {
        const fd = new FormData(form);
        let params: Review["params"] = [];
        try {
          const schema = JSON.parse(String(fd.get("params_schema") ?? "{}")) as { properties?: Record<string, { type: string }>; required?: string[] };
          params = Object.entries(schema.properties ?? {}).map(([name, v]) => ({ name, type: v.type, required: (schema.required ?? []).includes(name) }));
        } catch {
          params = [];
        }
        setReview({ name: String(fd.get("name") ?? ""), url: String(fd.get("url") ?? ""), description: String(fd.get("description") ?? ""), type: String(fd.get("type") ?? "query"), params });
      }
    }
    setStep((n) => Math.min(STEPS.length - 1, n + 1));
  };
  // o nome acompanha o endereço enquanto a pessoa não escreve outro
  const suggested = useRef("");
  const suggestName = (url: string) => {
    const name = formOf()?.elements.namedItem("name");
    if (!(name instanceof HTMLInputElement) || (name.value.trim() && name.value !== suggested.current)) return;
    suggested.current = nameFromUrl(url);
    name.value = suggested.current;
  };

  return (
    <div ref={root} className="flex flex-1 flex-col gap-4">
      <ol className="flex items-center gap-1.5" aria-label="Etapas">
        {STEPS.map(([k, label], i) => (
          <li key={k} className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className={cn("tabular flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold", i < step ? "bg-brand text-on-brand" : i === step ? "bg-brand-soft text-brand ring-1 ring-brand" : "bg-raised text-muted")}>{i < step ? <Check size={13} strokeWidth={3} /> : i + 1}</span>
            <span className={cn("hidden truncate text-xs font-medium sm:block", i === step ? "text-ink" : "text-muted")}>{label}</span>
            {i < STEPS.length - 1 && <span className="h-px min-w-3 flex-1 bg-line" />}
          </li>
        ))}
      </ol>

      <div ref={(el) => void (panels.current.endereco = el)} data-panel="endereco" hidden={step !== 0} className="flex flex-col gap-3">
        <p className="text-sm text-ink-2">Onde o BoaVoz chama o sistema do cliente.</p>
        <CurlImportButton big />
        <UrlField p={p} onUrl={suggestName} />
        <NameField p={p} />
        <p className="-mt-1 text-xs text-muted">O nome é como a ação aparece aqui e nos roteiros (letras minúsculas e _).</p>
      </div>

      <div ref={(el) => void (panels.current.faz = el)} data-panel="faz" hidden={step !== 1} className="flex flex-col gap-3">
        <DescriptionField p={p} />
        <RadioCards name="type" defaultValue="query" options={TYPE_OPTIONS} />
      </div>

      <div ref={(el) => void (panels.current.dados = el)} data-panel="dados" hidden={step !== 2} className="flex flex-col gap-3">
        <p className="text-sm text-ink-2">Os dados que a IA manda para a ação (o número do pedido, o CEP…). Sem dados, pule esta etapa.</p>
        <ParamsBuilder initial={null} />
      </div>

      <div ref={(el) => void (panels.current.revisar = el)} data-panel="revisar" hidden={step !== 3} className="flex flex-col gap-3">
        {review && (
          <div className="flex flex-col gap-2 rounded-[14px] border border-line bg-raised/40 p-4 text-sm">
            <p>
              <span className="font-mono font-semibold text-ink">{review.name || "(sem nome)"}</span> · {review.type === "execute" ? "Executa (com Confirmar)" : "Consulta"}
            </p>
            <p className="break-all font-mono text-xs text-muted">{review.url}</p>
            <p className="text-ink-2">
              <span className="text-muted">A IA chama quando: </span>
              {review.description}
            </p>
            <p className="text-ink-2">
              <span className="text-muted">Manda: </span>
              {review.params.length ? review.params.map((x) => `${x.name} (${PARAM_TYPE_LABEL[x.type as keyof typeof PARAM_TYPE_LABEL] ?? x.type}${x.required ? ", obrigatório" : ""})`).join(", ") : "nenhum dado"}
            </p>
          </div>
        )}
        <SwitchField name="active" defaultChecked label="Ativa" hint="Desativada, a IA não chama esta ação." className="rounded-[14px] border border-line px-4 py-3" />
        <details className="group/adv rounded-[14px] border border-line px-4 py-3">
          <summary className="cursor-pointer list-none text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
            Opções avançadas <span className="font-normal text-muted">· quem pode usar, cabeçalhos, só no roteiro…</span>
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            <AdvancedFields p={p} savedHeaders={[]} />
          </div>
        </details>
        <p className="text-xs text-muted">Depois de criar, use o Testar da lista para conferir com o sistema do cliente.</p>
      </div>

      <div className="sticky bottom-0 z-10 -mx-5 -mb-5 mt-auto flex flex-wrap items-center gap-2 border-t border-line-2 bg-panel px-5 py-3 sm:-mx-6 sm:px-6">
        <button type="button" onClick={() => root.current?.closest("dialog")?.dispatchEvent(new Event("bv-cancel"))} className="btn-ghost mr-auto">
          Cancelar
        </button>
        {step > 0 && (
          <button type="button" onClick={() => setStep((n) => n - 1)} className="btn-ghost">
            <ArrowLeft size={15} /> Voltar
          </button>
        )}
        {step < STEPS.length - 1 ? (
          <button type="button" onClick={next} className="btn-primary px-5">
            Continuar <ArrowRight size={15} />
          </button>
        ) : (
          <SubmitButton className="btn-primary px-5" pendingLabel="Criando (classificando o efeito)…">
            Criar ação
          </SubmitButton>
        )}
      </div>
    </div>
  );
}
