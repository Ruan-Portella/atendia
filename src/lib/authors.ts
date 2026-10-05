/** Autor das respostas mandadas pelo app WhatsApp Business do celular (coexistência). */
export const PHONE_AUTHOR = "celular";

/** Autor das respostas mandadas pelo próprio app do Instagram (alguém da equipe no celular). */
export const IG_APP_AUTHOR = "instagram";

/** Depois de uma resposta pelo celular ou pelo app, o assistente fica quieto na conversa por este tempo. */
export const PHONE_PAUSE_MINUTES = 60;

/** Alguém respondeu pelo celular ou pelo app há pouco? Então é gente atendendo: o assistente não fala por cima. */
export function phonePauseActive(lastPhoneReplyAt: string | null | undefined, now = Date.now()): boolean {
  return Boolean(lastPhoneReplyAt) && now - new Date(lastPhoneReplyAt!).getTime() < PHONE_PAUSE_MINUTES * 60_000;
}

/*
 * Quem escreveu cada mensagem (leva B1'): o tipo, o id (pessoa da equipe da agência ou do
 * portal do cliente) e o nome mostrado, copiado no momento do envio.
 */
export type AuthorType = "ai" | "system" | "agency_member" | "client_member" | "api" | "phone_app";

/** Pessoa atendendo: da equipe da agência (agency_members) ou do portal do cliente (client_members). */
export interface Attendant {
  type: "agency_member" | "client_member";
  id: string;
  /** nome de exibição (o contato vê no anúncio de entrada e no widget) */
  name: string;
  /** e-mail ou "agência": o texto antigo da coluna author, gravado junto até ela sair */
  legacy: string;
}

/** Tipo de autor pelo texto antigo (mensagem gravada sem o tipo). Pura. */
export function authorTypeOf(role: string, author: string | null | undefined): AuthorType | null {
  if (role === "user") return null;
  if (role === "assistant") return author === "sistema" ? "system" : "ai";
  if (author === PHONE_AUTHOR || author === IG_APP_AUTHOR) return "phone_app";
  if (!author || author === "agência") return "agency_member";
  return "client_member";
}

/** Os campos de autor de uma mensagem escrita por um atendente. */
export const attendantAuthor = (a: Attendant) => ({ author: a.legacy, author_type: a.type, author_id: a.id, author_display_name: a.name });

/** Nome da pessoa no cadastro (Google: full_name/name), nunca o nome da agência. Pura. */
export const personName = (meta: Record<string, unknown>): string | null => {
  const v = meta.full_name ?? meta.name;
  return typeof v === "string" && v.trim() ? v : null;
};

/** Primeiro nome (nome de exibição padrão): "Viviane Souza" → "Viviane"; e-mail → começo dele. Pura. */
export function firstName(fullName: string | null | undefined, email?: string | null): string {
  const n = (fullName ?? "").trim().split(/\s+/)[0];
  if (n) return n.slice(0, 40);
  const local = (email ?? "").split("@")[0].split(/[._+-]/)[0].replace(/\d+$/, "");
  return local ? (local[0].toUpperCase() + local.slice(1)).slice(0, 40) : "Equipe";
}

/** O que a tela precisa de uma mensagem para dizer quem escreveu. */
export interface AuthoredMessage {
  author?: string | null;
  author_type?: string | null;
  author_id?: string | null;
  author_display_name?: string | null;
}

/**
 * Quem escreveu, para a tela: no painel da agência (ou no backoffice) e no portal do cliente.
 * Mensagem antiga sem nome mostra o texto de antes ("agência", e-mail). Pura.
 */
export function authorLabel(m: AuthoredMessage, o: { view: "agency" | "client"; meId?: string | null; meLegacy?: string | null; agencyName?: string }): string {
  const type = m.author_type ?? authorTypeOf("agent", m.author);
  const name = m.author_display_name?.trim();
  const mine = (o.meId && m.author_id === o.meId) || (!m.author_id && o.meLegacy && m.author === o.meLegacy);
  if (type === "phone_app") return m.author === IG_APP_AUTHOR ? "Pelo app do Instagram" : "Pelo celular (WhatsApp Business)";
  if (type === "api") return "Integração";
  if (type === "client_member") {
    const who = name || m.author || "Pessoa do cliente";
    return mine ? `${who} (você)` : o.view === "agency" ? `Cliente · ${who}` : who;
  }
  // equipe da agência
  const who = name && name !== "agência" ? name : null;
  if (o.view === "client") return who ? `${who} · ${o.agencyName ?? "agência"}` : (o.agencyName ?? "Agência");
  return who ? (mine ? `${who} (você)` : who) : "Equipe da agência";
}
