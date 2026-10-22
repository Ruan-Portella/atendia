"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileUp, Plus, X } from "lucide-react";
import { createReminderCampaign, previewReminders, reminderOptions, type CampaignTemplateOption, type PickContact, type ReminderPreview } from "@/app/painel/campanhas/actions";
import { REMINDER_LEADS, REMINDER_MAX_ROWS, reminderRowsFromCsv, reminderRowsFromTable, tableRowFromSheet, type ReminderLead, type ReminderSend, type ReminderSlot, type ReminderSlotSource, type ReminderTableRow } from "@/lib/reminder-sheet";
import { displayPhone } from "@/lib/phone";
import { CLIENT_TIMEZONES, isoToLocalInput } from "@/lib/timezone";
import { ContactPicker } from "@/components/campaign-contact-picker";
import { Segmented, TemplateBody, greetingSlot, shortText, slotName } from "@/components/template-slots";
import { useToast } from "@/components/ui/toast";
import { Step } from "@/components/campaign-wizard";
import { cn } from "@/lib/utils";

const MAX_BYTES = 2_000_000;
/** Abaixo do limite de 1 MB das server actions, com folga. */
const MAX_SEND_BYTES = 900_000;
/** Linhas que aparecem para editar; as outras (de uma planilha grande) só entram na conferência. */
const SHOWN = 100;
const tzLabel = (tz: string) => CLIENT_TIMEZONES.find((t) => t.id === tz)?.label ?? "Brasília";
const CELL = "input px-2.5 py-1.5";

const SOURCES: Array<[ReminderSlotSource, string]> = [
  ["name", "Primeiro nome"],
  ["date", "Dia marcado"],
  ["time", "Hora marcada"],
  ["fixed", "Texto fixo"],
  ["row", "Um para cada"],
];
const PILL_OF: Partial<Record<ReminderSlotSource, string>> = { name: "Primeiro nome", date: "Dia marcado", time: "Hora marcada" };

/** "Olá {{1}}" começa como o nome, "dia {{2}}" como o dia marcado, "às {{3}}" como a hora marcada; o resto, texto fixo. */
function guessSlots(body: string, n: number): ReminderSlot[] {
  const hello = greetingSlot(body);
  return Array.from({ length: n }, (_, i): ReminderSlot => {
    if (i === hello) return { src: "name", value: "cliente" };
    const before = body.split(`{{${i + 1}}}`)[0].slice(-16);
    if (/(?:^|\s)(?:dia|data)\s*$/i.test(before)) return { src: "date", value: "" };
    if (/(?:^|\s)(?:às|as|hora|horário|horario)\s*$/i.test(before)) return { src: "time", value: "" };
    return { src: "fixed", value: "" };
  });
}

type Row = ReminderTableRow & { id: number };
const blank = (id: number): Row => ({ id, name: "", phone: "", at: "", date: "", time: "", vars: [] });
const filled = (r: Row) => Boolean(r.phone.trim() || r.name.trim());
const lines = (ns: number[]) => (ns.length > 1 ? `nas linhas ${ns.slice(0, 8).join(", ")}${ns.length > 8 ? "…" : ""}` : `na linha ${ns[0]}`);

/**
 * Lembretes de utilidade (leva B3, parte 5): chatbot, modelo de utilidade, quando sai, quem recebe,
 * prévia do servidor e agendar. Redesenho, etapa 5 (a pedido do usuário em 22/10): no lugar da
 * planilha obrigatória, uma lista na tela, com os contatos escolhidos (o horário marcado da ficha já
 * vem), linhas digitadas ou uma planilha importada; os campos do modelo vêm do nome, do dia ou da hora
 * marcados, de um texto fixo ou de uma coluna da lista; e o envio é o mesmo para todos, um tempo
 * antes do horário marcado ou um para cada linha.
 */
export function ReminderWizard({ bots }: { bots: Array<{ id: string; name: string; clientName: string }> }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [botId, setBotId] = useState("");
  const [options, setOptions] = useState<{ templates: CampaignTemplateOption[]; timezone: string; declared: boolean; clientId: string | null } | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [templateKey, setTemplateKey] = useState("");
  const [slots, setSlots] = useState<ReminderSlot[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const [send, setSend] = useState<ReminderSend["mode"]>("same");
  const [sameDate, setSameDate] = useState("");
  const [sameTime, setSameTime] = useState("09:00");
  const [lead, setLead] = useState<ReminderLead>("1d");
  const [eveTime, setEveTime] = useState("09:00");
  const [rows, setRows] = useState<Row[]>(() => [blank(0)]);
  const nextId = useRef(1);
  const [sheetNote, setSheetNote] = useState<{ text: string; warn: boolean } | null>(null);
  const [preview, setPreview] = useState<ReminderPreview | null>(null);
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const template = options?.templates.find((t) => `${t.name}|${t.language}` === templateKey) ?? null;
  const needsAt = send === "before" || slots.some((s) => s.src === "date" || s.src === "time");
  const rowSlots = slots.flatMap((s, i) => (s.src === "row" ? [i] : []));
  const people = rows.filter(filled).length;
  const spec = (): ReminderSend => (send === "same" ? { mode: "same", date: sameDate, time: sameTime } : send === "before" ? { mode: "before", lead, at: eveTime } : { mode: "each" });
  const input = () => ({ botId, templateName: template?.name ?? "", templateLanguage: template?.language ?? "", rows: reminderRowsFromTable(rows, slots, spec()) });
  // qualquer mudança depois da prévia: conferir de novo
  const dirty = () => {
    setPreview(null);
    setProblem(null);
  };
  const id = () => nextId.current++;
  const slotLabel = (i: number) => {
    const s = slots[i];
    if (!s) return slotName(i, slots.length);
    return PILL_OF[s.src] ?? (s.src === "fixed" && shortText(s.value) ? shortText(s.value) : s.src === "row" ? `${slotName(i, slots.length)} da lista` : slotName(i, slots.length));
  };
  const setSlot = (i: number, patch: Partial<ReminderSlot>) => {
    dirty();
    setSlots(slots.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  };
  const patchRow = (rid: number, patch: Partial<ReminderTableRow>) => {
    dirty();
    setRows((cur) => cur.map((r) => (r.id === rid ? { ...r, ...patch } : r)));
  };
  const patchVar = (rid: number, i: number, value: string) => {
    dirty();
    setRows((cur) =>
      cur.map((r) => {
        if (r.id !== rid) return r;
        const vars = Array.from({ length: Math.max(r.vars.length, i + 1) }, (_, k) => r.vars[k] ?? "");
        vars[i] = value;
        return { ...r, vars };
      }),
    );
  };

  function chooseBot(bid: string) {
    setBotId(bid);
    setOptions(null);
    setOptionsError(null);
    setTemplateKey("");
    setSlots([]);
    setRows([blank(id())]);
    dirty();
    if (!bid) return;
    start(async () => {
      try {
        const r = await reminderOptions(bid);
        if (r.ok) setOptions({ templates: r.templates, timezone: r.timezone, declared: r.declared, clientId: r.clientId });
        else setOptionsError(r.message);
      } catch {
        setOptionsError("Não foi possível carregar os modelos agora. Tente de novo.");
      }
    });
  }

  function chooseTemplate(key: string) {
    const t = options?.templates.find((x) => `${x.name}|${x.language}` === key);
    setTemplateKey(key);
    const guessed = t ? guessSlots(t.body, t.vars) : [];
    setSlots(guessed);
    // com o dia ou a hora marcados no texto, o lembrete sai um tempo antes do horário marcado
    setSend(guessed.some((s) => s.src === "date" || s.src === "time") ? "before" : "same");
    dirty();
  }

  function addContacts(list: PickContact[]) {
    const kept = rows.filter(filled);
    const room = Math.max(0, REMINDER_MAX_ROWS - kept.length);
    const now = Date.now();
    const added = list.slice(0, room).map((c): Row => ({ ...blank(id()), name: c.name ?? "", phone: displayPhone(c.phone), at: c.appointment && Date.parse(c.appointment) > now ? isoToLocalInput(c.appointment, options?.timezone) : "" }));
    dirty();
    setRows([...kept, ...added]);
    setSheetNote(list.length > room ? { text: `A lista chegou ao máximo de ${REMINDER_MAX_ROWS.toLocaleString("pt-BR")} lembretes: ${list.length - room} ficaram de fora.`, warn: true } : null);
  }

  async function onFile(file: File | undefined) {
    setSheetNote(null);
    if (!file) return;
    const warn = (text: string) => setSheetNote({ text, warn: true });
    if (file.size > MAX_BYTES) return warn("Arquivo grande demais (até 2 MB). Divida a planilha em partes.");
    const parsed = reminderRowsFromCsv(await file.text());
    if (!parsed.hasPhone) return warn("A primeira linha da planilha precisa ter os nomes das colunas, com o telefone (veja o modelo).");
    if (!parsed.rows.length) return warn("A planilha não tem nenhuma linha depois do cabeçalho.");
    const kept = rows.filter(filled);
    if (kept.length + parsed.rows.length > REMINDER_MAX_ROWS) return warn(`Com a planilha, a lista passa de ${REMINDER_MAX_ROWS.toLocaleString("pt-BR")} lembretes. Divida em partes.`);
    dirty();
    setRows([...kept, ...parsed.rows.map((r): Row => ({ ...tableRowFromSheet(r), id: id() }))]);
    // lista vazia: a data e a hora da planilha viram o envio de cada linha, e as colunas variavelN, os
    // campos da lista; com gente na lista, o jeito escolhido fica
    if (!kept.length) {
      if (parsed.hasDate) setSend("each");
      const width = Math.max(0, ...parsed.rows.map((r) => r.vars.length));
      if (width) setSlots(slots.map((s, i) => (i < width ? { src: "row", value: "" } : s)));
    }
    const ignored = parsed.unknown.length ? ` Colunas ignoradas: ${parsed.unknown.join(", ")}.` : "";
    setSheetNote({ text: `${parsed.rows.length.toLocaleString("pt-BR")} linha${parsed.rows.length === 1 ? "" : "s"} da planilha na lista.${ignored}`, warn: Boolean(ignored) });
  }

  function calculate() {
    setProblem(null);
    const list = input();
    if (!list.rows.length) return setPreview({ ok: false, message: "Ponha ao menos uma pessoa na lista." });
    if (send === "same" && (!sameDate || !sameTime)) return setPreview({ ok: false, message: "Escolha o dia e a hora do envio." });
    const noAt = needsAt ? rows.flatMap((r, i) => (filled(r) && !r.at ? [i + 1] : [])) : [];
    if (noAt.length) return setPreview({ ok: false, message: `Falta o horário marcado ${lines(noAt)}.` });
    if (new Blob([JSON.stringify(list)]).size > MAX_SEND_BYTES) return setPreview({ ok: false, message: "A lista ficou grande demais para enviar de uma vez. Divida em partes menores." });
    start(async () => {
      try {
        setPreview(await previewReminders(list));
      } catch {
        setPreview({ ok: false, message: "Não foi possível conferir agora. Tente de novo." });
      }
    });
  }

  function create() {
    setProblem(null);
    start(async () => {
      try {
        const r = await createReminderCampaign({ ...input(), name });
        if (r.ok) {
          toast.success(r.message);
          router.push(`/painel/campanhas/${r.id}`);
        } else setProblem(r.message);
      } catch {
        setProblem("Não foi possível agendar agora. Tente de novo.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Step n={2} title="Chatbot">
        {bots.length ? (
          <select className="input" value={botId} onChange={(e) => chooseBot(e.target.value)} aria-label="Chatbot">
            <option value="">Escolha o chatbot…</option>
            {bots.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} · {b.clientName}
              </option>
            ))}
          </select>
        ) : (
          <p className="text-sm text-muted">Nenhum chatbot com o WhatsApp conectado. Lembretes saem só pelo WhatsApp.</p>
        )}
        {optionsError && <p className="text-sm text-danger">{optionsError}</p>}
        {options && (
          <p className={options.declared ? "text-xs text-muted" : "rounded-lg bg-amber-soft px-3 py-2 text-xs text-amber-ink"}>
            {options.declared
              ? `O cliente já fez a declaração de consentimento para lembretes: vão para todos da lista, menos quem pediu para sair. Fuso: ${tzLabel(options.timezone)}.`
              : `O cliente ainda não fez a declaração de consentimento para lembretes: só recebe quem já mandou mensagem ao chatbot. Fuso: ${tzLabel(options.timezone)}.`}{" "}
            {options.clientId && (
              <Link href={`/painel/clientes/${options.clientId}?tab=campanhas`} className="font-semibold underline">
                {options.declared ? "Ver a declaração e o fuso" : "Fazer a declaração ou mudar o fuso"}
              </Link>
            )}
          </p>
        )}
      </Step>

      <Step n={3} title="Modelo" muted={!options}>
        {options && !options.templates.length && <p className="text-sm text-muted">Este chatbot não tem modelo de utilidade aprovado. Crie um na aba WhatsApp do chatbot (categoria Utilidade).</p>}
        {options && options.templates.length > 0 && (
          <>
            <select className="input" value={templateKey} onChange={(e) => chooseTemplate(e.target.value)} aria-label="Modelo">
              <option value="">Escolha o modelo…</option>
              {options.templates.map((t) => (
                <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>
                  {t.name} ({t.language})
                </option>
              ))}
            </select>
            {template && (
              <>
                <TemplateBody body={template.body} label={slotLabel} active={active} />
                {template.prohibited.length > 0 && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">Este modelo fala de {template.prohibited.join(", ")}, que não pode ser enviado pelo WhatsApp.</p>}
                <p className="text-xs text-muted">Lembrete não pode ter promoção: se tiver, a Meta reclassifica como marketing e os envios pausam.</p>
                {slots.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <span className="label mb-0">O que entra em cada campo</span>
                    {slots.map((s, i) => (
                      <div
                        key={i}
                        onFocus={() => setActive(i)}
                        onBlur={() => setActive(null)}
                        onMouseEnter={() => setActive(i)}
                        onMouseLeave={() => setActive(null)}
                        className={cn("flex flex-col gap-2 rounded-[12px] border p-3 transition-colors duration-[120ms]", active === i ? "border-brand/50" : "border-line")}
                      >
                        <span className="text-sm font-medium text-ink">{slotName(i, slots.length)}</span>
                        <Segmented label={`O que entra no ${slotName(i, slots.length).toLowerCase()}`} value={s.src} options={SOURCES} onChange={(src) => setSlot(i, { src, value: src === "name" && !s.value.trim() ? "cliente" : src === "fixed" || src === "name" ? s.value : "" })} />
                        {(s.src === "name" || s.src === "fixed") && (
                          <input
                            className="input"
                            aria-label={s.src === "name" ? `Para quem não tem nome (${slotName(i, slots.length)})` : `Texto do ${slotName(i, slots.length).toLowerCase()}`}
                            maxLength={200}
                            value={s.value}
                            placeholder={s.src === "name" ? "cliente" : "O texto que vai no lugar (o mesmo para todos)"}
                            onChange={(e) => setSlot(i, { value: e.target.value })}
                          />
                        )}
                        <p className="text-xs text-muted">
                          {s.src === "name"
                            ? "O primeiro nome de cada linha; sem nome, vai este texto."
                            : s.src === "date"
                              ? "O dia do horário marcado de cada linha (ex.: 23/10)."
                              : s.src === "time"
                                ? "A hora do horário marcado de cada linha (ex.: 14h30)."
                                : s.src === "row"
                                  ? "Uma coluna na lista, para escrever o de cada pessoa."
                                  : "O mesmo texto para todos."}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </Step>

      <Step n={4} title="Quando sai" muted={!template}>
        {template && options && (
          <>
            <Segmented
              label="Quando sai o lembrete"
              value={send}
              options={[
                ["same", "No mesmo horário para todos"],
                ["before", "Antes do horário marcado"],
                ["each", "Um horário para cada"],
              ]}
              onChange={(m) => {
                dirty();
                setSend(m);
              }}
            />
            {send === "same" && (
              <div className="flex flex-wrap items-center gap-2">
                <input type="date" aria-label="Dia do envio" className="input w-auto" value={sameDate} onChange={(e) => {
                  dirty();
                  setSameDate(e.target.value);
                }} />
                <input type="time" aria-label="Hora do envio" className="input w-auto" value={sameTime} onChange={(e) => {
                  dirty();
                  setSameTime(e.target.value);
                }} />
              </div>
            )}
            {send === "before" && (
              <div className="flex flex-wrap items-center gap-2">
                <select aria-label="Quanto antes" className="input w-auto" value={lead} onChange={(e) => {
                  dirty();
                  setLead(e.target.value as ReminderLead);
                }}>
                  {REMINDER_LEADS.map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
                {lead === "vespera" && <input type="time" aria-label="Hora do envio na véspera" className="input w-auto" value={eveTime} onChange={(e) => {
                  dirty();
                  setEveTime(e.target.value);
                }} />}
              </div>
            )}
            <p className="text-xs text-muted">
              {send === "same" ? "Todos recebem no mesmo dia e hora." : send === "before" ? "Cada linha tem o horário marcado (o da ficha do contato já vem preenchido)." : "Cada linha da lista tem o dia e a hora do envio."} No fuso do cliente ({tzLabel(options.timezone)}); fora de 8h às 20h sai mesmo
              assim, com aviso na prévia.
            </p>
          </>
        )}
      </Step>

      <Step n={5} title="Quem recebe" muted={!template}>
        {template && (
          <>
            <div className="overflow-x-auto rounded-[14px] border border-line">
              <table className="w-full min-w-[540px] text-sm">
                <thead className="bg-raised/50 text-left text-xs text-muted">
                  <tr>
                    <th className="w-8 px-2 py-2 font-medium">
                      <span className="sr-only">Linha</span>
                    </th>
                    <th className="px-1.5 py-2 font-medium">Nome</th>
                    <th className="px-1.5 py-2 font-medium">WhatsApp</th>
                    {needsAt && <th className="px-1.5 py-2 font-medium">Horário marcado</th>}
                    {send === "each" && <th className="px-1.5 py-2 font-medium">Envio</th>}
                    {rowSlots.map((i) => (
                      <th key={i} className="px-1.5 py-2 font-medium">
                        {slotName(i, slots.length)}
                      </th>
                    ))}
                    <th className="w-9">
                      <span className="sr-only">Tirar</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, SHOWN).map((r, idx) => (
                    <tr key={r.id} className="border-t border-line-2 align-middle">
                      <td className="px-2 py-1.5 text-center text-xs tabular-nums text-muted">{idx + 1}</td>
                      <td className="px-1 py-1.5">
                        <input className={cn(CELL, "min-w-[8rem]")} aria-label={`Nome, linha ${idx + 1}`} maxLength={120} placeholder="Nome (opcional)" value={r.name} onChange={(e) => patchRow(r.id, { name: e.target.value })} />
                      </td>
                      <td className="px-1 py-1.5">
                        <input className={cn(CELL, "min-w-[10.5rem] font-mono text-[13px]")} inputMode="tel" aria-label={`WhatsApp, linha ${idx + 1}`} maxLength={24} placeholder="21 99999-0000" value={r.phone} onChange={(e) => patchRow(r.id, { phone: e.target.value })} />
                      </td>
                      {needsAt && (
                        <td className="px-1 py-1.5">
                          <input type="datetime-local" className={cn(CELL, "min-w-[12rem]")} aria-label={`Horário marcado, linha ${idx + 1}`} value={r.at} onChange={(e) => patchRow(r.id, { at: e.target.value })} />
                        </td>
                      )}
                      {send === "each" && (
                        <td className="px-1 py-1.5">
                          <div className="flex gap-1">
                            <input type="date" className={CELL} aria-label={`Dia do envio, linha ${idx + 1}`} value={r.date} onChange={(e) => patchRow(r.id, { date: e.target.value })} />
                            <input type="time" className={cn(CELL, "w-[96px]")} aria-label={`Hora do envio, linha ${idx + 1}`} value={r.time} onChange={(e) => patchRow(r.id, { time: e.target.value })} />
                          </div>
                        </td>
                      )}
                      {rowSlots.map((i) => (
                        <td key={i} className="px-1 py-1.5">
                          <input className={cn(CELL, "min-w-[8rem]")} aria-label={`${slotName(i, slots.length)}, linha ${idx + 1}`} maxLength={200} value={r.vars[i] ?? ""} onChange={(e) => patchVar(r.id, i, e.target.value)} />
                        </td>
                      ))}
                      <td className="px-1 py-1.5">
                        <button
                          type="button"
                          aria-label={`Tirar a linha ${idx + 1}`}
                          onClick={() => {
                            dirty();
                            setRows(rows.length > 1 ? rows.filter((x) => x.id !== r.id) : [blank(id())]);
                          }}
                          className="btn-icon"
                        >
                          <X size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > SHOWN && <p className="border-t border-line-2 px-3 py-2 text-xs text-muted">E mais {(rows.length - SHOWN).toLocaleString("pt-BR")} linhas da planilha, que entram na conferência.</p>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ContactPicker botId={botId} mode="lembrete" declared={options?.declared} chosen={new Set()} onAdd={addContacts} />
              <button
                type="button"
                className="btn-ghost"
                disabled={rows.length >= REMINDER_MAX_ROWS}
                onClick={() => {
                  dirty();
                  setRows([...rows, blank(id())]);
                }}
              >
                <Plus size={15} /> Linha
              </button>
              <label className="btn-ghost cursor-pointer">
                <FileUp size={15} /> Importar planilha
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="sr-only"
                  onChange={(e) => {
                    void onFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
              <a href="/modelos/lembretes.csv" download className="text-xs font-semibold text-brand hover:underline">
                Baixar o modelo da planilha
              </a>
              {people > 1 && (
                <button
                  type="button"
                  className="ml-auto text-xs font-semibold text-muted hover:text-ink"
                  onClick={() => {
                    dirty();
                    setRows([blank(id())]);
                  }}
                >
                  Limpar a lista
                </button>
              )}
            </div>
            {sheetNote && <p className={cn("text-xs", sheetNote.warn ? "text-amber-ink" : "text-muted")}>{sheetNote.text}</p>}
            <button type="button" className="btn-ghost self-start" disabled={pending || !people || Boolean(template.prohibited.length)} onClick={calculate}>
              {pending && !preview ? "Conferindo…" : people ? `Conferir ${people.toLocaleString("pt-BR")} lembrete${people === 1 ? "" : "s"}` : "Conferir"}
            </button>
          </>
        )}
      </Step>

      <Step n={6} title="Prévia" muted={!preview?.ok}>
        {preview && !preview.ok && <p className="text-sm text-danger">{preview.message}</p>}
        {preview?.ok && (
          <>
            <p className="text-lg font-bold">
              {preview.included.toLocaleString("pt-BR")} lembrete{preview.included === 1 ? "" : "s"} vão sair
            </p>
            {preview.first && (
              <p className="text-sm text-ink-2">
                De {preview.first} a {preview.last} ({tzLabel(preview.timezone)}).
              </p>
            )}
            {preview.offHours > 0 && <p className="text-sm text-amber-ink">{preview.offHours.toLocaleString("pt-BR")} fora do horário de 8h às 20h: saem mesmo assim, no horário escolhido.</p>}
            {preview.busiest && Number.isFinite(preview.limit) && preview.busiest.count > preview.limit && (
              <p className="text-sm text-amber-ink">
                Em {preview.busiest.day} há {preview.busiest.count.toLocaleString("pt-BR")} lembretes, mais que o limite de {preview.limit.toLocaleString("pt-BR")} pessoas por 24 h da conta do WhatsApp: os que passarem saem no dia seguinte.
              </p>
            )}
            {preview.excluded.length > 0 && (
              <ul className="flex flex-col gap-0.5 text-sm text-ink-2">
                {preview.excluded.map((x) => (
                  <li key={x.reason}>
                    {x.count.toLocaleString("pt-BR")} fora: {x.label}
                  </li>
                ))}
              </ul>
            )}
            {preview.errorCount > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-danger">{preview.errorCount.toLocaleString("pt-BR")} linha(s) com erro (não vão)</summary>
                <ul className="mt-1 flex max-h-48 flex-col gap-0.5 overflow-auto text-xs text-ink-2">
                  {preview.errors.map((e) => (
                    <li key={e.line}>
                      Linha {e.line}: {e.message}
                    </li>
                  ))}
                  {preview.errorCount > preview.errors.length && <li>… e mais {preview.errorCount - preview.errors.length}.</li>}
                </ul>
              </details>
            )}
            <p className="text-sm">
              Custo estimado na Meta: <strong>{preview.cost}</strong>, cobrado direto da conta do WhatsApp do cliente.
            </p>
            {preview.sample && (
              <div>
                <span className="label">Como chega o primeiro lembrete</span>
                <p className="max-w-[440px] whitespace-pre-line rounded-lg bg-ground px-3 py-2 text-sm">{preview.sample}</p>
              </div>
            )}
          </>
        )}
      </Step>

      <Step n={7} title="Agendar" muted={!(preview?.ok && preview.included > 0)}>
        {preview?.ok && preview.included > 0 && (
          <>
            <div>
              <label className="label" htmlFor="reminder-name">Nome (só para a equipe)</label>
              <input id="reminder-name" className="input" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="Consultas da semana" />
            </div>
            <button type="button" className="btn-primary self-start" disabled={pending} onClick={create}>
              {pending ? "Agendando…" : `Agendar ${preview.included.toLocaleString("pt-BR")} lembrete${preview.included === 1 ? "" : "s"}`}
            </button>
            {problem && <p className="text-sm text-danger">{problem}</p>}
          </>
        )}
      </Step>
    </div>
  );
}
