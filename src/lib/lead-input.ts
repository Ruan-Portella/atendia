import { isEmail } from "./validation";

/*
 * Dados que a IA manda em registrar_lead: só vira lead com nome de verdade e um jeito de a equipe
 * retornar: WhatsApp com DDD, e-mail ou o @ do Instagram, ou o próprio canal da conversa (no
 * WhatsApp, o número; no Instagram, a conta que escreveu pelo Direct). A IA às vezes chama antes de
 * a pessoa responder, com "não informado"; aí nada é gravado e ela recebe a instrução de pedir os dados.
 */

// "não informado", "desconhecido", "cliente", "-", "?"…: não é nome nem contato
const PLACEHOLDER = /^(?:n[aã]o\s+(?:informad[oa]|sei|tem|consta|disse)|desconhecid[oa]|sem\s+(?:nome|contato|whats(?:app)?|e-?mail|insta(?:gram)?)|cliente|visitante|contato|an[oô]nim[oa]|teste|nenhum|n\/?a|null|undefined|-+|\?+|\.+)$/i;

const isPlaceholder = (v: string) => PLACEHOLDER.test(v.trim());

/** Telefone com DDD (10 a 13 dígitos). Pura. */
export const validPhone = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  if (!t || isPlaceholder(t)) return null;
  const digits = t.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 13 ? t : null;
};

/** @ do Instagram ("@fulano", "fulano" ou o link do perfil) no formato "@fulano". Pura. */
export const validInstagram = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  if (!t || isPlaceholder(t)) return null;
  const handle = t.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/^@/, "").replace(/\/.*$/, "");
  return /^[a-z0-9._]{1,30}$/i.test(handle) && /[a-z]/i.test(handle) ? `@${handle.toLowerCase()}` : null;
};

export interface LeadInput {
  nome: string;
  whatsapp?: string;
  email?: string;
  instagram?: string;
}

/** O que a conversa já sabe da pessoa: o número (WhatsApp) ou que ela escreveu pelo Direct (Instagram). */
export interface KnownContact {
  phone?: string | null;
  instagram?: boolean;
  /** O que a pessoa escreveu e os nomes que a conversa já conhece (perfil do WhatsApp, identidade do site): o nome e os contatos do lead saem daqui. */
  said?: string[];
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Alguma palavra do nome aparece no que a pessoa escreveu (ou num nome já conhecido)? A IA às vezes inventa um nome. Pura. */
export function nameWasGiven(nome: string, said: string[]): boolean {
  const words = new Set(fold(said.join(" ")).split(/[^\p{L}]+/u).filter(Boolean));
  return fold(nome).split(/[^\p{L}]+/u).some((w) => w.length >= 2 && words.has(w));
}

/**
 * O contato que a IA mandou foi escrito pela pessoa? A IA às vezes monta um @ a partir do nome
 * ("Ruan" vira "@ruan", que é a conta de outra pessoa) ou repete o número do próprio canal. Pura.
 */
export function contactWasTyped(kind: "whatsapp" | "email" | "instagram", value: string, said: string[]): boolean {
  if (kind === "whatsapp") {
    // pelo menos os 8 últimos dígitos numa mensagem (a IA pode pôr o 55 ou tirar a formatação)
    const tail = value.replace(/\D/g, "").slice(-8);
    return tail.length === 8 && said.some((t) => t.replace(/\D/g, "").includes(tail));
  }
  if (kind === "email") return said.join("\n").toLowerCase().includes(value.toLowerCase());
  // @: escrito com @, como link do perfil ou numa mensagem que fala do Instagram ("meu insta é fulano");
  // a palavra solta não basta, porque o nome da pessoa ("Ruan") também viraria um @
  const handle = value.replace(/^@/, "").toLowerCase().replace(/[.]/g, "\\.");
  const marked = new RegExp(`(?:@|instagram\\.com/)${handle}(?![a-z0-9._])`);
  const loose = new RegExp(`(?:^|[^a-z0-9._])${handle}(?![a-z0-9._])`);
  return said.some((t) => {
    const low = t.toLowerCase();
    return marked.test(low) || (/\b(?:insta|instagram|ig|perfil)\b/.test(low) && loose.test(low));
  });
}

/**
 * Confere o que a IA mandou. Devolve os dados limpos ou a instrução para a IA. Com `said`, contato
 * que a pessoa não escreveu fica de fora (e, sem outro, falta contato). Pura.
 */
export function checkLeadInput(input: LeadInput, known: KnownContact = {}): { ok: true; nome: string; whatsapp: string | null; email: string | null; instagram: string | null } | { ok: false; instrucao: string } {
  const nome = input.nome.replace(/\s+/g, " ").trim();
  const typed = <T extends string | null>(kind: "whatsapp" | "email" | "instagram", v: T): T | null => (v && known.said !== undefined && !contactWasTyped(kind, v, known.said) ? null : v);
  const whatsapp = typed("whatsapp", validPhone(input.whatsapp));
  const email = typed("email", input.email && !isPlaceholder(input.email) && isEmail(input.email.trim()) ? input.email.trim().toLowerCase() : null);
  const instagram = typed("instagram", validInstagram(input.instagram));
  const badName = nome.length < 2 || isPlaceholder(nome) || !/\p{L}{2}/u.test(nome) || (known.said !== undefined && !nameWasGiven(nome, known.said));
  const noContact = !whatsapp && !email && !instagram && !known.phone && !known.instagram;
  if (badName || noContact) {
    const falta = [badName && "o nome", noContact && "um contato (WhatsApp com DDD, e-mail ou @ do Instagram)"].filter(Boolean).join(" e ");
    return { ok: false, instrucao: `Lead não registrado: falta ${falta}. Peça à pessoa e só chame registrar_lead quando ela informar; nunca use "não informado" nem dados inventados.` };
  }
  return { ok: true, nome, whatsapp, email, instagram };
}

/** Depois de registrar: confirmar que a equipe retorna, sem pedir mais dados (no WhatsApp e no Instagram, pela conversa). Pura. */
export function leadSavedNote(channel: string): string {
  const here = channel === "whatsapp" ? " por aqui, pelo WhatsApp" : channel === "instagram" ? " por aqui, pelo Instagram" : "";
  return `Contato registrado. Agradeça e confirme que a equipe vai entrar em contato${here}. Não peça mais nenhum dado (nem WhatsApp, nem e-mail).`;
}
