import type { SupabaseClient } from "@supabase/supabase-js";

/*
 * Arquivo dos PDFs das fontes (bucket "sources"): o caminho fica na fonte (sources.file_path);
 * apagar ou trocar o PDF apaga o arquivo, e excluir o chatbot apaga a pasta dele.
 */

export const SOURCES_BUCKET = "sources";

/** Caminho do PDF no Storage: pasta do chatbot, nome sem caracteres estranhos. Pura. */
export function sourcePdfPath(botId: string, fileName: string, now = Date.now()): string {
  const base = fileName.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+/, "").slice(-80) || "arquivo.pdf";
  return `${botId}/${now}-${base}`;
}

/** O arquivo é um PDF (começa com %PDF-)? O tipo e o nome vêm do navegador e não provam nada. Pura. */
export function looksLikePdf(buf: ArrayBuffer): boolean {
  return new TextDecoder("latin1").decode(new Uint8Array(buf.slice(0, 5))) === "%PDF-";
}

export async function removeSourceFiles(db: SupabaseClient, paths: Array<string | null | undefined>, onlyBot?: string): Promise<void> {
  // o caminho lido do banco só apaga na pasta do próprio chatbot: um file_path trocado não leva o PDF
  // de outro (relatório de segurança de 23/10/2026)
  const list = paths.filter((p): p is string => Boolean(p) && (!onlyBot || p!.startsWith(`${onlyBot}/`)));
  if (!list.length) return;
  const { error } = await db.storage.from(SOURCES_BUCKET).remove(list);
  if (error) console.error("PDF da fonte não apagado", error.message);
}

/** Excluir o chatbot: a pasta inteira dele (inclusive PDFs de antes do file_path). */
export async function removeBotSourceFiles(db: SupabaseClient, botId: string): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const { data, error } = await db.storage.from(SOURCES_BUCKET).list(botId, { limit: 100 });
    if (error || !data?.length) return;
    await removeSourceFiles(db, data.map((f) => `${botId}/${f.name}`));
    if (data.length < 100) return;
  }
}
