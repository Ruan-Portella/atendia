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
}

/**
 * Confere o que a IA mandou. Devolve os dados limpos ou a instrução para a IA. Pura.
 */
export function checkLeadInput(input: LeadInput, known: KnownContact = {}): { ok: true; nome: string; whatsapp: string | null; email: string | null; instagram: string | null } | { ok: false; instrucao: string } {
  const nome = input.nome.replace(/\s+/g, " ").trim();
  const whatsapp = validPhone(input.whatsapp);
  const email = input.email && !isPlaceholder(input.email) && isEmail(input.email.trim()) ? input.email.trim().toLowerCase() : null;
  const instagram = validInstagram(input.instagram);
  const badName = nome.length < 2 || isPlaceholder(nome) || !/\p{L}{2}/u.test(nome);
  const noContact = !whatsapp && !email && !instagram && !known.phone && !known.instagram;
  if (badName || noContact) {
    const falta = [badName && "o nome", noContact && "um contato (WhatsApp com DDD, e-mail ou @ do Instagram)"].filter(Boolean).join(" e ");
    return { ok: false, instrucao: `Lead não registrado: falta ${falta}. Peça à pessoa e só chame registrar_lead quando ela informar; nunca use "não informado" nem dados inventados.` };
  }
  return { ok: true, nome, whatsapp, email, instagram };
}
