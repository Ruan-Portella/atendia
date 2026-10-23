"use client";

import { useState } from "react";
import { CUSTOM_OFFSET, REGUA_TRIGGER_LABEL, customExamples, customTemplateBody, customVariables, dateFieldKey, type CustomRegua, type ReguaTrigger } from "@/lib/regua-kinds";
import { whenOf } from "@/lib/regua-form";
import { TemplateField } from "@/components/template-field";

const HOURS = Array.from({ length: 12 }, (_, i) => i + 8);
/** O nome de cada variável do modelo na etiqueta do editor. */
const VAR_NAME = (v: string) => (v.startsWith("o primeiro nome") ? "Primeiro nome" : v.startsWith("a data") ? "Data" : "Hora");
const CARD = "flex cursor-pointer items-start gap-2.5 rounded-[12px] border border-line p-3 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft/60";

/** As variáveis e as etiquetas do editor do modelo, pela data que dispara. Pura. */
export function templateVars(trigger: ReguaTrigger, yearly: boolean) {
  const need = customVariables(trigger);
  const examples = customExamples(trigger, yearly);
  return {
    vars: Object.fromEntries(need.map((_, i) => [String(i + 1), examples[i] ?? ""])),
    labels: Object.fromEntries(need.map((v, i) => [String(i + 1), VAR_NAME(v)])),
  };
}

/**
 * Os campos da régua personalizada (23/10/2026): no "+ Nova régua", tudo (o nome, a data que
 * dispara, a data nova, a repetição, quando sai, a hora, a etiqueta, a categoria e o texto do
 * modelo); na edição (`initial`), o nome, quando sai, a hora e a etiqueta. Sem {{1}} à mostra: o
 * texto usa as etiquetas Primeiro nome e Data (e Hora no horário marcado).
 */
export function ReguaCustomFields({ fields, tags, company, initial, idPrefix }: { fields: Array<{ id: string; key: string; label: string }>; tags: string[]; company: string; initial?: CustomRegua; idPrefix: string }) {
  const editing = Boolean(initial);
  const [trigger, setTrigger] = useState<ReguaTrigger>(initial?.trigger ?? "data");
  const [dateChoice, setDateChoice] = useState<string>(fields[0]?.id ?? "nova");
  const [dateLabel, setDateLabel] = useState("");
  const [repeat, setRepeat] = useState(initial?.repeatYearly ? "todo_ano" : "uma_vez");
  const start = whenOf(initial?.offsetDays ?? (initial ? 0 : -1));
  const [when, setWhen] = useState<string>(initial ? start.when : trigger === "ultima_visita" ? "depois" : "antes");
  const id = (k: string) => `${idPrefix}-${k}`;
  const chosen = fields.find((f) => f.id === dateChoice);
  const label = trigger !== "data" ? null : initial ? initial.dateLabel : dateChoice === "nova" ? dateLabel : (chosen?.label ?? "");
  const yearly = trigger === "data" && repeat === "todo_ano";
  const { vars, labels } = templateVars(trigger, yearly);
  const suggested = customTemplateBody({ trigger, dateLabel: label, company });
  const lim = CUSTOM_OFFSET[trigger];

  return (
    <>
      <div>
        <label htmlFor={id("nome")} className="label">
          Nome da régua
        </label>
        <input id={id("nome")} name="name" required minLength={2} maxLength={60} defaultValue={initial?.name ?? ""} placeholder="Renovação do plano, Pós-venda de 30 dias, Vacina do pet…" className="input" />
      </div>

      {!editing && (
        <>
          <div>
            <label htmlFor={id("gatilho")} className="label">
              A data que dispara
            </label>
            <select
              id={id("gatilho")}
              name="trigger"
              value={trigger}
              onChange={(e) => {
                const t = e.target.value as ReguaTrigger;
                setTrigger(t);
                if (t === "ultima_visita" && when === "antes") setWhen("depois");
              }}
              className="input"
            >
              {(["data", "aniversario", "ultima_visita", "horario"] as ReguaTrigger[]).map((t) => (
                <option key={t} value={t}>
                  {t === "data" ? "Uma data do contato (renovação, vacina, contrato…)" : REGUA_TRIGGER_LABEL[t]}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted">
              {trigger === "horario" ? "O próximo horário marcado do contato (ficha, planilha ou API)." : trigger === "aniversario" ? "O dia e o mês do aniversário do contato." : trigger === "ultima_visita" ? "A última visita ou compra registrada na ficha, na planilha ou pela API." : "Uma data que você dá o nome; ela aparece na ficha do contato, na planilha e na API."}
            </p>
          </div>

          {trigger === "data" && (
            <div className="flex flex-col gap-3 rounded-[12px] bg-raised/60 p-3">
              <div>
                <label htmlFor={id("data")} className="label">
                  Qual data
                </label>
                <select id={id("data")} name="date_field" value={dateChoice} onChange={(e) => setDateChoice(e.target.value)} className="input">
                  {fields.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                  <option value="nova">+ Uma data nova…</option>
                </select>
              </div>
              {dateChoice === "nova" && (
                <div>
                  <label htmlFor={id("data-nome")} className="label">
                    Nome da data nova
                  </label>
                  <input id={id("data-nome")} name="date_label" required minLength={2} maxLength={60} value={dateLabel} onChange={(e) => setDateLabel(e.target.value)} placeholder="Renovação do plano" className="input" />
                  {dateLabel.trim().length >= 2 && (
                    <p className="mt-1 text-xs text-muted">
                      Na planilha e na API, a coluna <span className="font-mono text-ink">{dateFieldKey(dateLabel)}</span>, com a data (ex.: 10/03/2027).
                    </p>
                  )}
                </div>
              )}
              <fieldset className="flex flex-col gap-2">
                <legend className="label">Repetição</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {[
                    ["uma_vez", "Uma vez", "Vale a data com o ano (ex.: o plano vence em 10/03/2027)."],
                    ["todo_ano", "Todo ano", "Vale o dia e o mês, em qualquer ano (ex.: aniversário de casamento)."],
                  ].map(([v, t, hint]) => (
                    <label key={v} className={CARD}>
                      <input type="radio" name="repeat" value={v} checked={repeat === v} onChange={() => setRepeat(v)} className="mt-0.5 accent-brand" />
                      <span>
                        <span className="block font-medium text-ink">{t}</span>
                        <span className="block text-xs text-muted">{hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          )}
        </>
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="label">Quando sai</legend>
        {trigger === "horario" ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
            <input id={id("horas")} name="hours" type="number" required min={lim.min} max={lim.max} defaultValue={initial?.hoursBefore ?? 24} aria-label="Quantas horas antes" className="input w-24" />
            <span>horas antes do horário marcado</span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
            {when !== "no_dia" && <input id={id("dias")} name="days" type="number" required min={1} max={Math.max(-lim.min, lim.max)} defaultValue={initial ? start.days : trigger === "ultima_visita" ? 30 : 7} aria-label="Quantos dias" className="input w-24" />}
            <select name="when" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Antes, no dia ou depois" className="input w-auto">
              {trigger !== "ultima_visita" && <option value="antes">dias antes</option>}
              <option value="no_dia">no dia</option>
              <option value="depois">dias depois</option>
            </select>
            <span>{trigger === "aniversario" ? "do aniversário" : trigger === "ultima_visita" ? "da última visita" : label?.trim() ? `de ${label.trim()}` : "da data"}, às</span>
            <select name="send_hour" defaultValue={initial?.sendHour ?? 9} aria-label="Hora do envio" className="input w-auto">
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {h}h
                </option>
              ))}
            </select>
          </div>
        )}
        <p className="text-xs text-muted">Sai das 8h às 20h no fuso do cliente, uma régua por pessoa a cada 24 horas.</p>
      </fieldset>

      <div>
        <label htmlFor={id("etiqueta")} className="label">
          Só para quem tem a etiqueta (opcional)
        </label>
        <input id={id("etiqueta")} name="tag" list={id("etiquetas")} maxLength={40} defaultValue={initial?.tag ?? ""} placeholder="Vazio: todos que têm a data" className="input" />
        <datalist id={id("etiquetas")}>
          {tags.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </div>

      {!editing && (
        <>
          <fieldset className="flex flex-col gap-2">
            <legend className="label">Tipo de mensagem</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className={CARD}>
                <input type="radio" name="category" value="UTILITY" defaultChecked className="mt-0.5 accent-brand" />
                <span>
                  <span className="block font-medium text-ink">Utilidade</span>
                  <span className="block text-xs text-muted">Aviso sobre a conta ou o atendimento da pessoa (vencimento, horário, renovação), sem oferta.</span>
                </span>
              </label>
              <label className={CARD}>
                <input type="radio" name="category" value="MARKETING" className="mt-0.5 accent-brand" />
                <span>
                  <span className="block font-medium text-ink">Promoção</span>
                  <span className="block text-xs text-muted">Com oferta ou novidade: só vai para quem aceitou receber, com o botão &ldquo;Parar promoções&rdquo;.</span>
                </span>
              </label>
            </div>
          </fieldset>

          <TemplateField
            // o texto sugerido acompanha a data escolhida (os campos de cima vêm antes do texto)
            key={`${trigger}-${dateChoice}-${repeat}-${label ?? ""}`}
            id={id("texto")}
            name="body"
            label="Texto da mensagem (vai para a Meta aprovar)"
            hint="Arraste as etiquetas para o lugar certo. Em utilidade, sem oferta nem promoção: senão a Meta muda para promoção. A análise costuma sair em minutos."
            defaultValue={suggested}
            fallback={suggested}
            vars={vars}
            labels={labels}
            required={Object.keys(vars)}
            format="meta"
            multiline
            maxLength={1024}
          />
        </>
      )}
    </>
  );
}
