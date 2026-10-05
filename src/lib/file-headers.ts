/*
 * Cabeçalhos da rota de arquivos (leva S): o arquivo vem do contato, então nada roda no nosso
 * domínio. Só imagem (sem SVG), áudio e vídeo abrem na página; o resto (PDF, HTML, SVG, documentos)
 * só baixa. Nada de cache compartilhado.
 */

const INLINE = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "audio/ogg",
  "audio/mpeg",
  "audio/mp4",
  "audio/aac",
  "audio/amr",
  "audio/wav",
  "video/mp4",
  "video/3gpp",
  "video/quicktime",
]);

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "audio/wav": "wav",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "video/quicktime": "mov",
  "application/pdf": "pdf",
};

/** Abre na página? (imagem sem SVG, áudio, vídeo). Pura. */
export const opensInline = (mime: string) => INLINE.has(mime);

/** Nome para baixar: o original sem caracteres de controle, ou "arquivo-<id>.<ext>". Pura. */
export function downloadName(f: { id: string; mime: string; filename: string | null }): string {
  const clean = (f.filename ?? "").replace(/[\u0000-\u001f\u007f"\\/]/g, "").trim().slice(0, 120);
  return clean || `arquivo-${f.id.slice(0, 8)}.${EXT[f.mime] ?? "bin"}`;
}

export function fileHeaders(f: { id: string; mime: string; filename: string | null; size: number }): Record<string, string> {
  const inline = opensInline(f.mime);
  const name = downloadName(f);
  return {
    "Content-Type": inline ? f.mime : "application/octet-stream",
    "Content-Length": String(f.size),
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; img-src 'self'; media-src 'self'; sandbox",
    "Cache-Control": "private, no-store",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
}
