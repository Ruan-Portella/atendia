import type { SupabaseClient } from "@supabase/supabase-js";
import { extractText, getDocumentProxy } from "unpdf";
import { safeFetch } from "./safe-fetch";
import { OUTBOUND_RULES, fileNameOf, sniffMime, type OutboundKind } from "./outbound-file";
import { MAX_ACTION_FILE_BYTES, linkAttachments, storeAttachment } from "./attachments";
import { LONG_FILE_LINK_TTL_SECONDS, signedFileUrl, type WidgetFile } from "./file-links";
import { deliver } from "./send";
import { queueMessageEvent } from "./message-events";
import { dictionaryHits } from "./gate/match";
import { logGate } from "./gate/log";
import type { AgeStatus } from "./gate/age";
import type { GateCategory } from "./gate/rules";

/*
 * Anexos devolvidos por uma ação (C pública, parte 5c; spec "Peça 1", Anexos devolvidos, e
 * "Peça 10"): attachments: [{url, filename}]. Uma função única prepara cada anexo antes do texto:
 * baixa pelo safeFetch (até 25 MB), identifica o tipo pelos primeiros bytes, passa pelo portão
 * (nome do arquivo e o texto do PDF ou TXT, no WhatsApp e no Instagram) e guarda a cópia cifrada.
 * Depois do texto, cada anexo sai no formato do canal: JPEG ou PNG dentro do limite como imagem;
 * documento aceito pelo canal como documento; o resto (XML, ZIP, planilha no Instagram) como link
 * da rota de arquivos, válido por 7 dias. Barrado pelo portão: não vai (nem por link) e sai o
 * aviso com o canal que o cliente declarou. Download falho ou acima de 25 MB: "Não consegui anexar
 * o arquivo agora" e o registro attachment_failed no log.
 */

export type FileChannel = "whatsapp" | "instagram" | "widget";

export interface ActionFile {
  status: "ok" | "link" | "barrado" | "falha";
  /** Cópia cifrada (rota de arquivos); null quando não foi guardado. */
  id: string | null;
  /** Como sai no canal (status ok). */
  kind: OutboundKind | null;
  mime: string | null;
  filename: string | null;
  /** A URL do dev: a Meta busca o arquivo nela (como no POST /v1/messages). */
  url: string;
}

/** No máximo 5 anexos por resposta de ação. */
export const MAX_ACTION_FILES = 5;
const DOWNLOAD_TIMEOUT_MS = 20_000;
/** Texto lido do arquivo para o portão. */
const GATE_TEXT_CHARS = 20_000;

export const FILE_TEXTS = {
  failed: "Não consegui anexar o arquivo agora.",
  blocked: (destination: { destino: string } | null) => (destination ? `Esse arquivo não pode ser enviado por aqui: ${destination.destino}.` : "Esse arquivo não pode ser enviado por aqui."),
};

/** attachments do retorno, conferido: só {url HTTPS, filename?}, até 5. Função pura. */
export function readAttachmentList(raw: Array<{ url: string; filename?: string }> | undefined): Array<{ url: string; filename: string | null }> {
  const out: Array<{ url: string; filename: string | null }> = [];
  for (const a of raw ?? []) {
    try {
      if (new URL(a.url).protocol !== "https:") continue;
    } catch {
      continue;
    }
    out.push({ url: a.url, filename: typeof a.filename === "string" && a.filename.trim() ? a.filename.trim().slice(0, 200) : null });
    if (out.length >= MAX_ACTION_FILES) break;
  }
  return out;
}

const EXECUTABLE_EXT = /\.(exe|msi|bat|cmd|com|scr|ps1|vbs|js|jar|apk|sh|html?|svg|php)$/i;

/** Arquivo que nunca vai, nem por link: executável, página ou script. Função pura. */
export function unsafeFile(data: Uint8Array, filename: string | null): boolean {
  if (filename && EXECUTABLE_EXT.test(filename)) return true;
  if (data[0] === 0x4d && data[1] === 0x5a) return true; // MZ (Windows)
  if (data[0] === 0x7f && data[1] === 0x45 && data[2] === 0x4c && data[3] === 0x46) return true; // ELF
  const head = Buffer.from(data.subarray(0, 1024)).toString("utf8");
  return /<\s*(html|script|svg|!doctype\s+html)/i.test(head);
}

/** Como o anexo sai neste canal: imagem, documento ou link (o canal não aceita). Função pura. */
export function channelFormat(mime: string | null, size: number, channel: FileChannel): { status: "ok"; kind: OutboundKind } | { status: "link" } {
  const rules = OUTBOUND_RULES[channel];
  if (mime && rules.image.mimes.includes(mime) && size <= rules.image.maxBytes) return { status: "ok", kind: "image" };
  if (mime && rules.document.mimes.includes(mime) && size <= rules.document.maxBytes) return { status: "ok", kind: "document" };
  return { status: "link" };
}

/** O portão no anexo: item proibido, ou 18+ sem o "Sim", barra. Função pura. */
export function fileGate(text: string, o: { channel: "whatsapp" | "instagram"; contactPhone: string | null; age: AgeStatus; exempt?: readonly GateCategory[] }): GateCategory[] {
  const hits = dictionaryHits(text, { channel: o.channel, contactPhone: o.contactPhone, exempt: o.exempt });
  return [...new Set(hits.filter((h) => h.level === "proibido" || (h.level === "regulamentado" && o.age !== "sim")).map((h) => h.category))];
}

/** Texto que o portão lê: o nome e, no PDF ou TXT/CSV, o começo do conteúdo. */
async function textForGate(data: Uint8Array, mime: string | null, filename: string | null): Promise<string> {
  const parts = [filename ?? ""];
  try {
    if (mime === "application/pdf") {
      const pdf = await getDocumentProxy(new Uint8Array(data));
      const { text } = await extractText(pdf, { mergePages: true });
      parts.push(String(text).slice(0, GATE_TEXT_CHARS));
    } else if (mime === "text/plain" || mime === "text/csv") parts.push(Buffer.from(data.subarray(0, GATE_TEXT_CHARS * 2)).toString("utf8").slice(0, GATE_TEXT_CHARS));
  } catch {
    // PDF que não abre: o portão fica com o nome
  }
  return parts.join("\n");
}

async function download(url: string): Promise<{ data: Uint8Array; finalUrl: string } | null> {
  try {
    const r = await safeFetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    const res = r.res as unknown as Response;
    if (!res.ok || Number(res.headers.get("content-length") ?? 0) > MAX_ACTION_FILE_BYTES) return null;
    const data = new Uint8Array(await res.arrayBuffer());
    if (!data.byteLength || data.byteLength > MAX_ACTION_FILE_BYTES) return null;
    return { data, finalUrl: r.url };
  } catch {
    return null;
  }
}

export interface PrepareInput {
  bot: { id: string };
  conversationId: string;
  channel: FileChannel;
  /** Portão dos canais da Meta (no site não há trava do BoaVoz). */
  gate: { contactPhone: string | null; age: AgeStatus; exempt?: GateCategory[] } | null;
}

/** Prepara os anexos de uma resposta de ação (antes do texto). */
export async function prepareActionFiles(db: SupabaseClient, list: Array<{ url: string; filename: string | null }>, i: PrepareInput): Promise<ActionFile[]> {
  const out: ActionFile[] = [];
  for (const a of list) {
    const fail = (filename: string | null): ActionFile => ({ status: "falha", id: null, kind: null, mime: null, filename, url: a.url });
    const got = await download(a.url);
    if (!got) {
      console.warn("attachment_failed: download", a.url.slice(0, 120));
      out.push(fail(a.filename));
      continue;
    }
    const filename = fileNameOf(new URL(got.finalUrl), a.filename);
    if (unsafeFile(got.data, filename)) {
      console.warn("attachment_failed: tipo recusado", filename);
      out.push(fail(filename));
      continue;
    }
    const mime = sniffMime(got.data, filename);
    if (i.gate && i.channel !== "widget") {
      const blocked = fileGate(await textForGate(got.data, mime, filename), { channel: i.channel, ...i.gate });
      if (blocked.length) {
        await logGate(db, { botId: i.bot.id, conversationId: i.conversationId, stage: "saida", decision: "anexo_barrado", categories: blocked });
        out.push({ status: "barrado", id: null, kind: null, mime, filename, url: a.url });
        continue;
      }
    }
    const id = await storeAttachment(db, { botId: i.bot.id, conversationId: i.conversationId, messageId: null, channel: i.channel, data: got.data, mime: mime ?? "application/octet-stream", filename, maxBytes: MAX_ACTION_FILE_BYTES });
    if (!id) {
      console.warn("attachment_failed: cópia não guardada", filename);
      out.push(fail(filename));
      continue;
    }
    const format = channelFormat(mime, got.data.byteLength, i.channel);
    out.push({ status: format.status, id, kind: format.status === "ok" ? format.kind : null, mime, filename, url: a.url });
  }
  return out;
}

/** O que a IA lê sobre os anexos (eles vão logo depois da resposta dela). Pura. */
export function filesNote(files: ActionFile[]): Record<string, unknown> {
  const sent = files.filter((f) => f.status === "ok" || f.status === "link");
  if (!sent.length) return {};
  return { anexos: sent.map((f) => f.filename ?? "arquivo"), instrucao_anexos: "Esses arquivos vão para a pessoa logo depois da sua resposta: não escreva o link nem diga que não consegue mandar arquivo." };
}

/** Texto do anexo que vai por link (formato que o canal não aceita). */
export const linkText = (f: Pick<ActionFile, "filename">, url: string) => `📎 ${f.filename ?? "Arquivo"}: ${url}`;

/** Rótulo gravado na conversa para o anexo enviado. Pura. */
export const sentLabel = (f: Pick<ActionFile, "kind" | "filename">) => (f.kind === "image" ? `📷 ${f.filename ?? "(foto)"}` : `📄 ${f.filename ?? "(documento)"}`);

/** Anexos para o widget (link assinado de 1 hora; o que vai por link, como documento). */
export function widgetFiles(files: ActionFile[], now = Date.now()): WidgetFile[] {
  return files.filter((f) => (f.status === "ok" || f.status === "link") && f.id).map((f) => ({ url: signedFileUrl(f.id!, now).url, name: f.filename, kind: f.kind === "image" ? "image" : "document" }));
}

/** O aviso fixo do widget para anexo que falhou (no site não há portão). */
export const widgetFilesNotice = (files: ActionFile[]) => (files.some((f) => f.status === "falha") ? FILE_TEXTS.failed : null);

export interface DeliverFilesInput {
  bot: { id: string };
  conversationId: string;
  channel: "whatsapp" | "instagram";
  /** Canal declarado para o que não vai pelo chat (regulatedDestination). */
  destination: { destino: string } | null;
  /** Transporte do canal: imagem ou documento pela URL (devolve o id da mensagem na Meta). */
  sendFile: (f: { kind: OutboundKind; url: string; filename: string | null }) => Promise<string | null>;
  sendText: (text: string) => Promise<string | null>;
}

/**
 * Envia os anexos preparados, logo depois do texto, pela camada única de envio (regra de estado
 * e registro). Cada anexo vira uma mensagem da conversa, com a cópia ligada a ela.
 */
export async function deliverActionFiles(db: SupabaseClient, files: ActionFile[], i: DeliverFilesInput): Promise<void> {
  if (!files.length) return;
  const base = { botId: i.bot.id, channel: i.channel, conversationId: i.conversationId, kind: "ia" as const, deferEvent: true };
  const sent = async (messageId: number | null, f: ActionFile, content: string) => {
    if (!messageId) return;
    if (f.id) await linkAttachments(db, [f.id], messageId);
    await queueMessageEvent(db, messageId, { conversation_id: i.conversationId, role: "assistant", content }, { withMedia: true });
  };
  for (const f of files) {
    try {
      if (f.status === "ok" && f.kind) {
        const content = sentLabel(f);
        const r = await deliver(db, { ...base, record: { insert: { role: "assistant", content, author: null } }, transport: () => i.sendFile({ kind: f.kind!, url: f.url, filename: f.filename }) });
        if (r.status === "blocked") return;
        await sent(r.messageId, f, content);
      } else if (f.status === "link" && f.id) {
        const content = linkText(f, signedFileUrl(f.id, Date.now(), LONG_FILE_LINK_TTL_SECONDS).url);
        const r = await deliver(db, { ...base, record: { insert: { role: "assistant", content, author: null } }, transport: () => i.sendText(content) });
        if (r.status === "blocked") return;
        await sent(r.messageId, f, content);
      }
    } catch (e) {
      // o canal recusou o arquivo (ex.: a Meta não conseguiu buscar a URL): vira o aviso abaixo
      console.warn("attachment_failed: canal", f.filename, (e as Error).message);
      f.status = "falha";
    }
  }
  // um aviso só de cada tipo, no fim
  const notices = [files.some((f) => f.status === "barrado") ? FILE_TEXTS.blocked(i.destination) : null, files.some((f) => f.status === "falha") ? FILE_TEXTS.failed : null].filter((x): x is string => Boolean(x));
  for (const text of notices) {
    const r = await deliver(db, { botId: i.bot.id, channel: i.channel, conversationId: i.conversationId, kind: "ia", record: { insert: { role: "assistant", content: text, author: null } }, transport: () => i.sendText(text) }).catch(() => null);
    if (r?.status === "blocked") return;
  }
}
