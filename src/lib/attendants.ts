import type { SupabaseClient } from "@supabase/supabase-js";

/*
 * Nome e foto de quem atende, para o contato (widget do site). Leva B1': só o nome de exibição e
 * a foto, nunca o e-mail. Mensagem antiga (sem author_id) fica sem nome: o widget mostra
 * "Equipe {empresa}", porque o texto antigo de autor podia ser um e-mail.
 */

export interface Face {
  name: string;
  avatar: string | null;
}

interface AuthorRef {
  author_type?: string | null;
  author_id?: string | null;
  author_display_name?: string | null;
}

/** Foto salva no Storage público da plataforma (a única origem aceita para a foto). Pura. */
export function isOurAvatarUrl(url: string | null | undefined, supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""): url is string {
  if (!url || !supabaseUrl) return false;
  return url.startsWith(`${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/logos/avatars/`) && !/[\s"'<>]/.test(url);
}

/** Fotos atuais de quem escreveu (pessoas da agência e do portal), por id. */
async function avatarsOf(db: SupabaseClient, refs: Array<{ type: string; id: string }>): Promise<Map<string, string | null>> {
  const ids = (type: string) => [...new Set(refs.filter((r) => r.type === type).map((r) => r.id))];
  const [agency, client] = [ids("agency_member"), ids("client_member")];
  const [{ data: a }, { data: c }] = await Promise.all([
    agency.length ? db.from("agency_members").select("id, avatar_url").in("id", agency) : Promise.resolve({ data: [] }),
    client.length ? db.from("client_members").select("id, avatar_url").in("id", client) : Promise.resolve({ data: [] }),
  ]);
  return new Map([...(a ?? []), ...(c ?? [])].map((r) => [String(r.id), isOurAvatarUrl(r.avatar_url as string | null) ? (r.avatar_url as string) : null]));
}

/** Rosto de cada mensagem de atendente (null = sem nome: o widget usa "Equipe {empresa}"). */
export async function facesOfMessages<T extends AuthorRef & { id: number }>(db: SupabaseClient, rows: T[]): Promise<Map<number, Face | null>> {
  const people = rows.filter((r) => r.author_id && (r.author_type === "agency_member" || r.author_type === "client_member"));
  const avatars = await avatarsOf(db, people.map((r) => ({ type: r.author_type!, id: r.author_id! })));
  return new Map(rows.map((r) => [r.id, r.author_id && r.author_display_name?.trim() ? { name: r.author_display_name.trim(), avatar: avatars.get(r.author_id) ?? null } : null]));
}

/** Quem está com a conversa agora (o aviso "Viviane entrou na conversa" no widget). */
export async function holderFace(db: SupabaseClient, conv: { takeover_at?: string | null; handled_at?: string | null; assigned_to_type?: string | null; assigned_to_id?: string | null; assigned_to_name?: string | null }): Promise<Face | null> {
  if (!conv.takeover_at || conv.handled_at || !conv.assigned_to_id || !conv.assigned_to_type || !conv.assigned_to_name?.trim()) return null;
  const avatars = await avatarsOf(db, [{ type: conv.assigned_to_type, id: conv.assigned_to_id }]);
  return { name: conv.assigned_to_name.trim(), avatar: avatars.get(conv.assigned_to_id) ?? null };
}

/** Confere o nome de exibição e a foto antes de salvar (null = pode). A foto só da pasta da pessoa. Pura. */
export function profileProblem(name: string, avatar: string | null, ownerId: string, supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""): string | null {
  if (name.length < 2) return "Escreva o nome de exibição (pelo menos 2 letras).";
  if (name.length > 40) return "O nome de exibição pode ter no máximo 40 caracteres.";
  if (/[<>{}\n\r]/.test(name) || !/\p{L}/u.test(name)) return "Use só letras, números e espaços no nome de exibição.";
  if (avatar && (!isOurAvatarUrl(avatar, supabaseUrl) || !avatar.includes(`/avatars/${ownerId}/`))) return "A foto não foi enviada por aqui. Envie de novo.";
  return null;
}
