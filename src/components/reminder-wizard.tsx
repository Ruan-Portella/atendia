"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createReminderCampaign, previewReminders, reminderOptions, type CampaignTemplateOption, type ReminderPreview } from "@/app/painel/campanhas/actions";
import { REMINDER_MAX_ROWS, reminderRowsFromCsv, type RawReminderRow } from "@/lib/reminder-sheet";
import { CLIENT_TIMEZONES } from "@/lib/timezone";
import { useToast } from "@/components/ui/toast";
import { Step } from "@/components/campaign-wizard";

const MAX_BYTES = 2_000_000;
/** Abaixo do limite de 1 MB das server actions, com folga. */
const MAX_SEND_BYTES = 900_000;
const tzLabel = (tz: string) => CLIENT_TIMEZONES.find((t) => t.id === tz)?.label ?? "Brasília";

/**
 * Lembretes de utilidade por planilha (leva B3, parte 5): chatbot, modelo de utilidade, planilha
 * (uma linha = um envio, na data e hora dela, no fuso do cliente), prévia do servidor e agendar.
 */
export function ReminderWizard({ bots }: { bots: Array<{ id: string; name: string; clientName: string }> }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [botId, setBotId] = useState("");
  const [options, setOptions] = useState<{ templates: CampaignTemplateOption[]; timezone: string; declared: boolean; clientId: string | null } | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [templateKey, setTemplateKey] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<RawReminderRow[]>([]);
  const [sheetProblem, setSheetProblem] = useState<string | null>(null);
  const [preview, setPreview] = useState<ReminderPreview | null>(null);
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const template = options?.templates.find((t) => `${t.name}|${t.language}` === templateKey) ?? null;
  const input = () => ({ botId, templateName: template?.name ?? "", templateLanguage: template?.language ?? "", rows });

  function chooseBot(id: string) {
    setBotId(id);
    setOptions(null);
    setOptionsError(null);
    setTemplateKey("");
    setPreview(null);
    if (!id) return;
    start(async () => {
      try {
        const r = await reminderOptions(id);
        if (r.ok) setOptions({ templates: r.templates, timezone: r.timezone, declared: r.declared, clientId: r.clientId });
        else setOptionsError(r.message);
      } catch {
        setOptionsError("Não foi possível carregar os modelos agora. Tente de novo.");
      }
    });
  }

  async function onFile(file: File | undefined) {
    setPreview(null);
    setSheetProblem(null);
    setRows([]);
    setFileName(file?.name ?? null);
    if (!file) return;
    if (file.size > MAX_BYTES) return setSheetProblem("Arquivo grande demais (até 2 MB). Divida a planilha em partes.");
    const parsed = reminderRowsFromCsv(await file.text());
    if (!parsed.hasPhone || !parsed.hasDate) return setSheetProblem("A primeira linha precisa ter os nomes das colunas, com telefone, data e hora (veja o modelo).");
    if (!parsed.rows.length) return setSheetProblem("A planilha não tem nenhuma linha depois do cabeçalho.");
    if (parsed.rows.length > REMINDER_MAX_ROWS) return setSheetProblem(`A planilha tem ${parsed.rows.length} linhas; o máximo é ${REMINDER_MAX_ROWS} por vez. Divida em partes.`);
    setRows(parsed.rows);
    if (parsed.unknown.length) setSheetProblem(`Colunas ignoradas: ${parsed.unknown.join(", ")}.`);
  }

  function calculate() {
    setProblem(null);
    if (new Blob([JSON.stringify(input())]).size > MAX_SEND_BYTES) return setPreview({ ok: false, message: "A planilha ficou grande demais para enviar de uma vez. Divida em partes menores." });
    start(async () => {
      try {
        setPreview(await previewReminders(input()));
      } catch {
        setPreview({ ok: false, message: "Não foi possível conferir a planilha agora. Tente de novo." });
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
              ? `O cliente já fez a declaração de consentimento para lembretes: vão para todos da planilha, menos quem pediu para sair. Fuso: ${tzLabel(options.timezone)}.`
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
            <select
              className="input"
              value={templateKey}
              onChange={(e) => {
                setTemplateKey(e.target.value);
                setPreview(null);
              }}
              aria-label="Modelo"
            >
              <option value="">Escolha o modelo…</option>
              {options.templates.map((t) => (
                <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>
                  {t.name} ({t.language}) · {t.vars} variáve{t.vars === 1 ? "l" : "is"}
                </option>
              ))}
            </select>
            {template && (
              <>
                <p className="whitespace-pre-line rounded-lg bg-ground p-3 text-sm text-ink-2">{template.body}</p>
                {template.prohibited.length > 0 && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">Este modelo fala de {template.prohibited.join(", ")}, que não pode ser enviado pelo WhatsApp.</p>}
                <p className="text-xs text-muted">Lembrete não pode ter promoção: se tiver, a Meta reclassifica como marketing e os envios pausam.</p>
              </>
            )}
          </>
        )}
      </Step>

      <Step n={4} title="Planilha" muted={!template}>
        {template && (
          <>
            <p className="text-sm text-ink-2">
              Uma linha = um lembrete, na data e hora dela, no horário do cliente. Colunas: <span className="font-mono text-xs">telefone</span>, <span className="font-mono text-xs">data</span> (dd/mm/aaaa),{" "}
              <span className="font-mono text-xs">hora</span> (hh:mm)
              {template.vars > 0 && (
                <>
                  , <span className="font-mono text-xs">{Array.from({ length: template.vars }, (_, i) => `variavel${i + 1}`).join(", ")}</span> (o que entra em {Array.from({ length: template.vars }, (_, i) => `{{${i + 1}}}`).join(", ")})
                </>
              )}{" "}
              e <span className="font-mono text-xs">nome</span> (opcional).{" "}
              <a href="/modelos/lembretes.csv" download className="font-semibold text-brand hover:underline">
                Baixar o modelo
              </a>
            </p>
            <input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} className="text-sm" aria-label="Planilha CSV" />
            {fileName && rows.length > 0 && <p className="text-xs text-muted">{fileName}: {rows.length.toLocaleString("pt-BR")} linha(s).</p>}
            {sheetProblem && <p className="text-xs text-amber-ink">{sheetProblem}</p>}
            <button type="button" className="btn-ghost self-start" disabled={pending || !rows.length || Boolean(template.prohibited.length)} onClick={calculate}>
              {pending && !preview ? "Conferindo…" : "Conferir a planilha"}
            </button>
          </>
        )}
      </Step>

      <Step n={5} title="Prévia" muted={!preview?.ok}>
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
            {preview.offHours > 0 && <p className="text-sm text-amber-ink">{preview.offHours.toLocaleString("pt-BR")} fora do horário de 8h às 20h: saem mesmo assim, no horário da planilha.</p>}
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

      <Step n={6} title="Agendar" muted={!(preview?.ok && preview.included > 0)}>
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
