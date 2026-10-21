import type { SupabaseClient } from "@supabase/supabase-js";
import { imageMimeOf } from "./photo-note";
import { randomInt } from "node:crypto";
import { isEmail } from "./validation";

/*
 * Chamados no chat do site (Caixa de entrada, parte 7; spec, Ideias em avaliação, "Widget de
 * chamados", decidido em 28/09/2026). O chatbot pode ter a aba "Abrir chamado" ao lado do chat, ou
 * só o formulário. O chamado é uma conversa do site com protocolo e status (aberto, em andamento,
 * aguardando o cliente, resolvido); quem abre vira lead e o pedido entra na Caixa de entrada. O
 * assunto com o nome de um setor do cliente vai para esse setor.
 */

export const TICKET_STATUSES = ["aberto", "em_andamento", "aguardando_cliente", "resolvido"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = { aberto: "Aberto", em_andamento: "Em andamento", aguardando_cliente: "Aguardando o cliente", resolvido: "Resolvido" };
export const isTicketStatus = (v: unknown): v is TicketStatus => typeof v === "string" && (TICKET_STATUSES as readonly string[]).includes(v);

export type TicketMode = "aba" | "sozinho";
export type TicketPhone = "nao" | "opcional" | "obrigatorio";

export interface TicketForm {
  enabled: boolean;
  /** aba: "Conversar" e "Abrir chamado" no widget; sozinho: o widget só abre o formulário */
  mode: TicketMode;
  phone: TicketPhone;
  /** a lista de assuntos (vazia: sem o campo) */
  subjects: string[];
  /** aceita um anexo, foto ou PDF (leva das sobras, parte 4; desligado por padrão) */
  attachment?: boolean;
}

export const TICKET_SUBJECTS_MAX = 10;
export const TICKET_SUBJECT_MAX = 40;
export const TICKET_DESCRIPTION_MAX = 2000;

/** O formulário guardado no chatbot, ou null se desligado. Pura. */
export function ticketFormOf(raw: unknown): TicketForm | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.enabled !== true) return null;
  const subjects = Array.isArray(r.subjects) ? r.subjects.filter((s): s is string => typeof s === "string" && Boolean(s.trim())).map((s) => s.trim().slice(0, TICKET_SUBJECT_MAX)).slice(0, TICKET_SUBJECTS_MAX) : [];
  return { enabled: true, mode: r.mode === "sozinho" ? "sozinho" : "aba", phone: r.phone === "opcional" || r.phone === "obrigatorio" ? r.phone : "nao", subjects, attachment: r.attachment === true };
}

/*
 * O anexo do chamado (leva das sobras, parte 4): um arquivo só, foto (JPEG, PNG ou WEBP) ou PDF,
 * conferido pelos primeiros bytes (o tipo que o navegador diz não vale), até 4 MB (o corpo de uma
 * requisição na Vercel vai até 4,5 MB). Fica no armazenamento privado, cifrado, e só a equipe vê na
 * conversa; a IA não lê.
 */
export const TICKET_FILE_MAX_BYTES = 4 * 1024 * 1024;

/** O tipo do anexo pelos primeiros bytes, ou null se não for foto nem PDF. Pura. */
export function ticketFileMime(d: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | "application/pdf" | null {
  if (d.byteLength >= 5 && d[0] === 0x25 && d[1] === 0x50 && d[2] === 0x44 && d[3] === 0x46 && d[4] === 0x2d) return "application/pdf";
  return imageMimeOf(d);
}

/** Os campos do painel (Bot → Atendimento humano → Chamados no chat do site). Pura. */
export function parseTicketForm(f: Record<string, string>): { value: TicketForm | null } | { error: string } {
  const subjects = (f.ticket_subjects ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (subjects.length > TICKET_SUBJECTS_MAX) return { error: `Até ${TICKET_SUBJECTS_MAX} assuntos no chamado.` };
  const long = subjects.find((s) => s.length > TICKET_SUBJECT_MAX);
  if (long) return { error: `Assunto muito longo (até ${TICKET_SUBJECT_MAX} caracteres): ${long.slice(0, 50)}` };
  const unique = [...new Map(subjects.map((s) => [s.toLowerCase(), s])).values()];
  if (f.ticket_enabled !== "on") return { value: subjects.length ? { enabled: false, mode: f.ticket_mode === "sozinho" ? "sozinho" : "aba", phone: "nao", subjects: unique } : null };
  return { value: { enabled: true, mode: f.ticket_mode === "sozinho" ? "sozinho" : "aba", phone: f.ticket_phone === "opcional" || f.ticket_phone === "obrigatorio" ? f.ticket_phone : "nao", subjects: unique, attachment: f.ticket_attachment === "on" } };
}

/** Protocolo: 8 letras e números sem os que confundem (0/O, 1/I/L), em dois blocos. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export function newProtocol(pick: (max: number) => number = randomInt): string {
  const chars = Array.from({ length: 8 }, () => ALPHABET[pick(ALPHABET.length)]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

/** O protocolo digitado, normalizado ("k7q2 9xmp" vira "K7Q2-9XMP"), ou null. Pura. */
export function parseProtocol(raw: unknown): string | null {
  const s = typeof raw === "string" ? raw.toUpperCase().replace(/[^0-9A-Z]/g, "") : "";
  return /^[2-9A-HJKMNP-Z]{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4)}` : null;
}

export interface TicketInput {
  name: string;
  email: string;
  phone?: string | null;
  subject?: string | null;
  description: string;
}

/** O que está errado no que a pessoa preencheu, ou null. Pura. */
export function ticketInputProblem(form: TicketForm, d: TicketInput): string | null {
  if (d.name.trim().length < 2) return "Informe o seu nome.";
  if (!isEmail(d.email.trim())) return "Informe um e-mail válido: a resposta chega por ele.";
  const digits = (d.phone ?? "").replace(/\D/g, "");
  if (form.phone === "obrigatorio" && digits.length < 10) return "Informe o telefone com DDD.";
  if (digits && (digits.length < 10 || digits.length > 13)) return "Telefone inválido: use o DDD, ex.: (21) 99999-0000.";
  if (form.subjects.length && !form.subjects.some((s) => s === d.subject)) return "Escolha o assunto.";
  if (d.description.trim().length < 10) return "Conte um pouco mais do que aconteceu (pelo menos 10 letras).";
  if (d.description.trim().length > TICKET_DESCRIPTION_MAX) return `Descrição muito longa (até ${TICKET_DESCRIPTION_MAX.toLocaleString("pt-BR")} caracteres).`;
  return null;
}

/** Grava o protocolo na conversa (tenta de novo se, por azar, o protocolo já existir). */
export async function assignProtocol(db: SupabaseClient, conversationId: string, o: { subject: string | null; at: string }, pick?: (max: number) => number): Promise<string> {
  for (let i = 0; i < 4; i++) {
    const protocol = newProtocol(pick);
    const { error } = await db.from("conversations").update({ ticket_protocol: protocol, ticket_status: "aberto", ticket_subject: o.subject, ticket_opened_at: o.at }).eq("id", conversationId);
    if (!error) return protocol;
    if (!/duplicate|unique/i.test(error.message)) throw new Error(`chamado: ${error.message}`);
  }
  throw new Error("chamado: não foi possível gerar o protocolo");
}
