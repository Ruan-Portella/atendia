"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, RotateCcw, Send } from "lucide-react";
import { DATA_KIND_LABEL, FIXED_RESULTS, RESULT_LABEL, type DataKind, type Destination, type RoutineInput, type RoutineStep } from "@/lib/routines";
import { cn } from "@/lib/utils";

type Line = { from: "ia" | "pessoa" | "nota"; text: string };
type State = { at: number | null; log: Line[]; end: "fim" | "equipe" | null };

/** O formato do dado, só para a simulação (o roteiro de verdade confere também o dígito do CPF e do CNPJ). */
function looksValid(kind: DataKind, value: string, pattern: string | null): boolean {
  const digits = value.replace(/\D/g, "");
  if (kind === "cpf") return digits.length === 11;
  if (kind === "cnpj") return digits.length === 14;
  if (kind === "cpf_cnpj") return digits.length === 11 || digits.length === 14;
  if (kind === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
  if (kind === "telefone") return digits.length >= 10 && digits.length <= 13;
  if (kind === "cep") return digits.length === 8;
  if (kind === "data") return /^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(value.trim());
  if (kind === "numero") return /^\d+([.,]\d+)?$/.test(value.trim());
  try {
    return new RegExp(`^(?:${pattern ?? ".+"})$`).test(value.trim());
  } catch {
    return true;
  }
}

/**
 * Simular o roteiro (redesenho, etapa 5): a conversa passo a passo, com os botões, os dados e os
 * resultados da ação escolhidos na mão, sem chamar a IA nem o sistema do cliente. Mostra o caminho
 * que o BoaVoz segue; o texto de cada passo aparece como foi escrito (na conversa de verdade, a IA
 * fala com as palavras dela).
 */
export function RoutineSimulator({ routine, outcomesOf }: { routine: RoutineInput; outcomesOf: (action: string) => string[] }) {
  const steps = routine.steps;
  const enter = (i: number, log: Line[], hops = 0): State => {
    if (hops > 40) return { at: null, log: [...log, { from: "nota", text: "O caminho voltou para os mesmos passos muitas vezes: confira os destinos." }], end: "fim" };
    const s = steps[i];
    const said = s.text.trim() || `(o passo ${i + 1} está sem texto)`;
    const next = [...log, { from: "ia" as const, text: said }];
    if (s.type === "acao") next.push({ from: "nota", text: s.action ? `O BoaVoz chama a ação ${s.action}. Escolha o que ela devolve:` : "Este passo ainda não tem ação escolhida." });
    return { at: i, log: next, end: null };
  };
  const go = (d: Destination, from: number, log: Line[]): State => {
    if (d.to === "encerrar") return { at: null, log: [...log, { from: "nota", text: "Fim do roteiro: a conversa volta para a IA." }], end: "fim" };
    if (d.to === "atendente") return { at: null, log: [...log, { from: "nota", text: `A conversa passa para a equipe${routine.handoff_sector ? ` (setor ${routine.handoff_sector})` : ""}.` }], end: "equipe" };
    if (d.to === "passo") {
      const j = steps.findIndex((s) => s.id === d.step);
      return j >= 0 ? enter(j, log) : { at: null, log: [...log, { from: "nota", text: "O destino aponta para um passo que não existe mais." }], end: "fim" };
    }
    return from + 1 < steps.length ? enter(from + 1, log) : { at: null, log: [...log, { from: "nota", text: "Era o último passo: fim do roteiro, a conversa volta para a IA." }], end: "fim" };
  };

  const [state, setState] = useState<State>(() => enter(0, [{ from: "nota", text: `O roteiro “${routine.name || "sem nome"}” começa.` }]));
  const [typed, setTyped] = useState("");
  const [tries, setTries] = useState(0);
  const step: RoutineStep | null = state.at === null ? null : steps[state.at];
  // a conversa desce sozinha até a última mensagem
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight, behavior: "smooth" });
  }, [state.log.length]);

  const answer = (text: string, d: Destination) => {
    setTyped("");
    setTries(0);
    setState((cur) => go(d, cur.at ?? 0, [...cur.log, { from: "pessoa", text }]));
  };
  const sendData = () => {
    if (!step || step.type !== "dado" || !typed.trim()) return;
    const value = typed.trim();
    if (looksValid(step.kind, value, step.pattern)) return answer(value, step.next);
    const n = tries + 1;
    setTyped("");
    setTries(n);
    setState((cur) =>
      n >= 3
        ? { at: null, log: [...cur.log, { from: "pessoa", text: value }, { from: "nota", text: "3 tentativas sem conferir: a pessoa vê “Falar com a equipe” e “Cancelar”." }], end: "equipe" }
        : { ...cur, log: [...cur.log, { from: "pessoa", text: value }, { from: "ia", text: `Não consegui conferir o ${DATA_KIND_LABEL[step.kind]}. Pode mandar de novo?` }] },
    );
  };
  const restart = () => {
    setTyped("");
    setTries(0);
    setState(enter(0, [{ from: "nota", text: `O roteiro “${routine.name || "sem nome"}” começa.` }]));
  };

  return (
    <div className="flex flex-col gap-3">
      <div ref={box} className="flex max-h-[52vh] min-h-[260px] flex-col gap-2 overflow-y-auto rounded-[14px] bg-ground/60 p-3" aria-live="polite">
        {state.log.map((l, i) =>
          l.from === "nota" ? (
            <p key={i} className="self-center px-2 text-center text-xs text-muted">
              {l.text}
            </p>
          ) : (
            <p key={i} className={cn("max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed", l.from === "ia" ? "self-start rounded-tl-md bg-raised text-ink shadow-[inset_0_0_0_1px_var(--color-line-2)]" : "self-end rounded-tr-md bg-brand-soft text-ink")}>
              {l.text}
            </p>
          ),
        )}
      </div>

      {step?.type === "botoes" && (
        <div className="flex flex-wrap gap-2">
          {step.options.map((o, k) => (
            <button key={k} type="button" onClick={() => answer(o.title || `Botão ${k + 1}`, o.next)} className="btn-ghost py-1.5 text-[13px]">
              {o.title || `Botão ${k + 1}`}
            </button>
          ))}
        </div>
      )}
      {step?.type === "acao" && (
        <div className="flex flex-wrap gap-2">
          {[...FIXED_RESULTS, ...outcomesOf(step.action).filter((o) => !(FIXED_RESULTS as readonly string[]).includes(o))].map((k) => (
            <button key={k} type="button" onClick={() => setState((cur) => go(step.results[k] ?? { to: "atendente" }, cur.at ?? 0, [...cur.log, { from: "nota", text: `A ação ${RESULT_LABEL[k] ?? `devolveu ${k}`}.` }]))} className="btn-ghost py-1.5 text-[13px]">
              {RESULT_LABEL[k] ?? k}
            </button>
          ))}
        </div>
      )}
      {step?.type === "foto" && (
        <button type="button" onClick={() => answer("📷 (manda uma foto)", step.next)} className="btn-ghost self-start py-1.5 text-[13px]">
          <Camera size={14} /> Mandar uma foto
        </button>
      )}
      {(step?.type === "dado" || step?.type === "instrucao") && (
        <div className="flex gap-2">
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              // Enter responde aqui (sem enviar o formulário do roteiro)
              if (e.key !== "Enter") return;
              e.preventDefault();
              if (step.type === "dado") sendData();
              else if (typed.trim()) answer(typed.trim(), step.next);
            }}
            aria-label="Resposta da pessoa"
            placeholder={step.type === "dado" ? `O ${DATA_KIND_LABEL[step.kind]} da pessoa` : "O que a pessoa responde"}
            className="input flex-1"
          />
          <button type="button" onClick={() => (step.type === "dado" ? sendData() : typed.trim() && answer(typed.trim(), step.next))} aria-label="Responder" className="btn-primary px-3">
            <Send size={15} />
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">{state.end ? "A simulação acabou." : "Só a simulação: nada é enviado e nenhuma ação é chamada. Na conversa de verdade, a IA fala com as palavras dela."}</p>
        <button type="button" onClick={restart} className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand hover:underline">
          <RotateCcw size={13} /> Recomeçar
        </button>
      </div>
    </div>
  );
}
