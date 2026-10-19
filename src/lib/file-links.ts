import { timingSafeEqual } from "node:crypto";
import { hmacHex } from "./hash";
import { appUrl } from "./utils";
import { readingJson, type PhotoReading } from "./photo-note";

/*
 * Link assinado da rota de arquivos (spec "Arquivos", leva S; C pública, partes 3c e 3d): quem não
 * tem sessão no painel (a API, o widget do site e os webhooks) abre /api/files/{id}?exp=&sig=.
 * Vale 1 hora e é gerado de novo a cada leitura. A assinatura usa a chave da plataforma com um
 * prefixo próprio (não serve para nenhum outro hash).
 */

export const FILE_LINK_TTL_SECONDS = 3600;
/** Anexo de ação em formato que o canal não aceita (XML, ZIP, planilha no Instagram): link de 7 dias. */
export const LONG_FILE_LINK_TTL_SECONDS = 7 * 86_400;

const signature = (id: string, exp: number) => hmacHex(`arquivo:${id}:${exp}`);

/** Link de 1 hora para o arquivo (ou de até 7 dias, no anexo de ação que vai como link). */
export function signedFileUrl(id: string, now = Date.now(), ttlSeconds = FILE_LINK_TTL_SECONDS): { url: string; expiresAt: string } {
  const exp = Math.floor(now / 1000) + Math.min(ttlSeconds, LONG_FILE_LINK_TTL_SECONDS);
  return { url: appUrl(`/api/files/${id}?exp=${exp}&sig=${signature(id, exp)}`), expiresAt: new Date(exp * 1000).toISOString() };
}

/** O link assinado vale para este arquivo e ainda não venceu? */
export function validFileLink(id: string, exp: string | null, sig: string | null, now = Date.now()): boolean {
  const e = Number(exp);
  if (!exp || !sig || !Number.isSafeInteger(e) || e * 1000 < now || e * 1000 > now + LONG_FILE_LINK_TTL_SECONDS * 1000 + 60_000) return false;
  const want = Buffer.from(signature(id, e));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** Anexo de mensagem de atendente no widget: o primeiro arquivo, com o link de 1 hora. */
export interface WidgetFile {
  url: string;
  name: string | null;
  kind: "image" | "document";
}

export function widgetFile(files: Array<{ id: string; doc_type: string; filename: string | null }> | undefined, now = Date.now()): WidgetFile | null {
  const f = files?.[0];
  if (!f) return null;
  return { url: signedFileUrl(f.id, now).url, name: f.filename, kind: f.doc_type === "image" ? "image" : "document" };
}

/* ------------------------------------------------------------------ media no formato da API */

/** Prefixo do áudio transcrito no texto gravado ("🎤 " + transcrição; whatsapp-inbound). */
const AUDIO_PREFIX = "🎤 ";
const MEDIA_LABEL = /^(\p{Extended_Pictographic}\uFE0F?\s)?\(([^()]+)\)(?:\s+([\s\S]*))?$/u;

/**
 * Texto de mensagem com arquivo: o rótulo ("📷 (foto)") sai, a legenda fica; no áudio, a
 * transcrição vai para media.transcript, sem o prefixo. Pura.
 */
export function splitMediaText(content: string): { text: string | null; transcript: string | null } {
  if (content.startsWith(AUDIO_PREFIX)) {
    const rest = content.slice(AUDIO_PREFIX.length).trim();
    return { text: null, transcript: rest && !/^\([^()]+\)$/.test(rest) ? rest : null };
  }
  const m = MEDIA_LABEL.exec(content.trim());
  if (m) return { text: m[3]?.trim() || null, transcript: null };
  // documento enviado pela API sem legenda: "📄 nome.pdf"
  if (/^📄 \S/u.test(content) && !content.includes("\n")) return { text: null, transcript: null };
  return { text: content, transcript: null };
}

/**
 * O arquivo no formato da API (spec "Objetos", media), com o link assinado de 1 hora. reading: o
 * que a IA leu da foto (leva de leitura de fotos; só em imagem). Pura.
 */
export function mediaObject(a: { id: string; doc_type: string; mime: string; size: number; filename: string | null }, transcript: string | null, now = Date.now(), reading: PhotoReading | null = null) {
  const link = signedFileUrl(a.id, now);
  return { id: `med_${a.id}`, type: a.doc_type, mime: a.mime, size: a.size, filename: a.filename, transcript, reading: a.doc_type === "image" ? readingJson(reading) : null, url: link.url, url_expires_at: link.expiresAt };
}

/**
 * Corpo guardado de um evento de webhook: o link do arquivo (data.message.media.url) é gerado de
 * novo a cada tentativa e em "Reenviar" (vale 1 hora). Sem arquivo, o corpo volta igual. Pura.
 */
export function refreshMediaLink(body: string, now = Date.now()): string {
  if (!body.includes('"med_')) return body;
  try {
    const env = JSON.parse(body) as { data?: { message?: { media?: { id?: unknown; url?: string; url_expires_at?: string } | null } } };
    const media = env.data?.message?.media;
    if (!media || typeof media.id !== "string" || !media.id.startsWith("med_")) return body;
    const link = signedFileUrl(media.id.slice(4), now);
    media.url = link.url;
    media.url_expires_at = link.expiresAt;
    return JSON.stringify(env);
  } catch {
    return body;
  }
}
