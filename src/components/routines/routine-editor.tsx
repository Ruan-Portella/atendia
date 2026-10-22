"use client";

import { useState } from "react";
import { ArrowDown, ArrowRight, ArrowUp, Camera, ChevronDown, ChevronUp, Copy, GripVertical, MessageSquare, MousePointerClick, Play, Plus, TextCursorInput, Trash2, Zap } from "lucide-react";
import { Menu } from "@/components/ui/menu";
import { Modal } from "@/components/ui/modal";
import { RoutineSimulator } from "@/components/routines/routine-simulator";
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

/** O ícone de cada tipo de passo. */
const STEP_ICON: Record<StepType, React.ComponentType<{ size?: number; className?: string }>> = { instrucao: MessageSquare, dado: TextCursorInput, botoes: MousePointerClick, acao: Zap, foto: Camera };

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
 * Os campos de um roteiro (B2', parte 1; redesenho, etapa 5: no painel lateral, com o Salvar no
 * rodapé do modal): nome, quando usar, palavras-chave e os passos, numa sequência numerada. Manda o
 * roteiro inteiro em JSON (campo "routine"); a validação de verdade é a do servidor
 * (routineProblem), com as mesmas mensagens.
 */
export function RoutineFields({
  initial,
  actions,
  integrations,
  withTemplates = false,
  sectors = [],
}: {
  initial?: RoutineInput;
  actions: ActionInfo[];
  integrations: boolean;
  withTemplates?: boolean;
  /** os setores do cliente do chatbot (Caixa de entrada, parte 4), para sugerir no campo */
  sectors?: string[];
}) {
  const p = (initial as { id?: string } | undefined)?.id ?? "novo";
  const [r, setR] = useState<RoutineInput>(() => (initial ? structuredClone({ name: initial.name, when_to_use: initial.when_to_use, keywords: initial.keywords, steps: initial.steps, active: initial.active, template: initial.template, handoff_sector: initial.handoff_sector ?? null }) : blank()));
  const [keywords, setKeywords] = useState(() => (initial?.keywords ?? []).map((k) => k.toUpperCase()).join(", "));
  // simular a conversa (redesenho, etapa 5): monta de novo a cada abertura, com o roteiro de agora
  const [simulating, setSimulating] = useState(false);

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

  // um passo aberto por vez (redesenho, etapa 5): os outros ficam numa linha com o resumo e o caminho
  const [openStep, setOpenStep] = useState<string | null>(() => (initial ? null : (r.steps[0]?.id ?? null)));
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const opened = r.steps.some((s) => s.id === openStep) ? openStep : null;
  const moveTo = (from: number, to: number) =>
    setSteps((steps) => {
      const next = [...steps];
      const [it] = next.splice(from, 1);
      next.splice(to, 0, it);
      return next;
    });
  const duplicate = (i: number) => {
    const id = newStepId();
    setSteps((steps) => [...steps.slice(0, i + 1), { ...structuredClone(steps[i]), id }, ...steps.slice(i + 1)]);
    setOpenStep(id);
  };
  const addStep = (type: StepType) => {
    const id = newStepId();
    setSteps((steps) => [...steps, retype({ id, type: "instrucao", text: "", next: { to: "proximo" } }, type, actions)]);
    setOpenStep(id);
  };
  const outcomesOf = (name: string) => actions.find((a) => a.name === name)?.outcomes ?? [];
  const extra = [keywords.trim() && `palavras-chave: ${keywords.trim()}`, r.handoff_sector && `setor ${r.handoff_sector}`].filter(Boolean).join(" · ");

  return (
    <>
      {withTemplates && (
        <section className="flex flex-col gap-2">
          <h3 className="kpi-label">Comece por um modelo pronto (dá para mudar tudo depois)</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {ROUTINE_TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => pick(t.id)}
                aria-pressed={r.template === t.id}
                className={cn("flex flex-col items-start gap-0.5 rounded-[12px] border px-3 py-2.5 text-left transition-colors duration-[120ms]", r.template === t.id ? "border-brand bg-brand-soft" : "border-line hover:border-line-strong hover:bg-raised/40")}
              >
                <span className={cn("text-sm font-medium", r.template === t.id ? "text-brand" : "text-ink")}>{t.label}</span>
                <span className="line-clamp-2 text-xs leading-snug text-muted">{t.summary}</span>
                {t.actionHint && <span className="mt-1 rounded-full bg-raised px-1.5 py-px text-[11px] text-ink-2">com ação</span>}
              </button>
            ))}
            <button type="button" onClick={reset} aria-pressed={!r.template} className={cn("flex flex-col items-start gap-0.5 rounded-[12px] border border-dashed px-3 py-2.5 text-left transition-colors duration-[120ms]", !r.template ? "border-brand bg-brand-soft" : "border-line-strong hover:bg-raised/40")}>
              <span className={cn("text-sm font-medium", !r.template ? "text-brand" : "text-ink")}>Do zero</span>
              <span className="text-xs leading-snug text-muted">Um passo de instrução para você montar.</span>
            </button>
          </div>
          {chosen?.actionHint && (
            <p className="text-xs text-muted">
              Escolha no passo de ação a ação do sistema do cliente (por exemplo, {chosen.actionHint}), cadastrada na aba Ações.
              {!integrations && " Passo com ação faz parte do pacote Integrações."}
            </p>
          )}
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h3 className="kpi-label">Sobre o roteiro</h3>
        <div>
          <label className="label" htmlFor={`rname-${p}`}>Nome</label>
          <input id={`rname-${p}`} required maxLength={60} value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} className="input" placeholder="Segunda via" />
        </div>
        <div>
          <label className="label" htmlFor={`rwhen-${p}`}>Quando usar (é por aqui que a IA reconhece o assunto)</label>
          <textarea id={`rwhen-${p}`} required rows={2} maxLength={500} value={r.when_to_use} onChange={(e) => setR({ ...r, when_to_use: e.target.value })} className="input" placeholder="O cliente pede segunda via de boleto, conta ou fatura." />
        </div>
        <More label="Palavras-chave e setor" summary={extra || "opcional"}>
          <div>
            <label className="label" htmlFor={`rkw-${p}`}>Palavras-chave</label>
            <input id={`rkw-${p}`} value={keywords} onChange={(e) => setKeywords(e.target.value)} className="input" placeholder="2VIA, SEGUNDA VIA" />
            <p className="mt-1 text-xs text-muted">Separadas por vírgula. A mensagem que é só uma palavra-chave começa o roteiro na hora, sem diferença de maiúsculas e acentos.</p>
          </div>
          <div>
            <label className="label" htmlFor={`rsector-${p}`}>Setor da equipe</label>
            <input id={`rsector-${p}`} list={`rsectors-${p}`} maxLength={40} value={r.handoff_sector ?? ""} onChange={(e) => setR({ ...r, handoff_sector: e.target.value || null })} className="input max-w-[320px]" placeholder={sectors[0] ?? "Financeiro"} />
            <datalist id={`rsectors-${p}`}>
              {sectors.map((s) => <option key={s} value={s} />)}
            </datalist>
            <p className="mt-1 text-xs text-muted">Quando o roteiro passa a conversa para a equipe, ela vai para este setor do cliente. Vazio: a triagem de sempre.</p>
          </div>
        </More>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="kpi-label">Passos ({r.steps.length})</h3>
          <button type="button" onClick={() => setSimulating(true)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand hover:underline">
            <Play size={13} /> Simular a conversa
          </button>
        </div>
        <Modal open={simulating} onClose={() => setSimulating(false)} title="Simular a conversa" description="Responda como a pessoa: toque nos botões, mande os dados e escolha o que a ação devolve." size="lg">
          {simulating && <RoutineSimulator routine={r} outcomesOf={outcomesOf} />}
        </Modal>
        <p className="-mt-1 text-xs text-muted">Toque num passo para editar. Para mudar a ordem, arraste pela alça ou use o menu “…” do passo.</p>
        <ol className="flex flex-col">
          {r.steps.map((s, i) => {
            const Icon = STEP_ICON[s.type];
            const isOpen = opened === s.id;
            const menu = (
              <Menu
                label={`Mais ações do passo ${i + 1}`}
                items={[
                  { label: "Subir", icon: ArrowUp, onSelect: () => move(i, -1), disabled: i === 0 },
                  { label: "Descer", icon: ArrowDown, onSelect: () => move(i, 1), disabled: i === r.steps.length - 1 },
                  { label: "Duplicar", icon: Copy, onSelect: () => duplicate(i), disabled: r.steps.length >= STEPS_PER_ROUTINE },
                  { type: "separator" },
                  { label: "Apagar o passo", icon: Trash2, onSelect: () => remove(i), danger: true, disabled: r.steps.length === 1 },
                ]}
              />
            );
            return (
              <li
                key={s.id}
                onDragOver={(e) => {
                  if (dragFrom !== null) e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragFrom !== null && dragFrom !== i) moveTo(dragFrom, i);
                  setDragFrom(null);
                }}
                className={cn("flex gap-3", dragFrom === i && "opacity-40")}
              >
                {/* a sequência: o número do passo e a linha até o próximo */}
                <div className="flex flex-col items-center">
                  <span className={cn("tabular flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold", isOpen ? "bg-brand text-on-brand" : "bg-brand-soft text-brand")}>{i + 1}</span>
                  <span className={cn("w-px flex-1", i < r.steps.length - 1 ? "my-1 bg-line" : "bg-transparent")} />
                </div>
                {!isOpen ? (
                  <div className="mb-2 flex min-w-0 flex-1 items-center gap-1.5 rounded-[14px] border border-line bg-panel py-1.5 pl-1.5 pr-1 transition-colors duration-[120ms] hover:border-line-strong">
                    <span
                      draggable
                      onDragStart={(e) => {
                        setDragFrom(i);
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", s.id);
                      }}
                      onDragEnd={() => setDragFrom(null)}
                      title="Arraste para mudar a ordem"
                      className="flex h-8 w-6 shrink-0 cursor-grab items-center justify-center text-muted active:cursor-grabbing"
                    >
                      <GripVertical size={16} />
                    </span>
                    <button type="button" onClick={() => setOpenStep(s.id)} className="flex min-w-0 flex-1 items-start gap-2.5 py-1 text-left">
                      <Icon size={16} className="mt-0.5 shrink-0 text-ink-2" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">
                          {stepTitle(s)}
                          {s.text.trim() ? <span className="font-normal text-ink-2"> — “{short(s.text.trim())}”</span> : <span className="font-normal text-amber-ink"> — sem texto</span>}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted">{stepFlow(s, i, r.steps, outcomesOf)}</span>
                      </span>
                    </button>
                    {menu}
                  </div>
                ) : (
                  <div className="mb-3 min-w-0 flex-1 rounded-[14px] border border-brand/40 bg-panel p-3.5 shadow-[inset_0_1px_0_var(--highlight)]">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand">
                        <Icon size={13} />
                        {STEP_TYPE_LABEL[s.type]}
                      </span>
                      <Menu
                        label={`Trocar o tipo do passo ${i + 1}`}
                        align="left"
                        trigger={
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline">
                            Trocar o tipo <ChevronDown size={13} />
                          </span>
                        }
                        triggerClassName="rounded-md"
                        items={STEP_TYPES.map((t) => ({
                          label: STEP_TYPE_LABEL[t],
                          hint: t === "acao" && !integrations ? "Faz parte do pacote Integrações." : STEP_HINT[t],
                          icon: STEP_ICON[t],
                          disabled: t === s.type || (t === "acao" && !integrations),
                          onSelect: () => setSteps((steps) => steps.map((x, j) => (j === i ? retype(x, t, actions) : x))),
                        }))}
                      />
                      <div className="ml-auto flex items-center gap-0.5">
                        {menu}
                        <button type="button" className="btn-icon" onClick={() => setOpenStep(null)} aria-label={`Fechar o passo ${i + 1}`}>
                          <ChevronUp size={16} />
                        </button>
                      </div>
                    </div>

                    <label className="label" htmlFor={`rtext-${p}-${s.id}`}>{TEXT_LABEL[s.type]}</label>
                    <textarea id={`rtext-${p}-${s.id}`} rows={2} maxLength={STEP_TEXT_MAX} value={s.text} onChange={(e) => patchStep(i, { text: e.target.value })} className="input" />

                    {s.type === "dado" && (
                      <div className="mt-3 flex flex-col gap-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <label className="label" htmlFor={`rkind-${p}-${s.id}`}>Que dado</label>
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
                          {s.kind === "regex" && (
                            <div>
                              <label className="label" htmlFor={`rpat-${p}-${s.id}`}>Formato (regex)</label>
                              <input id={`rpat-${p}-${s.id}`} value={s.pattern ?? ""} onChange={(e) => patchStep(i, { pattern: e.target.value } as Partial<RoutineStep>)} className="input font-mono" placeholder="[A-Za-z0-9-]{4,20}" />
                            </div>
                          )}
                        </div>
                        <p className="text-xs text-muted">O BoaVoz confere o dado e pede de novo até 3 vezes.</p>
                        <More label="Mais opções" summary={`guarda como ${s.variable || "—"}${s.skip_identified ? " · pula quem já está identificado" : ""}`}>
                          <div>
                            <label className="label" htmlFor={`rvar-${p}-${s.id}`}>Guardar na variável</label>
                            <input id={`rvar-${p}-${s.id}`} value={s.variable} onChange={(e) => patchStep(i, { variable: e.target.value.trim() } as Partial<RoutineStep>)} className="input max-w-[260px] font-mono" placeholder="documento" />
                            <p className="mt-1 text-xs text-muted">Uma ação com um parâmetro de mesmo nome recebe o valor conferido.</p>
                          </div>
                          <SkipSwitch checked={s.skip_identified === true} onChange={(v) => patchStep(i, { skip_identified: v || undefined } as Partial<RoutineStep>)} hint="Use nos dados que servem só para identificar, como o CPF." />
                        </More>
                      </div>
                    )}

                    {s.type === "botoes" && (
                      <div className="mt-3 flex flex-col gap-2">
                        <span className="label mb-0">Botões e para onde cada um leva</span>
                        {s.options.map((o, k) => (
                          // no celular: texto e apagar numa linha, o destino embaixo; da tela média para cima, tudo numa linha
                          <div key={k} className="grid grid-cols-[1fr_auto] items-center gap-2 border-b border-line-2 pb-2 last:border-0 sm:grid-cols-[1fr_auto_1.4fr_auto] sm:border-0 sm:pb-0">
                            <input
                              aria-label={`Texto do botão ${k + 1} do passo ${i + 1}`}
                              maxLength={OPTION_TITLE_MAX}
                              value={o.title}
                              onChange={(e) => patchStep(i, { options: s.options.map((x, m) => (m === k ? { ...x, title: e.target.value } : x)) } as Partial<RoutineStep>)}
                              className="input"
                              placeholder={`Botão ${k + 1}`}
                            />
                            <ArrowRight size={15} className="hidden text-muted sm:order-2 sm:block" />
                            <button type="button" className="btn-icon hover:text-danger sm:order-4" onClick={() => patchStep(i, { options: s.options.filter((_, m) => m !== k) } as Partial<RoutineStep>)} disabled={s.options.length <= 2} aria-label={`Apagar o botão ${k + 1}`}>
                              <Trash2 size={15} />
                            </button>
                            <div className="col-span-2 sm:order-3 sm:col-span-1">
                              <DestinationSelect id={`ropt-${p}-${s.id}-${k}`} value={o.next} onChange={(d) => patchStep(i, { options: s.options.map((x, m) => (m === k ? { ...x, next: d } : x)) } as Partial<RoutineStep>)} steps={r.steps} self={s.id} allowSelf />
                            </div>
                          </div>
                        ))}
                        {s.options.length < OPTIONS_PER_STEP && (
                          <button type="button" className="inline-flex items-center gap-1 self-start text-xs font-semibold text-brand hover:underline" onClick={() => patchStep(i, { options: [...s.options, { title: "", next: { to: "proximo" } }] } as Partial<RoutineStep>)}>
                            <Plus size={13} /> Botão
                          </button>
                        )}
                        <p className="text-xs text-muted">Até 3 viram botões no WhatsApp; de 4 a 10, uma lista. Até {OPTION_TITLE_MAX} caracteres cada.</p>
                        <More label="Mais opções" summary={s.variable ? `guarda a escolha como ${s.variable}` : "opcional"}>
                          <div>
                            <label className="label" htmlFor={`rbvar-${p}-${s.id}`}>Guardar a escolha na variável</label>
                            <input id={`rbvar-${p}-${s.id}`} value={s.variable ?? ""} onChange={(e) => patchStep(i, { variable: e.target.value.trim() || null } as Partial<RoutineStep>)} className="input max-w-[260px] font-mono" placeholder="motivo" />
                          </div>
                        </More>
                      </div>
                    )}

                    {s.type === "acao" && (
                      <div className="mt-3 flex flex-col gap-2">
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
                        <span className="label mb-0 mt-1">Para onde vai, conforme o resultado</span>
                        {[...FIXED_RESULTS, ...outcomesOf(s.action).filter((o) => !(FIXED_RESULTS as readonly string[]).includes(o))].map((k) => (
                          <div key={k} className="grid items-center gap-2 sm:grid-cols-[1fr_1.4fr]">
                            <label className="text-xs text-muted" htmlFor={`rres-${p}-${s.id}-${k}`}>
                              Quando a ação {RESULT_LABEL[k] ?? `devolve ${k}`}
                            </label>
                            <DestinationSelect id={`rres-${p}-${s.id}-${k}`} value={s.results[k] ?? { to: "atendente" }} onChange={(d) => patchStep(i, { results: { ...s.results, [k]: d } } as Partial<RoutineStep>)} steps={r.steps} self={s.id} allowSelf={false} />
                          </div>
                        ))}
                        <More label="Mais opções" summary={s.skip_identified ? "pula quem já está identificado" : "opcional"}>
                          <SkipSwitch checked={s.skip_identified === true} onChange={(v) => patchStep(i, { skip_identified: v || undefined } as Partial<RoutineStep>)} hint="Segue como se a ação tivesse dado certo. Use na ação que só identifica." />
                          <p className="text-xs text-muted">
                            Os parâmetros com o mesmo nome de uma variável do roteiro vão preenchidos pelo BoaVoz. Se a ação devolver <code className="font-mono">identity</code>, a pessoa fica identificada, e no WhatsApp e no Instagram o BoaVoz pede licença para lembrar o número.
                          </p>
                        </More>
                      </div>
                    )}

                    {s.type === "foto" && (
                      <div className="mt-3 flex flex-col gap-2">
                        <p className="text-xs text-muted">Só no WhatsApp e no Instagram: a IA segue quando a foto mostra o que o passo pede. No site, ou no modo dados sensíveis, o passo é pulado.</p>
                        <More label="Mais opções" summary={`guarda a descrição como ${s.variable || "—"}`}>
                          <div>
                            <label className="label" htmlFor={`rfvar-${p}-${s.id}`}>Guardar a descrição da foto na variável</label>
                            <input id={`rfvar-${p}-${s.id}`} value={s.variable} onChange={(e) => patchStep(i, { variable: e.target.value.trim() } as Partial<RoutineStep>)} className="input max-w-[260px] font-mono" placeholder="foto_roteador" />
                            <p className="mt-1 text-xs text-muted">Documento pessoal, cartão, comprovante e foto de saúde não são lidos.</p>
                          </div>
                        </More>
                      </div>
                    )}

                    {(s.type === "instrucao" || s.type === "dado" || s.type === "foto") && (
                      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line-2 pt-3">
                        <label className="flex items-center gap-1.5 text-xs font-medium text-ink-2" htmlFor={`rnext-${p}-${s.id}`}>
                          <ArrowRight size={14} className="text-muted" />
                          Depois deste passo
                        </label>
                        <div className="min-w-[220px] flex-1">
                          <DestinationSelect id={`rnext-${p}-${s.id}`} value={s.next} onChange={(d) => patchStep(i, { next: d } as Partial<RoutineStep>)} steps={r.steps} self={s.id} allowSelf={false} />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        {r.steps.length < STEPS_PER_ROUTINE && (
          <Menu
            label="Novo passo"
            align="left"
            triggerClassName="ml-10 inline-flex w-[calc(100%-2.5rem)] items-center justify-center gap-1.5 rounded-[14px] border border-dashed border-line-strong px-3 py-2.5 text-sm font-medium text-ink-2 transition-colors duration-[120ms] hover:border-brand hover:text-brand"
            trigger={
              <>
                <Plus size={15} /> Passo
              </>
            }
            items={STEP_TYPES.map((t) => ({
              label: STEP_TYPE_LABEL[t],
              hint: t === "acao" && !integrations ? "Faz parte do pacote Integrações." : STEP_HINT[t],
              icon: STEP_ICON[t],
              disabled: t === "acao" && !integrations,
              onSelect: () => addStep(t),
            }))}
          />
        )}
      </section>

      <label className="flex items-start justify-between gap-4 rounded-[14px] border border-line px-4 py-3 text-sm">
        <span>
          <span className="block font-medium text-ink">Ligado</span>
          <span className="block text-xs text-muted">A IA usa este roteiro quando a conversa entra no assunto.</span>
        </span>
        <input type="checkbox" role="switch" className="switch mt-0.5" checked={r.active} onChange={(e) => setR({ ...r, active: e.target.checked })} aria-label="Roteiro ligado" />
      </label>
      <input type="hidden" name="routine" value={payload} />
    </>
  );
}

/** Um bloco "Mais opções" que abre e fecha, com o resumo do que está nele. */
function More({ label, summary, children }: { label: string; summary?: string; children: React.ReactNode }) {
  return (
    <details className="group/more rounded-[12px] border border-line-2 px-3 py-2">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs [&::-webkit-details-marker]:hidden">
        <ChevronDown size={13} className="shrink-0 text-muted transition-transform duration-[220ms] group-open/more:rotate-180" />
        <span className="font-semibold text-ink-2">{label}</span>
        {summary && <span className="truncate text-muted group-open/more:hidden">· {summary}</span>}
      </summary>
      <div className="mt-3 flex flex-col gap-3 pb-1">{children}</div>
    </details>
  );
}

/** A chave "Pular se a pessoa já estiver identificada". */
function SkipSwitch({ checked, onChange, hint }: { checked: boolean; onChange: (v: boolean) => void; hint: string }) {
  return (
    <label className="flex items-start justify-between gap-4 text-sm">
      <span>
        <span className="block font-medium text-ink">Pular se a pessoa já estiver identificada</span>
        <span className="block text-xs text-muted">Número lembrado e confirmado, ou conta conectada. {hint}</span>
      </span>
      <input type="checkbox" role="switch" className="switch mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label="Pular se a pessoa já estiver identificada" />
    </label>
  );
}

/** Uma frase por tipo de passo, no menu de criar e de trocar o tipo. */
const STEP_HINT: Record<StepType, string> = {
  instrucao: "A IA diz ou pergunta algo e segue.",
  dado: "CPF, CEP, e-mail…: o BoaVoz confere antes de seguir.",
  botoes: "Opções para tocar; cada uma leva a um caminho.",
  acao: "Chama o sistema do cliente; o resultado escolhe o caminho.",
  foto: "No WhatsApp e no Instagram, a IA confere a foto.",
};

const RESULT_SHORT: Record<string, string> = { ok: "deu certo", nao_encontrado: "não encontrou", erro: "falhou" };

/** O título do passo fechado: o tipo e, quando ajuda, o dado ou a ação. */
function stepTitle(s: RoutineStep): string {
  if (s.type === "dado") return `${STEP_TYPE_LABEL.dado} (${DATA_KIND_LABEL[s.kind]})`;
  if (s.type === "acao") return s.action ? `Ação ${s.action}` : "Ação (escolha qual)";
  return STEP_TYPE_LABEL[s.type];
}

/** Para onde o passo leva, numa linha: "→ passo 3", "Sim → passo 3 · Não → equipe". */
function stepFlow(s: RoutineStep, i: number, steps: RoutineStep[], outcomesOf: (name: string) => string[]): string {
  const to = (d: Destination): string => {
    if (d.to === "encerrar") return "fim";
    if (d.to === "atendente") return "equipe";
    if (d.to === "passo") {
      const j = steps.findIndex((x) => x.id === d.step);
      return j < 0 ? "passo apagado" : j === i ? "repete" : `passo ${j + 1}`;
    }
    return i + 1 < steps.length ? `passo ${i + 2}` : "fim";
  };
  if (s.type === "botoes") return s.options.map((o, k) => `${o.title.trim() || `botão ${k + 1}`} → ${to(o.next)}`).join(" · ");
  if (s.type === "acao") return [...FIXED_RESULTS, ...outcomesOf(s.action).filter((o) => !(FIXED_RESULTS as readonly string[]).includes(o))].map((k) => `${RESULT_SHORT[k] ?? k} → ${to(s.results[k] ?? { to: "atendente" })}`).join(" · ");
  return `→ ${to(s.next)}`;
}
