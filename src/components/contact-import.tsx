"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { IMPORT_MAX_ROWS, rowsFromCsv, validateImportRows, type RawImportRow } from "@/lib/contact-import";
import type { ImportContactsResult } from "@/app/painel/actions";

const MAX_BYTES = 2_000_000;
/** Abaixo do limite de 1 MB das server actions, com folga. */
const MAX_SEND_BYTES = 900_000;

/**
 * Importar planilha (leva B3, parte 2b): o navegador lê o CSV e mostra a prévia (válidas, com
 * aceite, com idade e os erros por linha); o servidor confere de novo e grava.
 */
export function ContactImport({ clientId, bots, action }: { clientId: string; bots: Array<{ id: string; name: string }>; action: (clientId: string, input: { botId: string; rows: RawImportRow[]; consentText: string; consentTerms: boolean; ageTerms: boolean }) => Promise<ImportContactsResult> }) {
  const [botId, setBotId] = useState(bots[0]?.id ?? "");
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<RawImportRow[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [consentText, setConsentText] = useState("");
  const [consentTerms, setConsentTerms] = useState(false);
  const [ageTerms, setAgeTerms] = useState(false);
  const [result, setResult] = useState<ImportContactsResult | null>(null);
  const [pending, start] = useTransition();

  const preview = useMemo(() => validateImportRows(rows), [rows]);
  const withConsent = preview.valid.filter((r) => r.consent).length;
  const needsText = preview.valid.some((r) => r.consent && !r.consent.text);
  const withAge = preview.valid.filter((r) => r.age).length;
  const ready = Boolean(botId) && preview.valid.length > 0 && (!withConsent || consentTerms) && (!needsText || consentText.trim().length >= 10) && (!withAge || ageTerms);

  async function onFile(file: File | undefined) {
    setResult(null);
    setProblem(null);
    setRows([]);
    setFileName(file?.name ?? null);
    if (!file) return;
    if (file.size > MAX_BYTES) return setProblem("Arquivo grande demais (até 2 MB). Divida a planilha em partes.");
    const parsed = rowsFromCsv(await file.text());
    if (!parsed.hasPhone) return setProblem("Não achei a coluna do telefone. A primeira linha precisa ter os nomes das colunas, com uma chamada telefone.");
    if (parsed.rows.length > IMPORT_MAX_ROWS) return setProblem(`A planilha tem ${parsed.rows.length} linhas; o máximo é ${IMPORT_MAX_ROWS} por vez. Divida em partes.`);
    if (!parsed.rows.length) return setProblem("A planilha não tem nenhuma linha depois do cabeçalho.");
    setRows(parsed.rows);
    if (parsed.unknown.length) setProblem(`Colunas ignoradas: ${parsed.unknown.join(", ")}.`);
  }

  function submit() {
    const input = { botId, rows, consentText, consentTerms, ageTerms };
    // o envio para o servidor tem limite de 1 MB (aceite_texto longo em todas as linhas passa disso)
    if (new Blob([JSON.stringify(input)]).size > MAX_SEND_BYTES) {
      setResult({ ok: false, message: "A planilha ficou grande demais para enviar de uma vez. Divida em partes menores, ou tire a coluna aceite_texto e escreva o texto uma vez só, acima." });
      return;
    }
    start(async () => {
      try {
        setResult(await action(clientId, input));
      } catch {
        setResult({ ok: false, message: "Não foi possível importar agora. Verifique a conexão e tente de novo." });
      }
    });
  }

  if (result?.ok) {
    return (
      <section className="card flex flex-col gap-3 p-5" aria-live="polite">
        <h2 className="font-semibold">Importação concluída</h2>
        <ul className="flex flex-col gap-1 text-sm">
          <li>{result.created} contatos novos e {result.updated} atualizados.</li>
          <li>{result.consents} aceites de novidades registrados{result.consentsSkipped ? ` (${result.consentsSkipped} já tinham um aceite ativo)` : ""}.</li>
          {(result.ages > 0 || result.agesSkipped > 0) && <li>{result.ages} idades gravadas{result.agesSkipped ? ` (${result.agesSkipped} mantidas: a pessoa disse no chat que não tem 18 anos)` : ""}.</li>}
          {result.errors.length > 0 && <li className="text-amber-ink">{result.errors.length} linhas ficaram de fora (lista abaixo).</li>}
        </ul>
        {result.errors.length > 0 && <ErrorList errors={result.errors} />}
        <div className="flex flex-wrap gap-2">
          <Link href={`/painel/clientes/${clientId}?tab=contatos`} className="btn-primary">Ver os contatos</Link>
          <button type="button" className="btn-ghost" onClick={() => { setResult(null); setRows([]); setFileName(null); }}>Importar outra planilha</button>
        </div>
      </section>
    );
  }

  return (
    <section className="card flex flex-col gap-4 p-5">
      <div>
        <label htmlFor="import-bot" className="label">Chatbot</label>
        <select id="import-bot" value={botId} onChange={(e) => setBotId(e.target.value)} className="input max-w-[360px]">
          {bots.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <p className="mt-1 text-xs text-muted">Os contatos entram como contatos do WhatsApp deste chatbot, e os aceites valem para o número dele.</p>
      </div>

      <div>
        <label htmlFor="import-file" className="label">Planilha (CSV)</label>
        <input id="import-file" type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} className="block text-sm" />
        <p className="mt-1 text-xs text-muted">No Excel ou no Google Planilhas: Arquivo → Salvar como (ou Fazer download) → CSV.</p>
      </div>

      {problem && <p className="rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink">{problem}</p>}

      {rows.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="rounded-xl bg-ground p-3 text-sm">
            <strong>{fileName}</strong>: {rows.length} linhas · <strong>{preview.valid.length}</strong> prontas para importar · {withConsent} com aceite de novidades · {withAge} com idade
            {preview.errors.length > 0 && <span className="text-amber-ink"> · {preview.errors.length} com problema (ficam de fora)</span>}
          </div>
          {preview.errors.length > 0 && <ErrorList errors={preview.errors} />}

          {needsText && (
            <div>
              <label htmlFor="import-text" className="label">Texto que as pessoas aceitaram</label>
              <textarea id="import-text" value={consentText} onChange={(e) => setConsentText(e.target.value)} maxLength={600} rows={3} className="input" placeholder="Ex.: Aceito receber novidades e promoções da Pizzaria do Zé pelo WhatsApp." />
              <p className="mt-1 text-xs text-muted">Vale para as linhas sem a coluna aceite_texto.</p>
            </div>
          )}
          {withConsent > 0 && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={consentTerms} onChange={(e) => setConsentTerms(e.target.checked)} className="mt-1" />
              <span>A empresa coletou esses aceites (na origem e na data informadas) e consegue prová-los se a pessoa ou a Meta pedirem. Quem pediu para sair (SAIR) continua sem receber.</span>
            </label>
          )}
          {withAge > 0 && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={ageTerms} onChange={(e) => setAgeTerms(e.target.checked)} className="mt-1" />
              <span>A empresa responde pela idade informada. A data de nascimento só serve para calcular o 18+ e não é guardada; se a pessoa disse no chat que não tem 18 anos, vale o que ela disse.</span>
            </label>
          )}
          {result && !result.ok && <p className="text-sm text-danger" role="alert">{result.message}</p>}
          <button type="button" onClick={submit} disabled={!ready || pending} className="btn-primary self-start">
            {pending ? "Importando…" : `Importar ${preview.valid.length} contatos`}
          </button>
        </div>
      )}
    </section>
  );
}

function ErrorList({ errors }: { errors: Array<{ line: number; reason: string }> }) {
  return (
    <ul className="max-h-48 overflow-y-auto rounded-lg border border-line px-3 py-2 text-xs text-ink-2">
      {errors.slice(0, 200).map((e) => <li key={`${e.line}${e.reason}`}>Linha {e.line}: {e.reason}</li>)}
      {errors.length > 200 && <li>…e mais {errors.length - 200}.</li>}
    </ul>
  );
}
