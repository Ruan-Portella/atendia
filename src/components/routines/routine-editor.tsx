"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import type { ActionResult } from "@/lib/action-result";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { cn } from "@/lib/utils";
import {
  DATA_KINDS,
  DATA_KIND_LABEL,
  FIXED_RESULTS,
  OPTION_TITLE_MAX,
  OPTIONS_PER_STEP,
  RESULT_LABEL,
  ROUTINE_TEMPLATES,
  STEP_TEXT_MAX,
  STEP_TYPES,
  STEP_TYPE_LABEL,
  STEPS_PER_ROUTINE,
  defaultResults,
  newStepId,
  templateFor,
  type DataKind,
  type Destination,
  type RoutineInput,
  type RoutineStep,
  type RoutineTemplateId,
  type StepType,
} from "@/lib/routines";

type ActionInfo = { name: string; outcomes: string[]; active: boolean };

/** Roteiro novo: um passo de instrução (id fixo, para o HTML do servidor e do navegador baterem). */
const blank = (): RoutineInput => ({ name: "", when_to_use: "", keywords: [], steps: [{ id: "inicio01", type: "instrucao", text: "", next: { to: "proximo" } }], active: true, template: null });

const encode = (d: Destination) => (d.to === "passo" ? `passo:${d.step}` : d.to);
const decode = (v: string): Destination => (v.startsWith("passo:") ? { to: "passo", step: v.slice(6) } : { to: v as "proximo" | "encerrar" | "atendente" });
const short = (t: string) => (t.length > 40 ? `${t.slice(0, 40)}…` : t);

/** Nome de variável sugerido para cada tipo de dado. */
const VARIABLE_HINT: Record<DataKind, string> = { cpf: "cpf", cnpj: "cnpj", cpf_cnpj: "documento", email: "email", telefone: "telefone", cep: "cep", data: "data", numero: "numero", regex: "codigo" };

const TEXT_LABEL: Record<StepType, string> = {
  instrucao: "O que a IA diz ou pergunta neste passo",
  dado: "Como a IA pede o dado",
  botoes: "O que a IA pergunta antes dos botões",
  acao: "O que a IA faz com o resultado da ação",
  foto: "Como a IA pede a foto",
};

function DestinationSelect({ id, value, onChange, steps, self, allowSelf }: { id: string; value: Destination; onChange: (d: Destination) => void; steps: RoutineStep[]; self: string; allowSelf: boolean }) {
  return (
    <select id={id} className="input" value={encode(value)} onChange={(e) => onChange(decode(e.target.value))}>
      <option value="proximo">Seguir para o próximo passo</option>
      {steps.map((s, i) =>
        s.id === self && !allowSelf ? null : (
          <option key={s.id} value={`passo:${s.id}`}>
            {s.id === self ? `Repetir este passo (${i + 1})` : `Ir para o passo ${i + 1}${s.text ? `: ${short(s.text)}` : ""}`}
          </option>
        ),
      )}
      <option value="encerrar">Encerrar o roteiro</option>
      <option value="atendente">Chamar atendente</option>
    </select>
  );
}

/** O mesmo passo com outro tipo: guarda o id e o texto. */
function retype(s: RoutineStep, type: StepType, actions: ActionInfo[]): RoutineStep {
  const base = { id: s.id, text: s.text };
  if (type === "instrucao") return { ...base, type, next: { to: "proximo" } };
  if (type === "dado") return { ...base, type, kind: "cpf", variable: "cpf", pattern: null, next: { to: "proximo" } };
  if (type === "botoes")
    return {
      ...base,
      type,
      variable: null,
      options: [
        { title: "Sim", next: { to: "proximo" } },
        { title: "Não", next: { to: "atendente" } },
      ],
    };
  if (type === "foto") return { ...base, type, variable: "foto", next: { to: "proximo" } };
  const first = actions.find((a) => a.active) ?? actions[0];
  return { ...base, type, action: first?.name ?? "", results: defaultResults(first?.outcomes) };
}

/**
 * Editor de um roteiro (B2', parte 1): nome, quando usar, palavras-chave e os passos. Manda o
 * roteiro inteiro em JSON (campo "routine"); a validação de verdade é a do servidor
 * (routineProblem), com as mesmas mensagens.
 */
export function RoutineEditor({
  action,
  initial,
  actions,
  integrations,
  label,
  withTemplates = false,
  sectors = [],
}: {
  action: (fd: FormData) => Promise<ActionResult>;
  initial?: RoutineInput;
  actions: ActionInfo[];
  integrations: boolean;
  label: string;
  withTemplates?: boolean;
  /** os setores do cliente do chatbot (Caixa de entrada, parte 4), para sugerir no campo */
  sectors?: string[];
}) {
  const p = (initial as { id?: string } | undefined)?.id ?? "novo";
  const [r, setR] = useState<RoutineInput>(() => (initial ? structuredClone({ name: initial.name, when_to_use: initial.when_to_use, keywords: initial.keywords, steps: initial.steps, active: initial.active, template: initial.template, handoff_sector: initial.handoff_sector ?? null }) : blank()));
  const [keywords, setKeywords] = useState(() => (initial?.keywords ?? []).map((k) => k.toUpperCase()).join(", "));

  const setSteps = (fn: (steps: RoutineStep[]) => RoutineStep[]) => setR((cur) => ({ ...cur, steps: fn(cur.steps) }));
  const patchStep = (i: number, patch: Partial<RoutineStep>) => setSteps((steps) => steps.map((s, j) => (j === i ? ({ ...s, ...patch } as RoutineStep) : s)));
  const move = (i: number, dir: -1 | 1) =>
    setSteps((steps) => {
      const j = i + dir;
      if (j < 0 || j >= steps.length) return steps;
      const next = [...steps];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  // o destino que apontava para o passo apagado volta a ser "próximo passo"
  const remove = (i: number) =>
    setSteps((steps) => {
      const gone = steps[i].id;
      const fix = (d: Destination): Destination => (d.to === "passo" && d.step === gone ? { to: "proximo" } : d);
      return steps
        .filter((_, j) => j !== i)
        .map((s) => {
          if (s.type === "instrucao" || s.type === "dado" || s.type === "foto") return { ...s, next: fix(s.next) };
          if (s.type === "botoes") return { ...s, options: s.options.map((o) => ({ ...o, next: fix(o.next) })) };
          return { ...s, results: Object.fromEntries(Object.entries(s.results).map(([k, d]) => [k, fix(d)])) };
        });
    });
  const pick = (id: RoutineTemplateId) => {
    const t = templateFor(id, actions);
    setR(t);
    setKeywords(t.keywords.map((k) => k.toUpperCase()).join(", "));
  };
  const reset = () => {
    setR(blank());
    setKeywords("");
  };

  const payload = JSON.stringify({ ...r, keywords: keywords.split(/[,;\n]/).map((k) => k.trim()).filter(Boolean) });
  const chosen = ROUTINE_TEMPLATES.find((t) => t.id === r.template);

  return (
    <ActionForm action={action} onSuccess={initial ? undefined : reset} className="flex flex-col gap-4">
      {withTemplates && (
        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold text-muted">Comece por um modelo pronto (dá para mudar tudo depois):</div>
          <div className="flex flex-wrap gap-2">
            {ROUTINE_TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => pick(t.id)}
                title={t.summary}
                className={cn("rounded-full border px-3 py-1 text-xs", r.template === t.id ? "border-brand bg-brand-soft text-brand" : "border-line hover:border-brand")}
              >
                {t.label}
                {t.actionHint ? " · com ação" : ""}
              </button>
            ))}
            <button type="button" onClick={reset} className={cn("rounded-full border px-3 py-1 text-xs", !r.template ? "border-brand bg-brand-soft text-brand" : "border-line hover:border-brand")}>
              Do zero
            </button>
          </div>
          {chosen && (
            <p className="text-xs text-muted">
              {chosen.summary}
              {chosen.actionHint && ` Escolha no passo de ação a ação do sistema do cliente (por exemplo, ${chosen.actionHint}), cadastrada na aba Ações.`}
              {chosen.actionHint && !integrations && " Passo com ação faz parte do pacote Integrações."}
            </p>
          )}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`rname-${p}`}>Nome</label>
          <input id={`rname-${p}`} required maxLength={60} value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} className="input" placeholder="Segunda via" />
        </div>
        <div>
          <label className="label" htmlFor={`rkw-${p}`}>Palavras-chave (opcional, separadas por vírgula)</label>
          <input id={`rkw-${p}`} value={keywords} onChange={(e) => setKeywords(e.target.value)} className="input" placeholder="2VIA, SEGUNDA VIA" />
        </div>
      </div>
      <div>
        <label className="label" htmlFor={`rwhen-${p}`}>Quando usar (é por aqui que a IA reconhece o assunto)</label>
        <textarea id={`rwhen-${p}`} required rows={2} maxLength={500} value={r.when_to_use} onChange={(e) => setR({ ...r, when_to_use: e.target.value })} className="input" placeholder="O cliente pede segunda via de boleto, conta ou fatura." />
        <p className="mt-1 text-xs text-muted">A mensagem que é só uma palavra-chave começa o roteiro na hora, sem diferença de maiúsculas e acentos.</p>
      </div>
      <div>
        <label className="label" htmlFor={`rsector-${p}`}>Setor da equipe (opcional)</label>
        <input id={`rsector-${p}`} list={`rsectors-${p}`} maxLength={40} value={r.handoff_sector ?? ""} onChange={(e) => setR({ ...r, handoff_sector: e.target.value || null })} className="input max-w-[320px]" placeholder={sectors[0] ?? "Financeiro"} />
        <datalist id={`rsectors-${p}`}>
          {sectors.map((s) => <option key={s} value={s} />)}
        </datalist>
        <p className="mt-1 text-xs text-muted">Quando este roteiro passa a conversa para a equipe, ela vai para este setor do cliente (pelo nome). Vazio, ou sem setor com esse nome, segue a triagem de sempre.</p>
      </div>

      <div className="flex flex-col gap-3">
        {r.steps.map((s, i) => (
          <div key={s.id} className="rounded-xl border border-line p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">Passo {i + 1}</span>
              <select aria-label={`Tipo do passo ${i + 1}`} className="input w-auto py-1 text-sm" value={s.type} onChange={(e) => setSteps((steps) => steps.map((x, j) => (j === i ? retype(x, e.target.value as StepType, actions) : x)))}>
                {STEP_TYPES.map((t) => (
                  <option key={t} value={t} disabled={t === "acao" && !integrations && s.type !== "acao"}>
                    {t === "acao" && !integrations ? `${STEP_TYPE_LABEL[t]} (pacote Integrações)` : STEP_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
              <div className="ml-auto flex items-center gap-1">
                <button type="button" className="btn-ghost p-1.5" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Subir o passo ${i + 1}`}>
                  <ArrowUp size={14} />
                </button>
                <button type="button" className="btn-ghost p-1.5" onClick={() => move(i, 1)} disabled={i === r.steps.length - 1} aria-label={`Descer o passo ${i + 1}`}>
                  <ArrowDown size={14} />
                </button>
                <button type="button" className="btn-ghost p-1.5 text-danger" onClick={() => remove(i)} disabled={r.steps.length === 1} aria-label={`Apagar o passo ${i + 1}`}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>

            <label className="label" htmlFor={`rtext-${p}-${s.id}`}>{TEXT_LABEL[s.type]}</label>
            <textarea id={`rtext-${p}-${s.id}`} rows={2} maxLength={STEP_TEXT_MAX} value={s.text} onChange={(e) => patchStep(i, { text: e.target.value })} className="input" />

            {s.type === "dado" && (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor={`rkind-${p}-${s.id}`}>Tipo do dado</label>
                  <select
                    id={`rkind-${p}-${s.id}`}
                    className="input"
                    value={s.kind}
                    onChange={(e) => {
                      const kind = e.target.value as DataKind;
                      const variable = !s.variable || s.variable === VARIABLE_HINT[s.kind] ? VARIABLE_HINT[kind] : s.variable;
                      patchStep(i, { kind, variable, pattern: kind === "regex" ? (s.pattern ?? "") : null } as Partial<RoutineStep>);
                    }}
                  >
                    {DATA_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {DATA_KIND_LABEL[k]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor={`rvar-${p}-${s.id}`}>Guardar na variável</label>
                  <input id={`rvar-${p}-${s.id}`} value={s.variable} onChange={(e) => patchStep(i, { variable: e.target.value.trim() } as Partial<RoutineStep>)} className="input font-mono" placeholder="documento" />
                </div>
                {s.kind === "regex" && (
                  <div className="sm:col-span-2">
                    <label className="label" htmlFor={`rpat-${p}-${s.id}`}>Formato (regex)</label>
                    <input id={`rpat-${p}-${s.id}`} value={s.pattern ?? ""} onChange={(e) => patchStep(i, { pattern: e.target.value } as Partial<RoutineStep>)} className="input font-mono" placeholder="[A-Za-z0-9-]{4,20}" />
                  </div>
                )}
                <p className="text-xs text-muted sm:col-span-2">
                  O BoaVoz confere o dado (o dígito verificador, no CPF e no CNPJ) e pede de novo até 3 vezes; depois, oferece atendente ou cancelar.
                </p>
                <label className="flex items-start gap-2 text-xs text-muted sm:col-span-2">
                  <input type="checkbox" className="mt-0.5" checked={s.skip_identified === true} onChange={(e) => patchStep(i, { skip_identified: e.target.checked || undefined } as Partial<RoutineStep>)} />
                  <span>Pular se a pessoa já estiver identificada (número lembrado e confirmado, ou conta conectada). Use nos dados que servem só para identificar, como o CPF.</span>
                </label>
              </div>
            )}

            {s.type === "botoes" && (
              <div className="mt-2 flex flex-col gap-2">
                {s.options.map((o, k) => (
                  // no celular: texto e apagar numa linha, o destino embaixo; da tela média para cima, tudo numa linha
                  <div key={k} className="grid grid-cols-[1fr_auto] items-center gap-2 border-b border-line-2 pb-2 last:border-0 sm:grid-cols-[1fr_1.4fr_auto] sm:border-0 sm:pb-0">
                    <input
                      aria-label={`Texto do botão ${k + 1} do passo ${i + 1}`}
                      maxLength={OPTION_TITLE_MAX}
                      value={o.title}
                      onChange={(e) => patchStep(i, { options: s.options.map((x, m) => (m === k ? { ...x, title: e.target.value } : x)) } as Partial<RoutineStep>)}
                      className="input"
                      placeholder={`Botão ${k + 1}`}
                    />
                    <button type="button" className="btn-ghost p-1.5 text-danger sm:order-3" onClick={() => patchStep(i, { options: s.options.filter((_, m) => m !== k) } as Partial<RoutineStep>)} disabled={s.options.length <= 2} aria-label={`Apagar o botão ${k + 1}`}>
                      <Trash2 size={14} />
                    </button>
                    <div className="col-span-2 sm:order-2 sm:col-span-1">
                      <DestinationSelect id={`ropt-${p}-${s.id}-${k}`} value={o.next} onChange={(d) => patchStep(i, { options: s.options.map((x, m) => (m === k ? { ...x, next: d } : x)) } as Partial<RoutineStep>)} steps={r.steps} self={s.id} allowSelf />
                    </div>
                  </div>
                ))}
                <div className="flex flex-wrap items-center gap-3">
                  {s.options.length < OPTIONS_PER_STEP && (
                    <button type="button" className="text-xs font-semibold text-brand hover:underline" onClick={() => patchStep(i, { options: [...s.options, { title: "", next: { to: "proximo" } }] } as Partial<RoutineStep>)}>
                      + botão
                    </button>
                  )}
                  <label className="flex items-center gap-2 text-xs text-muted" htmlFor={`rbvar-${p}-${s.id}`}>
                    Guardar a escolha na variável (opcional)
                    <input id={`rbvar-${p}-${s.id}`} value={s.variable ?? ""} onChange={(e) => patchStep(i, { variable: e.target.value.trim() || null } as Partial<RoutineStep>)} className="input w-40 py-1 font-mono text-xs" placeholder="motivo" />
                  </label>
                </div>
                <p className="text-xs text-muted">Até 3 viram botões no WhatsApp; de 4 a 10, uma lista. Cada botão tem até {OPTION_TITLE_MAX} caracteres.</p>
              </div>
            )}

            {s.type === "acao" && (
              <div className="mt-2 flex flex-col gap-2">
                <div>
                  <label className="label" htmlFor={`ract-${p}-${s.id}`}>Ação</label>
                  {actions.length ? (
                    <select
                      id={`ract-${p}-${s.id}`}
                      className="input font-mono"
                      value={s.action}
                      onChange={(e) => {
                        const a = actions.find((x) => x.name === e.target.value);
                        const results = defaultResults(a?.outcomes);
                        for (const k of FIXED_RESULTS) if (s.results[k]) results[k] = s.results[k];
                        patchStep(i, { action: e.target.value, results } as Partial<RoutineStep>);
                      }}
                    >
                      <option value="">Escolha a ação</option>
                      {actions.map((a) => (
                        <option key={a.name} value={a.name}>
                          {a.name}
                          {a.active ? "" : " (desativada)"}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-xs text-amber-ink">Nenhuma ação neste chatbot: cadastre na aba Ações.</p>
                  )}
                </div>
                {[...FIXED_RESULTS, ...(actions.find((a) => a.name === s.action)?.outcomes ?? []).filter((o) => !(FIXED_RESULTS as readonly string[]).includes(o))].map((k) => (
                  <div key={k} className="grid items-center gap-2 sm:grid-cols-[1fr_1.4fr]">
                    <label className="text-xs text-muted" htmlFor={`rres-${p}-${s.id}-${k}`}>
                      Quando a ação {RESULT_LABEL[k] ?? `devolve ${k}`}
                    </label>
                    <DestinationSelect id={`rres-${p}-${s.id}-${k}`} value={s.results[k] ?? { to: "atendente" }} onChange={(d) => patchStep(i, { results: { ...s.results, [k]: d } } as Partial<RoutineStep>)} steps={r.steps} self={s.id} allowSelf={false} />
                  </div>
                ))}
                <p className="text-xs text-muted">Os parâmetros com o mesmo nome de uma variável do roteiro vão preenchidos pelo BoaVoz, com o valor conferido.</p>
                <p className="text-xs text-muted">Se a ação devolver <code className="font-mono">identity</code>, a pessoa fica identificada: as próximas ações recebem a conta dela, e no WhatsApp e no Instagram o BoaVoz pede licença para lembrar o número.</p>
                <label className="flex items-start gap-2 text-xs text-muted">
                  <input type="checkbox" className="mt-0.5" checked={s.skip_identified === true} onChange={(e) => patchStep(i, { skip_identified: e.target.checked || undefined } as Partial<RoutineStep>)} />
                  <span>Pular se a pessoa já estiver identificada (segue como se a ação tivesse dado certo). Use na ação que só identifica.</span>
                </label>
              </div>
            )}

            {s.type === "foto" && (
              <div className="mt-2 flex flex-col gap-2">
                <div>
                  <label className="label" htmlFor={`rfvar-${p}-${s.id}`}>Guardar a descrição da foto na variável</label>
                  <input id={`rfvar-${p}-${s.id}`} value={s.variable} onChange={(e) => patchStep(i, { variable: e.target.value.trim() } as Partial<RoutineStep>)} className="input w-56 font-mono" placeholder="foto_roteador" />
                </div>
                <p className="text-xs text-muted">
                  Só no WhatsApp e no Instagram: a IA vê a descrição da foto e segue quando ela mostra o que o passo pede; se não, pede outra. A variável guarda a descrição (vai para a ação que tiver um parâmetro com o mesmo nome). No site, ou com a leitura de fotos desligada (modo dados sensíveis), o passo é pulado. Documento pessoal, cartão, comprovante e foto de saúde não são lidos.
                </p>
              </div>
            )}

            {(s.type === "instrucao" || s.type === "dado" || s.type === "foto") && (
              <div className="mt-2 grid items-center gap-2 sm:grid-cols-[1fr_1.4fr]">
                <label className="text-xs text-muted" htmlFor={`rnext-${p}-${s.id}`}>
                  Depois deste passo
                </label>
                <DestinationSelect id={`rnext-${p}-${s.id}`} value={s.next} onChange={(d) => patchStep(i, { next: d } as Partial<RoutineStep>)} steps={r.steps} self={s.id} allowSelf={false} />
              </div>
            )}
          </div>
        ))}
        {r.steps.length < STEPS_PER_ROUTINE && (
          <button type="button" className="btn-ghost self-start py-1.5 text-sm" onClick={() => setSteps((steps) => [...steps, { id: newStepId(), type: "instrucao", text: "", next: { to: "proximo" } }])}>
            + Passo
          </button>
        )}
        <p className="text-xs text-muted">No último passo, &quot;Seguir para o próximo passo&quot; encerra o roteiro.</p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={r.active} onChange={(e) => setR({ ...r, active: e.target.checked })} /> Ligado (a IA usa este roteiro)
      </label>
      <input type="hidden" name="routine" value={payload} />
      <SubmitButton className="btn-primary self-start">{label}</SubmitButton>
    </ActionForm>
  );
}
