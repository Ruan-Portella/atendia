import { AGENT_FILE_MAX_BYTES, AGENT_FILE_TEXTS } from "./agent-file-rules";

/*
 * O arquivo que a equipe escolheu, antes de sair do navegador: foto acima de 4 MB é reduzida (JPEG,
 * lado maior de até 2.048 pixels, e menor se ainda passar); PDF acima de 4 MB e outros tipos
 * voltam com o aviso. Só no navegador (canvas).
 */

const isPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);
const isPhoto = (f: File) => f.type === "image/jpeg" || f.type === "image/png" || /\.(jpe?g|png)$/i.test(f.name);

/** A foto em JPEG, cada vez menor, até caber no limite (null se não couber ou o navegador não abrir). */
async function shrinkPhoto(f: File, maxBytes: number): Promise<File | null> {
  try {
    const bmp = await createImageBitmap(f);
    for (const [side, quality] of [[2048, 0.85], [1600, 0.8], [1280, 0.72]] as const) {
      const scale = Math.min(1, side / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bmp.width * scale));
      canvas.height = Math.max(1, Math.round(bmp.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      // PNG com fundo transparente: fundo branco no JPEG
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= maxBytes) return new File([blob], `${f.name.replace(/\.[^.]+$/, "") || "foto"}.jpg`, { type: "image/jpeg" });
    }
    return null;
  } catch {
    return null;
  }
}

/** O arquivo pronto para enviar, ou o aviso para a pessoa. */
export async function prepareAgentFile(f: File, maxBytes = AGENT_FILE_MAX_BYTES): Promise<{ ok: true; file: File } | { ok: false; message: string }> {
  if (!isPdf(f) && !isPhoto(f)) return { ok: false, message: AGENT_FILE_TEXTS.wrongType };
  if (!f.size) return { ok: false, message: AGENT_FILE_TEXTS.empty };
  if (f.size <= maxBytes) return { ok: true, file: f };
  if (isPdf(f)) return { ok: false, message: AGENT_FILE_TEXTS.tooBig };
  const small = await shrinkPhoto(f, maxBytes);
  return small ? { ok: true, file: small } : { ok: false, message: AGENT_FILE_TEXTS.tooBig };
}

/** "1,2 MB" ou "340 KB". Pura. */
export const fileSizeLabel = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
