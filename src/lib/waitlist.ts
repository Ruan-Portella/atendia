import type { SupabaseClient } from "@supabase/supabase-js";
import { company } from "./company";
import { isDisposableEmail } from "./disposable-email";
import { isPlatformAdmin } from "./platform-admin";
import { appUrl } from "./utils";
import { isEmail } from "./validation";

/*
 * Lista de espera (24/10/2026): até o lançamento (o Instagram no ar), a landing da produção leva
 * para a lista em vez do cadastro. NEXT_PUBLIC_WAITLIST=1 liga: os botões viram "Entrar na lista" e
 * só cria a conta quem o backoffice convidou (ou o admin da plataforma). Sem a chave, tudo como antes.
 */

export const WAITLIST_PROFILES = ["agency", "business", "saas"] as const;
export type WaitlistProfile = (typeof WAITLIST_PROFILES)[number];

/** As faixas do tamanho, por perfil (o que a pessoa escolhe no formulário). */
export const SIZE_BANDS: Record<WaitlistProfile, string[]> = {
  agency: ["Começando (0 a 2 clientes)", "3 a 10 clientes", "11 a 30 clientes", "Mais de 30 clientes"],
  business: ["Até 100 conversas por mês", "100 a 500 por mês", "500 a 2.000 por mês", "Mais de 2.000 por mês"],
  saas: ["Até 50 clientes no software", "50 a 500 clientes", "500 a 5.000 clientes", "Mais de 5.000 clientes"],
};

export const PROFILE_LABEL: Record<WaitlistProfile, string> = { agency: "Agência", business: "Negócio", saas: "SaaS" };

export interface WaitlistInput {
  email: string;
  name: string | null;
  profile: WaitlistProfile;
  company: string | null;
  sizeBand: string | null;
  source: string | null;
}

/** A lista de espera está ligada neste ambiente? */
export const waitlistMode = () => process.env.NEXT_PUBLIC_WAITLIST === "1";

const clean = (v: unknown, max: number) => {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
  return s || null;
};

/** Lê o formulário da lista. Pura. */
export function parseWaitlist(raw: Record<string, unknown>): WaitlistInput | { error: string } {
  const email = String(raw.email ?? "").trim().toLowerCase();
  if (!isEmail(email) || email.length > 254) return { error: "Confira o e-mail." };
  if (isDisposableEmail(email)) return { error: "Use um e-mail que você lê de verdade (e-mail temporário não entra na lista)." };
  const profile = WAITLIST_PROFILES.includes(raw.profile as WaitlistProfile) ? (raw.profile as WaitlistProfile) : "agency";
  const sizeBand = clean(raw.sizeBand, 40);
  return {
    email,
    name: clean(raw.name, 80),
    profile,
    company: clean(raw.company, 120),
    sizeBand: sizeBand && SIZE_BANDS[profile].includes(sizeBand) ? sizeBand : null,
    source: clean(raw.source, 120),
  };
}

/** Entra na lista (ou atualiza quem já estava) e devolve a posição na fila. */
export async function joinWaitlist(db: SupabaseClient, i: WaitlistInput, o: { ipHash?: string | null } = {}): Promise<{ position: number; already: boolean }> {
  const { data: found } = await db.from("waitlist").select("id, created_at").eq("email", i.email).maybeSingle();
  let createdAt = found?.created_at as string | undefined;
  if (found) {
    // quem já estava só completa o que faltava (não perde o lugar na fila)
    const patch: Record<string, unknown> = { profile: i.profile };
    if (i.name) patch.name = i.name;
    if (i.company) patch.company = i.company;
    if (i.sizeBand) patch.size_band = i.sizeBand;
    await db.from("waitlist").update(patch).eq("id", found.id);
  } else {
    const { data, error } = await db
      .from("waitlist")
      .insert({ email: i.email, name: i.name, profile: i.profile, company: i.company, size_band: i.sizeBand, source: i.source, ip_hash: o.ipHash ?? null, created_at: new Date().toISOString() })
      .select("created_at")
      .single();
    if (error || !data) {
      // dois envios ao mesmo tempo: o outro já gravou
      if (/duplicate|unique/i.test(error?.message ?? "")) return joinWaitlist(db, i, o);
      throw new Error(`lista de espera: ${error?.message ?? "não gravou"}`);
    }
    createdAt = data.created_at as string;
  }
  const { count } = await db.from("waitlist").select("id", { count: "exact", head: true }).lte("created_at", createdAt!);
  return { position: count ?? 1, already: Boolean(found) };
}

/** Pode criar a conta agora? Com a lista ligada, só o convidado (ou o admin da plataforma). */
export async function canCreateAccount(db: SupabaseClient, email: string): Promise<boolean> {
  if (!waitlistMode() || isPlatformAdmin(email)) return true;
  const { data } = await db.from("waitlist").select("invited_at").eq("email", email.toLowerCase()).maybeSingle();
  return Boolean(data?.invited_at);
}

/** Quem foi convidado criou a conta: a lista guarda o dia (o backoffice mostra "Entrou"). */
export async function markJoined(db: SupabaseClient, email: string): Promise<void> {
  await db.from("waitlist").update({ joined_at: new Date().toISOString() }).eq("email", email.toLowerCase()).is("joined_at", null);
}

/** O e-mail de quem entrou na lista. Pura. */
export function waitlistJoinedEmail(position: number, profile: WaitlistProfile, brand = company.brand): { subject: string; text: string } {
  return {
    subject: `Você está na lista do ${brand}`,
    text: [
      `Pronto: você é o nº ${position} da lista de espera do ${brand}.`,
      "",
      profile === "agency"
        ? "Estamos abrindo aos poucos, por ordem de chegada. Quando chegar a sua vez, você recebe o convite neste e-mail e já pode montar os chatbots dos seus clientes, com a sua marca."
        : profile === "saas"
          ? "Estamos abrindo aos poucos, por ordem de chegada. Quando chegar a sua vez, você recebe o convite neste e-mail, com o acesso à API para criar um assistente para cada cliente do seu software."
          : "Estamos abrindo aos poucos, por ordem de chegada. Quando chegar a sua vez, você recebe o convite neste e-mail e já pode colocar o assistente no seu WhatsApp, no seu Instagram e no seu site.",
      "",
      "Enquanto isso, não precisa fazer nada. Se não foi você que se inscreveu, ignore este e-mail.",
      "",
      brand,
    ].join("\n"),
  };
}

/** O convite de quem saiu da lista. Pura. */
export function waitlistInviteEmail(name: string | null, brand = company.brand, link = appUrl("/cadastro")): { subject: string; text: string } {
  return {
    subject: `Chegou a sua vez no ${brand}`,
    text: [
      `${name ? `Olá, ${name.split(" ")[0]}!` : "Olá!"} O seu acesso ao ${brand} está liberado.`,
      "",
      "Entre com este mesmo e-mail (o código chega aqui na hora) e monte o primeiro chatbot:",
      link,
      "",
      "Qualquer dúvida, é só responder este e-mail.",
      "",
      brand,
    ].join("\n"),
  };
}

export interface WaitlistRow {
  id: string;
  email: string;
  name: string | null;
  profile: WaitlistProfile;
  company: string | null;
  size_band: string | null;
  source: string | null;
  created_at: string;
  invited_at: string | null;
  invited_by: string | null;
  joined_at: string | null;
}

/** A lista para o backoffice, na ordem de chegada. */
export async function listWaitlist(db: SupabaseClient, limit = 500): Promise<WaitlistRow[]> {
  const { data, error } = await db.from("waitlist").select("id, email, name, profile, company, size_band, source, created_at, invited_at, invited_by, joined_at").order("created_at").limit(limit);
  if (error) throw new Error(`lista de espera: ${error.message}`);
  return (data ?? []) as WaitlistRow[];
}

/** Convida (marca o dia e manda o e-mail). Quem já foi convidado não recebe de novo. Devolve quantos. */
export async function inviteFromWaitlist(db: SupabaseClient, ids: string[], by: string, send: (to: string, mail: { subject: string; text: string }) => Promise<boolean>): Promise<number> {
  if (!ids.length) return 0;
  const { data } = await db.from("waitlist").update({ invited_at: new Date().toISOString(), invited_by: by }).in("id", ids).is("invited_at", null).select("email, name");
  let sent = 0;
  for (const r of (data ?? []) as Array<{ email: string; name: string | null }>) {
    if (await send(r.email, waitlistInviteEmail(r.name)).catch(() => false)) sent++;
  }
  return sent;
}
