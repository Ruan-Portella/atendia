/*
 * As regras do arquivo da equipe que o navegador também usa (sem nada de servidor): o tamanho, os
 * tipos e os textos. A conferência de verdade, pelos primeiros bytes, fica em agent-files.ts.
 */

/** Até 4 MB por arquivo (o pedido inteiro cabe nos 4,5 MB da Vercel). */
export const AGENT_FILE_MAX_BYTES = 4 * 1024 * 1024;
/** Os tipos aceitos no campo da equipe (o input do navegador usa a mesma lista). */
export const AGENT_FILE_ACCEPT = "image/jpeg,image/png,application/pdf";

export const AGENT_FILE_TEXTS = {
  tooBig: "O arquivo vai até 4 MB. Mande uma foto menor ou um PDF mais leve.",
  wrongType: "Mande uma foto (JPEG ou PNG) ou um PDF.",
  empty: "O arquivo está vazio.",
  ticket: "No chamado, a resposta vai por e-mail e o arquivo não iria junto: mande o arquivo por e-mail ou cole um link.",
  notStored: "Não deu para guardar o arquivo. Tente de novo.",
} as const;
