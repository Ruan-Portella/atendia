/*
 * Assinatura das mensagens da equipe (Caixa de entrada, parte 5; spec, Peça 11). Até aqui (B1'), o
 * nome só aparecia no anúncio de entrada. Agora o chatbot escolhe o formato: sem assinatura, o nome
 * no começo ("*Viviane:*", em negrito no WhatsApp) ou no fim ("— Viviane"); a assinatura
 * inteligente põe o nome só na primeira mensagem de cada sequência (até o contato responder ou
 * outra pessoa escrever); o setor pode ir junto do nome. Cada pessoa escolhe o seu formato, a não
 * ser que o chatbot trave. No chat do site não sai assinatura: o widget já mostra o nome e a foto.
 * Puro (a tela e o servidor usam).
 */

export type SignatureFormat = "nenhuma" | "inicio" | "fim";
export const SIGNATURE_FORMATS: readonly SignatureFormat[] = ["nenhuma", "inicio", "fim"];
export const SIGNATURE_LABEL: Record<SignatureFormat, string> = {
  nenhuma: "Sem assinatura (só o anúncio de entrada leva o nome)",
  inicio: "Nome no começo (Viviane:, em negrito no WhatsApp)",
  fim: "Nome no fim (— Viviane)",
};

export const isSignatureFormat = (v: unknown): v is SignatureFormat => typeof v === "string" && (SIGNATURE_FORMATS as readonly string[]).includes(v);

/** O que o chatbot guarda em human_handoff. */
export interface SignatureConfig {
  signature?: SignatureFormat | null;
  /** Só na primeira mensagem de cada sequência (padrão: sim). */
  signature_smart?: boolean | null;
  /** O setor da conversa junto do nome. */
  signature_sector?: boolean | null;
  /** A equipe não muda o formato no perfil. */
  signature_locked?: boolean | null;
}

/** O formato que vale para esta pessoa: o do chatbot, ou o dela se o chatbot não trava. Pura. */
export function effectiveSignature(cfg: SignatureConfig | null | undefined, mine: SignatureFormat | null | undefined): SignatureFormat {
  const bot = isSignatureFormat(cfg?.signature) ? cfg!.signature! : "nenhuma";
  return !cfg?.signature_locked && isSignatureFormat(mine) ? mine : bot;
}

/** O texto sem a assinatura do fim ("— Viviane"), para o aprendizado com as respostas da equipe. Pura. */
export const withoutSignatureSuffix = (text: string): string => text.replace(/\n\n— [^\n]{1,100}$/, "");

/** Esta mensagem começa uma sequência: a anterior não foi desta pessoa da equipe. Pura. */
export function startsSequence(last: { role: string; author_id?: string | null } | null | undefined, whoId: string): boolean {
  return !last || last.role !== "agent" || last.author_id !== whoId;
}

/**
 * O texto assinado e quantos caracteres do começo são assinatura (o painel mostra como o anúncio).
 * Só no WhatsApp e no Instagram; o negrito (*…*) só no WhatsApp. Pura.
 */
export function signText(content: string, o: { format: SignatureFormat; name: string; sector?: string | null; channel: string | null | undefined }): { text: string; prefixChars: number } {
  const meta = o.channel === "whatsapp" || o.channel === "instagram";
  const name = o.name.trim();
  if (!meta || !name || o.format === "nenhuma") return { text: content, prefixChars: 0 };
  const label = o.sector?.trim() ? `${name} · ${o.sector.trim()}` : name;
  if (o.format === "fim") return { text: `${content}\n\n— ${label}`, prefixChars: 0 };
  const prefix = o.channel === "whatsapp" ? `*${label}:*` : `${label}:`;
  return { text: `${prefix}\n${content}`, prefixChars: prefix.length + 1 };
}
