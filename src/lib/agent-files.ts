import { sniffMime, type OutboundKind } from "./outbound-file";
import { AGENT_FILE_MAX_BYTES, AGENT_FILE_TEXTS } from "./agent-file-rules";

/*
 * Foto e PDF mandados pela equipe na conversa (painel e área do cliente; leva de 21/10/2026, depois
 * da Conversa mais natural). O tipo vem dos primeiros bytes, nunca do nome nem do navegador; o
 * arquivo vai até 4 MB, porque o pedido inteiro passa pelo limite de 4,5 MB da Vercel (a foto
 * maior é reduzida no navegador antes de sair). A cópia fica cifrada, como a dos outros arquivos, e
 * a Meta busca o arquivo pelo link assinado da rota de arquivos.
 */

export { AGENT_FILE_ACCEPT, AGENT_FILE_MAX_BYTES, AGENT_FILE_TEXTS } from "./agent-file-rules";
/** A legenda da foto ou do documento no WhatsApp vai até 1.024 letras; texto maior sai antes. */
export const WA_CAPTION_MAX = 1024;

export interface AgentFile {
  data: Uint8Array;
  filename: string | null;
  mime: string;
  kind: OutboundKind;
}

/** O nome que o contato vê: sem caminho, até 120 letras. Pura. */
export function cleanFileName(raw: string | null | undefined): string | null {
  const base = (raw ?? "").split(/[\\/]/).pop()?.replace(/[\u0000-\u001f]/g, "").trim() ?? "";
  return base ? base.slice(-120) : null;
}

/** Confere o arquivo da equipe: até 4 MB, foto (JPEG ou PNG) ou PDF, pelos primeiros bytes. Pura. */
export function checkAgentFile(data: Uint8Array, filename: string | null): { ok: true; file: AgentFile } | { ok: false; message: string } {
  if (!data.byteLength) return { ok: false, message: AGENT_FILE_TEXTS.empty };
  if (data.byteLength > AGENT_FILE_MAX_BYTES) return { ok: false, message: AGENT_FILE_TEXTS.tooBig };
  const name = cleanFileName(filename);
  const mime = sniffMime(data, name);
  if (mime !== "image/jpeg" && mime !== "image/png" && mime !== "application/pdf") return { ok: false, message: AGENT_FILE_TEXTS.wrongType };
  return { ok: true, file: { data, filename: name, mime, kind: mime === "application/pdf" ? "document" : "image" } };
}

/** O arquivo do formulário (campo "file"): null sem arquivo; o tamanho é conferido antes de ler. */
export async function agentUpload(value: FormDataEntryValue | null): Promise<{ ok: true; upload: { data: Uint8Array; filename: string | null } | null } | { ok: false; message: string }> {
  if (!value || typeof value === "string" || value.size === 0) return { ok: true, upload: null };
  if (value.size > AGENT_FILE_MAX_BYTES) return { ok: false, message: AGENT_FILE_TEXTS.tooBig };
  return { ok: true, upload: { data: new Uint8Array(await value.arrayBuffer()), filename: value.name || null } };
}

/** O texto gravado quando o arquivo vai sem texto: "📷 foto.jpg" ou "📄 boleto.pdf". Pura. */
export const agentFileLabel = (f: Pick<AgentFile, "kind" | "filename">) => (f.kind === "image" ? `📷 ${f.filename ?? "(foto)"}` : `📄 ${f.filename ?? "(documento)"}`);
