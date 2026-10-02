/*
 * Duração de um áudio lida do próprio arquivo, para o custo da transcrição (a OpenAI cobra por
 * minuto e o gpt-4o-mini-transcribe não devolve a duração). Formatos: OGG (Opus ou Vorbis: o
 * áudio do WhatsApp), MP4/M4A (o do Instagram) e WAV. Outro formato: null (custo "sem preço",
 * nunca zero).
 */

const ascii = (data: Uint8Array, at: number, text: string) => {
  for (let i = 0; i < text.length; i++) if (data[at + i] !== text.charCodeAt(i)) return false;
  return true;
};

function indexOf(data: Uint8Array, text: string, from = 0): number {
  for (let i = from; i <= data.length - text.length; i++) if (ascii(data, i, text)) return i;
  return -1;
}

function lastIndexOf(data: Uint8Array, text: string): number {
  for (let i = data.length - text.length; i >= 0; i--) if (ascii(data, i, text)) return i;
  return -1;
}

const view = (data: Uint8Array) => new DataView(data.buffer, data.byteOffset, data.byteLength);

/** OGG: posição (granule) da última página ÷ taxa. Opus sempre conta a 48 kHz, menos o pre-skip. */
function oggSeconds(data: Uint8Array): number | null {
  const last = lastIndexOf(data, "OggS");
  if (last < 0 || last + 14 > data.length) return null;
  const granule = Number(view(data).getBigInt64(last + 6, true));
  if (granule <= 0) return null;
  const opus = indexOf(data, "OpusHead");
  if (opus >= 0 && opus + 12 <= data.length) {
    const preSkip = view(data).getUint16(opus + 10, true);
    return Math.max(granule - preSkip, 0) / 48_000;
  }
  const vorbis = indexOf(data, "\u0001vorbis");
  if (vorbis >= 0 && vorbis + 16 <= data.length) {
    const rate = view(data).getUint32(vorbis + 12, true);
    return rate ? granule / rate : null;
  }
  return null;
}

/** MP4/M4A: caixa mvhd (escala de tempo e duração). */
function mp4Seconds(data: Uint8Array): number | null {
  const at = indexOf(data, "mvhd");
  if (at < 0) return null;
  const v = view(data);
  const version = data[at + 4];
  if (version === 1) {
    if (at + 36 > data.length) return null;
    const scale = v.getUint32(at + 24);
    return scale ? Number(v.getBigUint64(at + 28)) / scale : null;
  }
  if (at + 24 > data.length) return null;
  const scale = v.getUint32(at + 16);
  return scale ? v.getUint32(at + 20) / scale : null;
}

/** WAV: tamanho do bloco de dados ÷ bytes por segundo. */
function wavSeconds(data: Uint8Array): number | null {
  const fmt = indexOf(data, "fmt ", 12);
  const body = indexOf(data, "data", 12);
  if (fmt < 0 || body < 0 || fmt + 20 > data.length || body + 8 > data.length) return null;
  const byteRate = view(data).getUint32(fmt + 16, true);
  return byteRate ? view(data).getUint32(body + 4, true) / byteRate : null;
}

export function audioDurationSeconds(data: Uint8Array): number | null {
  try {
    let s: number | null = null;
    if (ascii(data, 0, "OggS")) s = oggSeconds(data);
    else if (ascii(data, 4, "ftyp")) s = mp4Seconds(data);
    else if (ascii(data, 0, "RIFF") && ascii(data, 8, "WAVE")) s = wavSeconds(data);
    // nada de valor absurdo (arquivo cortado ou corrompido): melhor "sem preço" que um custo errado
    return s !== null && Number.isFinite(s) && s > 0 && s < 4 * 3600 ? Math.round(s * 100) / 100 : null;
  } catch {
    return null;
  }
}
