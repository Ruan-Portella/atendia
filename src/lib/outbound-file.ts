import { safeFetch } from "./safe-fetch";

/*
 * Arquivo que a API manda enviar (POST /v1/messages com type document ou image; C pública, parte
 * 3c): o BoaVoz baixa a URL (sem endereço interno), confere o tipo pelos primeiros bytes (nunca
 * pelo que a URL ou o cabeçalho dizem) e o tamanho do canal, e guarda uma cópia cifrada para o
 * painel, o widget e a API. A Meta busca o arquivo na URL original.
 */

export type OutboundKind = "image" | "document";
export type OutboundChannel = "whatsapp" | "instagram" | "widget";

/** Tipos aceitos por canal e o tamanho máximo (WhatsApp: imagem 5 MB; Instagram: imagem 8 MB, arquivo só PDF). */
export const OUTBOUND_RULES: Record<OutboundChannel, Record<OutboundKind, { mimes: string[]; maxBytes: number }>> = {
  whatsapp: {
    image: { mimes: ["image/jpeg", "image/png"], maxBytes: 5 * 1024 * 1024 },
    document: { mimes: ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation", "text/plain", "text/csv"], maxBytes: 16 * 1024 * 1024 },
  },
  instagram: {
    image: { mimes: ["image/jpeg", "image/png"], maxBytes: 8 * 1024 * 1024 },
    document: { mimes: ["application/pdf"], maxBytes: 16 * 1024 * 1024 },
  },
  widget: {
    image: { mimes: ["image/jpeg", "image/png"], maxBytes: 5 * 1024 * 1024 },
    document: { mimes: ["application/pdf"], maxBytes: 16 * 1024 * 1024 },
  },
};

const OFFICE_ZIP: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
const OFFICE_OLD: Record<string, string> = { doc: "application/msword", xls: "application/vnd.ms-excel", ppt: "application/vnd.ms-powerpoint" };
const TEXT: Record<string, string> = { txt: "text/plain", csv: "text/csv" };

const startsWith = (b: Uint8Array, sig: number[]) => sig.every((x, i) => b[i] === x);

/**
 * O tipo de verdade, pelos primeiros bytes (a extensão só separa os formatos do Office, que são
 * zip ou OLE por dentro, e o texto). HTML, SVG e executáveis nunca passam. Pura.
 */
export function sniffMime(data: Uint8Array, filename: string | null): string | null {
  const ext = (filename ?? "").toLowerCase().split(".").pop() ?? "";
  if (startsWith(data, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(data, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  if (startsWith(data, [0x50, 0x4b, 0x03, 0x04])) return OFFICE_ZIP[ext] ?? null;
  if (startsWith(data, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return OFFICE_OLD[ext] ?? null;
  if (TEXT[ext]) {
    // texto de verdade: sem byte nulo e sem cara de HTML
    const head = Buffer.from(data.subarray(0, 2048)).toString("utf8");
    if (data.subarray(0, 4096).includes(0) || /<\s*(html|script|svg|!doctype)/i.test(head)) return null;
    return TEXT[ext];
  }
  return null;
}

/** O nome do arquivo: o informado, senão o fim da URL (sem a query). Pura. */
export function fileNameOf(url: URL, given: string | null): string | null {
  const raw = given?.trim() || decodeURIComponent(url.pathname.split("/").pop() ?? "");
  const clean = raw.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 200).trim();
  return clean || null;
}

export class OutboundFileError extends Error {}

/** Baixa e confere o arquivo para o canal; o erro já vem com o texto para a API. */
export async function fetchOutboundFile(rawUrl: string, o: { channel: OutboundChannel; kind: OutboundKind; filename: string | null; timeoutMs?: number }): Promise<{ data: Uint8Array; mime: string; filename: string | null; url: string }> {
  const rule = OUTBOUND_RULES[o.channel][o.kind];
  const mb = Math.round(rule.maxBytes / 1024 / 1024);
  let res: Response;
  let finalUrl: string;
  try {
    const r = await safeFetch(rawUrl, { signal: AbortSignal.timeout(o.timeoutMs ?? 15_000) });
    res = r.res as unknown as Response;
    finalUrl = r.url;
  } catch {
    throw new OutboundFileError("Não deu para baixar o arquivo da URL (endereço público, HTTPS, respondendo em até 15 segundos).");
  }
  if (!res.ok) throw new OutboundFileError(`A URL do arquivo respondeu ${res.status}.`);
  if (Number(res.headers.get("content-length") ?? 0) > rule.maxBytes) throw new OutboundFileError(`O arquivo passa de ${mb} MB.`);
  const data = new Uint8Array(await res.arrayBuffer());
  if (!data.byteLength) throw new OutboundFileError("O arquivo da URL veio vazio.");
  if (data.byteLength > rule.maxBytes) throw new OutboundFileError(`O arquivo passa de ${mb} MB.`);
  const filename = fileNameOf(new URL(finalUrl), o.filename);
  const mime = sniffMime(data, filename);
  if (!mime || !rule.mimes.includes(mime)) {
    const accepted = o.kind === "image" ? "JPEG ou PNG" : o.channel === "whatsapp" ? "PDF, Word, Excel, PowerPoint, TXT ou CSV" : "PDF";
    throw new OutboundFileError(`Tipo de arquivo não aceito aqui: ${o.kind === "image" ? "imagem" : "documento"} em ${accepted}.`);
  }
  return { data, mime, filename, url: rawUrl };
}
